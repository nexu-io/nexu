/**
 * Mock update server for electron-updater (generic provider).
 *
 * Supports two modes:
 * 1) default fake ZIP stream for UI-state testing
 * 2) real ZIP passthrough via MOCK_UPDATE_ZIP_PATH for download validation
 *
 * Usage:
 *   node apps/desktop/mock-update-server.mjs
 *   MOCK_UPDATE_ZIP_PATH=/abs/path/to/nexu.zip MOCK_UPDATE_VERSION=0.1.11-mock node apps/desktop/mock-update-server.mjs
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";

const PORT = Number(process.env.PORT ?? 8976);
const FAKE_VERSION = process.env.MOCK_UPDATE_VERSION ?? "0.2.0";
const FAKE_ZIP_SIZE = Number(process.env.MOCK_UPDATE_FAKE_SIZE ?? 5_000_000);
const CHUNK_SIZE = Number(process.env.MOCK_UPDATE_CHUNK_SIZE ?? 50_000);
const CHUNK_INTERVAL_MS = Number(
  process.env.MOCK_UPDATE_CHUNK_INTERVAL_MS ?? 100,
);
const zipPath = process.env.MOCK_UPDATE_ZIP_PATH
  ? resolve(process.env.MOCK_UPDATE_ZIP_PATH)
  : null;

const fakeSha512 = Buffer.alloc(64, 0xab).toString("base64");

function streamBufferSlowly(options) {
  const { req, res, totalSize, readChunk } = options;
  let sent = 0;

  const timer = setInterval(() => {
    if (sent >= totalSize) {
      clearInterval(timer);
      res.end();
      console.log(`  → Download complete (${sent} bytes)`);
      return;
    }

    const remaining = totalSize - sent;
    const toSend = remaining < CHUNK_SIZE ? remaining : CHUNK_SIZE;
    const chunk = readChunk(sent, toSend);
    res.write(chunk);
    sent += chunk.length;
  }, CHUNK_INTERVAL_MS);

  req.on("close", () => {
    clearInterval(timer);
  });
}

async function getZipMetadata() {
  if (!zipPath) {
    return {
      zipPath: null,
      zipFileName: `nexu-${FAKE_VERSION}-arm64-mac.zip`,
      zipSize: FAKE_ZIP_SIZE,
      sha512: fakeSha512,
      mode: "fake",
    };
  }

  const [zipStat, zipBuffer] = await Promise.all([
    stat(zipPath),
    readFile(zipPath),
  ]);
  return {
    zipPath,
    zipFileName: basename(zipPath),
    zipSize: zipStat.size,
    sha512: createHash("sha512").update(zipBuffer).digest("base64"),
    mode: "real",
  };
}

const zipMeta = await getZipMetadata();

const latestMacYml = `version: ${FAKE_VERSION}
files:
  - url: ${zipMeta.zipFileName}
    sha512: ${zipMeta.sha512}
    size: ${zipMeta.zipSize}
path: ${zipMeta.zipFileName}
sha512: ${zipMeta.sha512}
releaseDate: '2026-04-10T00:00:00.000Z'
releaseNotes: 'Mock update for local desktop testing'
`;

function normalizePath(pathname) {
  return pathname.replace(/^\/(arm64|x64)(?=\/)/, "");
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = normalizePath(url.pathname);
  console.log(`${req.method} ${url.pathname}`);

  // CORS for Electron renderer
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (pathname === "/latest-mac.yml" || pathname === "/latest.yml") {
    res.writeHead(200, { "Content-Type": "text/yaml" });
    res.end(latestMacYml);
    return;
  }

  if (pathname === `/${zipMeta.zipFileName}`) {
    if (zipMeta.mode === "real" && zipMeta.zipPath) {
      console.log(`  → Streaming real ZIP slowly ${zipMeta.zipPath}`);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(zipMeta.zipSize),
      });

      const stream = createReadStream(zipMeta.zipPath, {
        highWaterMark: CHUNK_SIZE,
      });
      const chunks = [];
      stream.on("data", (chunk) => {
        chunks.push(chunk);
      });
      stream.on("end", () => {
        const zipBuffer = Buffer.concat(chunks);
        streamBufferSlowly({
          req,
          res,
          totalSize: zipMeta.zipSize,
          readChunk(offset, size) {
            return zipBuffer.subarray(offset, offset + size);
          },
        });
      });
      stream.on("error", (error) => {
        console.error("  → Failed to read real ZIP", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
        }
        res.end("Failed to read ZIP");
      });
      return;
    }

    console.log(`  → Serving fake ${FAKE_ZIP_SIZE} byte ZIP (slow stream)`);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": String(FAKE_ZIP_SIZE),
    });

    const chunk = Buffer.alloc(CHUNK_SIZE, 0x00);
    streamBufferSlowly({
      req,
      res,
      totalSize: FAKE_ZIP_SIZE,
      readChunk(_offset, size) {
        return size < CHUNK_SIZE ? chunk.subarray(0, size) : chunk;
      },
    });
    return;
  }

  // Any .dmg download request — return 404
  if (pathname.endsWith(".dmg")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Mock server: use .zip for macOS");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Mock update server running at http://localhost:${PORT}`);
  console.log(`Serving version ${FAKE_VERSION} via latest-mac.yml`);
  console.log(`ZIP mode: ${zipMeta.mode}`);
  console.log(`ZIP file: ${zipMeta.zipFileName}`);
  console.log(`\nTo use: export NEXU_UPDATE_FEED_URL=http://localhost:${PORT}`);
});
