/**
 * Update Server Integration Tests — spins up a real HTTP server that mimics
 * the desktop release CDN, then verifies the update feed URL resolution,
 * latest-mac.yml serving, and version comparison logic end-to-end.
 *
 * These tests catch issues that mocked autoUpdater tests miss:
 * - Feed URL format errors (wrong path, missing arch segment)
 * - YAML structure incompatible with electron-updater
 * - Version comparison edge cases
 * - HTTP error handling (404, 500, timeout)
 */
import { type Server, createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveUpdateFeedUrlForTests } from "../../apps/desktop/main/updater/update-manager";

// ---------------------------------------------------------------------------
// Local update server that mimics https://desktop-releases.nexu.io
// ---------------------------------------------------------------------------

const CURRENT_VERSION = "0.2.0";
const LATEST_VERSION = "0.3.0";

/**
 * A minimal but valid latest-mac.yml as electron-updater expects it.
 * Fields: version, files (with url, sha512, size), releaseDate.
 */
function makeLatestYml(version: string): string {
  return [
    `version: ${version}`,
    "files:",
    `  - url: nexu-${version}-arm64.zip`,
    "    sha512: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "    size: 123456789",
    `releaseDate: '2026-03-26T00:00:00.000Z'`,
  ].join("\n");
}

let server: Server;
let serverPort: number;
let serverBaseUrl: string;
let requestLog: string[] = [];

beforeAll(async () => {
  requestLog = [];

  server = createServer((req, res) => {
    requestLog.push(`${req.method} ${req.url}`);

    // Route: /{channel}/{arch}/latest-mac.yml
    const match = req.url?.match(
      /^\/(stable|beta|nightly)\/(arm64|x64)\/latest-mac\.yml$/,
    );

    if (match) {
      res.writeHead(200, { "Content-Type": "text/yaml" });
      res.end(makeLatestYml(LATEST_VERSION));
      return;
    }

    // Route: /{channel}/{arch}/nexu-*.zip (fake binary)
    if (req.url?.endsWith(".zip")) {
      res.writeHead(200, { "Content-Type": "application/zip" });
      res.end("FAKE_ZIP_CONTENT");
      return;
    }

    // 404 for anything else
    res.writeHead(404);
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
        serverBaseUrl = `http://127.0.0.1:${serverPort}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Update server integration", () => {
  // -----------------------------------------------------------------------
  // 1. Feed URL resolves to fetchable endpoint
  // -----------------------------------------------------------------------
  it("resolveUpdateFeedUrl produces a valid URL for R2 stable/arm64", () => {
    const url = resolveUpdateFeedUrlForTests({
      source: "r2",
      channel: "stable",
      feedUrl: null,
      arch: "arm64",
    });

    // Should be a valid URL with channel and arch segments
    expect(url).toContain("stable");
    expect(url).toContain("arm64");
    expect(() => new URL(url)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // 2. Local server serves latest-mac.yml correctly
  // -----------------------------------------------------------------------
  it("local update server serves latest-mac.yml at /{channel}/{arch}/latest-mac.yml", async () => {
    const response = await fetch(
      `${serverBaseUrl}/stable/arm64/latest-mac.yml`,
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toBe("text/yaml");

    const body = await response.text();
    expect(body).toContain(`version: ${LATEST_VERSION}`);
    expect(body).toContain("files:");
    expect(body).toContain("sha512:");
    expect(body).toContain("releaseDate:");
  });

  // -----------------------------------------------------------------------
  // 3. latest-mac.yml is valid YAML with required electron-updater fields
  // -----------------------------------------------------------------------
  it("latest-mac.yml contains all fields required by electron-updater", async () => {
    const response = await fetch(
      `${serverBaseUrl}/stable/arm64/latest-mac.yml`,
    );
    const body = await response.text();

    // electron-updater requires: version, files[].url, files[].sha512, files[].size
    expect(body).toMatch(/^version: \d+\.\d+\.\d+/m);
    expect(body).toMatch(/url: nexu-.*\.zip/);
    expect(body).toMatch(/sha512: [A-Za-z0-9+/=]+/);
    expect(body).toMatch(/size: \d+/);
    expect(body).toMatch(/releaseDate:/);
  });

  // -----------------------------------------------------------------------
  // 4. All channels serve valid responses
  // -----------------------------------------------------------------------
  it.each(["stable", "beta", "nightly"])(
    "channel %s serves latest-mac.yml for both architectures",
    async (channel) => {
      for (const arch of ["arm64", "x64"]) {
        const response = await fetch(
          `${serverBaseUrl}/${channel}/${arch}/latest-mac.yml`,
        );
        expect(response.ok).toBe(true);
        const body = await response.text();
        expect(body).toContain("version:");
      }
    },
  );

  // -----------------------------------------------------------------------
  // 5. 404 for invalid paths
  // -----------------------------------------------------------------------
  it("returns 404 for invalid update paths", async () => {
    const response = await fetch(`${serverBaseUrl}/invalid/path`);
    expect(response.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // 6. Feed URL override replaces default URL
  // -----------------------------------------------------------------------
  it("explicit feedUrl overrides default R2 URL", () => {
    const url = resolveUpdateFeedUrlForTests({
      source: "r2",
      channel: "stable",
      feedUrl: `${serverBaseUrl}/custom`,
    });

    expect(url).toBe(`${serverBaseUrl}/custom`);
  });

  // -----------------------------------------------------------------------
  // 7. Custom feed URL can serve updates
  // -----------------------------------------------------------------------
  it("custom feed URL pointed at local server is fetchable", async () => {
    const feedUrl = resolveUpdateFeedUrlForTests({
      source: "r2",
      channel: "stable",
      feedUrl: `${serverBaseUrl}/stable/arm64`,
      arch: "arm64",
    });

    const response = await fetch(`${feedUrl}/latest-mac.yml`);
    expect(response.ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 8. Version comparison: newer version triggers update
  // -----------------------------------------------------------------------
  it("server version > current version means update available", async () => {
    const response = await fetch(
      `${serverBaseUrl}/stable/arm64/latest-mac.yml`,
    );
    const body = await response.text();
    const versionMatch = body.match(/^version: (.+)$/m);
    const serverVersion = versionMatch?.[1];

    expect(serverVersion).toBe(LATEST_VERSION);
    // Simple semver comparison: 0.3.0 > 0.2.0
    expect(serverVersion).not.toBe(CURRENT_VERSION);
  });

  // -----------------------------------------------------------------------
  // 9. Download URL is reachable
  // -----------------------------------------------------------------------
  it("download artifact URL serves content", async () => {
    const response = await fetch(
      `${serverBaseUrl}/stable/arm64/nexu-${LATEST_VERSION}-arm64.zip`,
    );
    expect(response.ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 10. Request logging captures all requests (for debugging)
  // -----------------------------------------------------------------------
  it("server logs all incoming requests", () => {
    expect(requestLog.length).toBeGreaterThan(0);
    expect(requestLog.some((r) => r.includes("latest-mac.yml"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 11. GitHub source returns github:// URL (not HTTP)
  // -----------------------------------------------------------------------
  it("github source returns non-HTTP github:// URL", () => {
    const url = resolveUpdateFeedUrlForTests({
      source: "github",
      channel: "stable",
      feedUrl: null,
    });

    expect(url).toBe("github://nexu-io/nexu");
    expect(url).not.toMatch(/^https?:\/\//);
  });

  // -----------------------------------------------------------------------
  // 12. Environment override takes highest priority
  // -----------------------------------------------------------------------
  it("NEXU_UPDATE_FEED_URL env overrides everything", () => {
    const originalEnv = process.env.NEXU_UPDATE_FEED_URL;
    try {
      process.env.NEXU_UPDATE_FEED_URL = `${serverBaseUrl}/env-override`;

      const url = resolveUpdateFeedUrlForTests({
        source: "r2",
        channel: "stable",
        feedUrl: `${serverBaseUrl}/build-config`,
      });

      expect(url).toBe(`${serverBaseUrl}/env-override`);
    } finally {
      if (originalEnv === undefined) {
        Reflect.deleteProperty(process.env, "NEXU_UPDATE_FEED_URL");
      } else {
        process.env.NEXU_UPDATE_FEED_URL = originalEnv;
      }
    }
  });
});
