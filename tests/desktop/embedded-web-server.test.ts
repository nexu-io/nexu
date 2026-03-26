/**
 * Embedded Web Server tests — routing, proxying, auth mock, SPA fallback.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type EmbeddedWebServer,
  startEmbeddedWebServer,
} from "../../apps/desktop/main/services/embedded-web-server";

describe("EmbeddedWebServer", () => {
  let server: EmbeddedWebServer;
  let baseUrl: string;
  let webRoot: string;
  const TEST_PORT = 51777;

  beforeAll(async () => {
    webRoot = mkdtempSync(join(tmpdir(), "nexu-web-test-"));
    writeFileSync(join(webRoot, "index.html"), "<html><body>SPA</body></html>");
    mkdirSync(join(webRoot, "assets"), { recursive: true });
    writeFileSync(join(webRoot, "assets", "style.css"), "body { color: red; }");

    server = await startEmbeddedWebServer({
      port: TEST_PORT,
      webRoot,
      controllerPort: 59999, // no controller running — proxy will fail
    });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await server?.close();
  });

  it("returns mock desktop session for /api/auth/get-session", async () => {
    const res = await fetch(`${baseUrl}/api/auth/get-session`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.user.id).toBe("desktop-local-user");
    expect(body.user.email).toBe("desktop@nexu.local");
    expect(body.session.id).toBe("desktop-local-session");
  });

  it("serves static files with correct MIME type", async () => {
    const res = await fetch(`${baseUrl}/assets/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css");

    const body = await res.text();
    expect(body).toBe("body { color: red; }");
  });

  it("falls back to index.html for unknown routes (SPA)", async () => {
    const res = await fetch(`${baseUrl}/some/deep/route`);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain("SPA");
  });

  it("returns 502 when proxying to unavailable controller", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(502);
  });

  it("handles CORS preflight", async () => {
    const res = await fetch(`${baseUrl}/api/test`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });

  it("prevents path traversal", async () => {
    const res = await fetch(`${baseUrl}/../../../etc/passwd`);
    // Should either serve index.html (SPA fallback) or 403, not the actual file
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.text();
      expect(body).toContain("SPA"); // SPA fallback, not /etc/passwd
    }
  });
});
