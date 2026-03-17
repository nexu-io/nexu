import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getSidecarRoot,
  pathExists,
  repoRoot,
  resetDir,
} from "./lib/sidecar-paths.mjs";

const nexuRoot = repoRoot;
const webRoot = resolve(nexuRoot, "apps/web");
const webDistRoot = resolve(webRoot, "dist");
const sidecarRoot = getSidecarRoot("web");
const sidecarDistRoot = resolve(sidecarRoot, "dist");

async function ensureBuildArtifacts() {
  if (!(await pathExists(webDistRoot))) {
    throw new Error(
      "Missing web build artifact: apps/web/dist. Build web first.",
    );
  }
}

async function prepareWebSidecar() {
  await ensureBuildArtifacts();
  await resetDir(sidecarRoot);
  await cp(webDistRoot, sidecarDistRoot, { recursive: true });

  await writeFile(
    resolve(sidecarRoot, "package.json"),
    `${JSON.stringify({ name: "web-sidecar", private: true, type: "module" }, null, 2)}\n`,
  );

  await writeFile(
    resolve(sidecarRoot, "index.js"),
    `import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as httpRequest, Agent } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.WEB_PORT ?? "50810", 10);
const apiOrigin = process.env.WEB_API_ORIGIN ?? "http://127.0.0.1:50800";
const distRoot = resolve(process.cwd(), "dist");
const upstreamUrl = new URL(apiOrigin);

// Use node:http agent with unlimited sockets to avoid connection pool bottlenecks
const proxyAgent = new Agent({ keepAlive: true, maxSockets: Infinity });

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
  [".woff2", "font/woff2"]
]);

function isApiRequest(pathname) {
  return pathname.startsWith("/api") || pathname.startsWith("/v1") || pathname === "/openapi.json";
}

// Headers that must not be forwarded between proxy hops
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host"
]);

const PROXY_RETRY_ATTEMPTS = 10;
const PROXY_RETRY_DELAY_MS = 500;
const PROXY_TIMEOUT_MS = 5_000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function proxyOnce(inReq, outRes, pathname, pipeBody) {
  return new Promise((resolve, reject) => {
    const fullPath = pathname + (inReq.url?.includes("?") ? inReq.url.slice(inReq.url.indexOf("?")) : "");
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(inReq.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v != null) fwdHeaders[k] = v;
    }
    fwdHeaders.host = upstreamUrl.host;

    const upReq = httpRequest({
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port,
      path: fullPath,
      method: inReq.method,
      headers: fwdHeaders,
      agent: proxyAgent,
      timeout: PROXY_TIMEOUT_MS,
    }, (upRes) => {
      const h = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (!HOP_BY_HOP.has(k) && v != null) h[k] = v;
      }
      outRes.writeHead(upRes.statusCode, h);
      upRes.pipe(outRes);
      upRes.on("end", resolve);
      upRes.on("error", reject);
    });

    upReq.on("error", reject);
    upReq.on("timeout", () => { upReq.destroy(new Error("upstream timeout")); });

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
    } catch (err) {
      lastError = err;
      if (inReq.method !== "GET" && inReq.method !== "HEAD") break;
      if (outRes.headersSent) break;
      await sleep(PROXY_RETRY_DELAY_MS);
    }
  }
  if (!outRes.headersSent) {
    outRes.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
  }
  outRes.end(lastError instanceof Error ? lastError.message : "Upstream not ready");
}

async function serveStatic(response, pathname) {
  const safePath = normalize(pathname).replace(/^\\/+/, "");
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
  response.setHeader("Content-Type", contentTypes.get(extension) ?? "application/octet-stream");
  // Prevent webview from caching HTML (JS/CSS use content-hash filenames)
  if (extension === ".html") {
    response.setHeader("Cache-Control", "no-store");
  }
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", \`http://\${host}:\${port}\`);
    if (isApiRequest(url.pathname)) {
      const t0 = Date.now();
      console.log(\`[proxy] --> \${request.method} \${url.pathname}\`);
      await proxyRequest(request, response, url.pathname);
      console.log(\`[proxy] <-- \${request.method} \${url.pathname} \${Date.now() - t0}ms status=\${response.statusCode}\`);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : "Web sidecar failed.");
  }
});

server.listen(port, host, () => {
  console.log(\`Web sidecar listening on http://\${host}:\${port}\`);
  // Pre-warm upstream connection pool so first real proxy request is fast
  const warmReq = httpRequest({
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: "/api/internal/desktop/ready",
    method: "GET",
    agent: proxyAgent,
    timeout: 5000,
  }, (res) => { res.resume(); });
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
`,
  );
}

await prepareWebSidecar();
