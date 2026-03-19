import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Agent, createServer, request as httpRequest } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.WEB_PORT ?? "50810", 10);
const apiOrigin = process.env.WEB_API_ORIGIN ?? "http://127.0.0.1:50800";
const distRoot = resolve(process.cwd(), "dist");
const upstreamUrl = new URL(apiOrigin);
const proxyAgent = new Agent({
  keepAlive: true,
  maxSockets: Number.POSITIVE_INFINITY,
});

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function isApiRequest(pathname) {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/v1") ||
    pathname === "/openapi.json"
  );
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

const PROXY_RETRY_ATTEMPTS = 10;
const PROXY_RETRY_DELAY_MS = 500;
const PROXY_TIMEOUT_MS = 120_000;

async function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function proxyOnce(inReq, outRes, pathname, pipeBody) {
  return new Promise((resolveRequest, rejectRequest) => {
    const fullPath =
      pathname +
      (inReq.url?.includes("?") ? inReq.url.slice(inReq.url.indexOf("?")) : "");
    const forwardedHeaders = {};

    for (const [key, value] of Object.entries(inReq.headers)) {
      if (!HOP_BY_HOP.has(key.toLowerCase()) && value != null) {
        forwardedHeaders[key] = value;
      }
    }

    forwardedHeaders.host = upstreamUrl.host;

    const upReq = httpRequest(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        path: fullPath,
        method: inReq.method,
        headers: forwardedHeaders,
        agent: proxyAgent,
        timeout: PROXY_TIMEOUT_MS,
      },
      (upRes) => {
        const responseHeaders = {};
        for (const [key, value] of Object.entries(upRes.headers)) {
          if (!HOP_BY_HOP.has(key) && value != null) {
            responseHeaders[key] = value;
          }
        }

        outRes.writeHead(upRes.statusCode ?? 502, responseHeaders);
        upRes.pipe(outRes);
        upRes.on("end", resolveRequest);
        upRes.on("error", rejectRequest);
      },
    );

    upReq.on("error", rejectRequest);
    upReq.on("timeout", () => {
      upReq.destroy(new Error("upstream timeout"));
    });

    if (pipeBody && inReq.method !== "GET" && inReq.method !== "HEAD") {
      inReq.pipe(upReq);
    } else {
      upReq.end();
    }
  });
}

async function proxyRequest(inReq, outRes, pathname) {
  let lastError;

  for (let attempt = 0; attempt < PROXY_RETRY_ATTEMPTS; attempt++) {
    try {
      await proxyOnce(inReq, outRes, pathname, attempt === 0);
      return;
    } catch (error) {
      lastError = error;
      if (inReq.method !== "GET" && inReq.method !== "HEAD") {
        break;
      }
      if (outRes.headersSent) {
        break;
      }
      await sleep(PROXY_RETRY_DELAY_MS);
    }
  }

  if (!outRes.headersSent) {
    outRes.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
  }

  outRes.end(
    lastError instanceof Error ? lastError.message : "Upstream not ready",
  );
}

async function serveStatic(response, pathname) {
  const safePath = normalize(pathname).replace(/^\/+/, "");
  let filePath = join(distRoot, safePath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    filePath = join(distRoot, "index.html");
  }

  const extension = extname(filePath);
  response.setHeader(
    "Content-Type",
    contentTypes.get(extension) ?? "application/octet-stream",
  );
  if (extension === ".html") {
    response.setHeader("Cache-Control", "no-store");
  }
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (isApiRequest(url.pathname)) {
      await proxyRequest(request, response, url.pathname);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(
      error instanceof Error ? error.message : "Web sidecar failed.",
    );
  }
});

server.listen(port, host, () => {
  console.log(`Web sidecar listening on http://${host}:${port}`);

  const warmReq = httpRequest(
    {
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port,
      path: "/api/internal/desktop/ready",
      method: "GET",
      agent: proxyAgent,
      timeout: 5000,
    },
    (res) => {
      res.resume();
    },
  );
  warmReq.on("error", () => {});
  warmReq.end();
});

async function shutdown() {
  await new Promise((resolveClose) => server.close(resolveClose));
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
