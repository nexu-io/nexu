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
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.WEB_PORT ?? "50810", 10);
const apiOrigin = process.env.WEB_API_ORIGIN ?? "http://127.0.0.1:50800";
const distRoot = resolve(process.cwd(), "dist");

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

async function proxyRequest(request, response, pathname) {
  const upstreamUrl = new URL(pathname + (request.url?.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""), apiOrigin);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request;
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: request.headers,
    body,
    duplex: body ? "half" : undefined
  });

  response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers.entries()));
  if (upstreamResponse.body) {
    for await (const chunk of upstreamResponse.body) {
      response.write(chunk);
    }
  }
  response.end();
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
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", \`http://\${host}:\${port}\`);
    if (isApiRequest(url.pathname)) {
      await proxyRequest(request, response, url.pathname);
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
