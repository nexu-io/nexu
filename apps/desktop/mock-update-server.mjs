/**
 * Mock update server for electron-updater (generic provider).
 * Serves latest-mac.yml with a fake version higher than the current app version.
 * Provides a slow fake .zip download to exercise the progress UI.
 *
 * Usage:  node apps/desktop/mock-update-server.mjs
 * Then:   NEXU_UPDATE_FEED_URL=http://localhost:8976 pnpm desktop:start
 */

import { createServer } from "node:http";

const PORT = 8976;
const FAKE_VERSION = "0.2.0";
const FAKE_ZIP_SIZE = 5_000_000; // 5 MB fake payload
const CHUNK_SIZE = 50_000; // 50 KB per chunk
const CHUNK_INTERVAL_MS = 100; // send a chunk every 100ms (~500 KB/s)

// Compute a deterministic fake sha512 (88 chars base64)
const fakeSha512 = Buffer.alloc(64, 0xab).toString("base64");

// electron-updater on macOS expects a .zip file in latest-mac.yml
const latestMacYml = `version: ${FAKE_VERSION}
files:
  - url: nexu-${FAKE_VERSION}-arm64-mac.zip
    sha512: ${fakeSha512}
    size: ${FAKE_ZIP_SIZE}
path: nexu-${FAKE_VERSION}-arm64-mac.zip
sha512: ${fakeSha512}
releaseDate: '2026-03-20T00:00:00.000Z'
releaseNotes: 'Mock update for UI testing'
`;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`${req.method} ${url.pathname}`);

  // CORS for Electron renderer
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (url.pathname === "/latest-mac.yml" || url.pathname === "/latest.yml") {
    res.writeHead(200, { "Content-Type": "text/yaml" });
    res.end(latestMacYml);
    return;
  }

  // Serve a slow fake .zip download to exercise the progress bar UI
  if (url.pathname.endsWith(".zip")) {
    console.log(`  → Serving fake ${FAKE_ZIP_SIZE} byte ZIP (slow stream)`);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": String(FAKE_ZIP_SIZE),
    });

    let sent = 0;
    const chunk = Buffer.alloc(CHUNK_SIZE, 0x00);

    const timer = setInterval(() => {
      if (sent >= FAKE_ZIP_SIZE) {
        clearInterval(timer);
        res.end();
        console.log(`  → Download complete (${sent} bytes)`);
        return;
      }
      const remaining = FAKE_ZIP_SIZE - sent;
      const toSend = remaining < CHUNK_SIZE ? remaining : CHUNK_SIZE;
      res.write(toSend < CHUNK_SIZE ? chunk.subarray(0, toSend) : chunk);
      sent += toSend;
    }, CHUNK_INTERVAL_MS);

    req.on("close", () => {
      clearInterval(timer);
    });
    return;
  }

  // Any .dmg download request — return 404
  if (url.pathname.endsWith(".dmg")) {
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
  console.log(`\nTo use: export NEXU_UPDATE_FEED_URL=http://localhost:${PORT}`);
});
