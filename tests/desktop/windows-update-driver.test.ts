import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const tempDir = join(tmpdir(), `nexu-windows-update-driver-${Date.now()}`);

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "temp" ? tempDir : tempDir),
    quit: vi.fn(),
  },
}));

import {
  WindowsUpdateDriver,
  compareDesktopVersionsForTests,
  resolveWindowsManifestUrlForTests,
} from "../../apps/desktop/main/updater/windows-update-driver";

describe("windows update driver", () => {
  it("reuses an existing installer when sha256 matches", async () => {
    mkdirSync(tempDir, { recursive: true });
    const payload = Buffer.from("verified-installer");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const installerPath = join(tempDir, "nexu-setup-0.1.1.exe");
    writeFileSync(installerPath, payload);

    const onDownloaded = vi.fn();
    const driver = new WindowsUpdateDriver({
      currentVersion: "0.1.0",
      autoDownload: false,
      openExternal: vi.fn(),
      writeLog: vi.fn(),
    });
    driver.configure({ source: "r2", channel: "stable", feedUrl: null });
    driver.bindEvents({
      onChecking: vi.fn(),
      onAvailable: vi.fn(),
      onUnavailable: vi.fn(),
      onProgress: vi.fn(),
      onDownloaded,
      onError: vi.fn(),
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "0.1.1",
        channel: "stable",
        platform: "win32",
        arch: "x64",
        releaseDate: "2026-04-10T00:00:00Z",
        installer: {
          url: "http://localhost/installer.exe",
          sha256,
          size: payload.length,
        },
      }),
      status: 200,
      statusText: "OK",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await driver.checkForUpdates();
      const result = await driver.downloadUpdate();

      expect(result).toEqual({ ok: true });
      expect(onDownloaded).toHaveBeenCalledWith(
        expect.objectContaining({ version: "0.1.1" }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves the default nightly manifest URL", () => {
    expect(
      resolveWindowsManifestUrlForTests({
        source: "r2",
        channel: "nightly",
        feedUrl: null,
      }),
    ).toBe(
      "https://desktop-releases.nexu.io/nightly/win32/x64/latest-win.json",
    );
  });

  it("maps github source to a machine-readable Windows manifest", () => {
    expect(
      resolveWindowsManifestUrlForTests({
        source: "github",
        channel: "stable",
        feedUrl: null,
      }),
    ).toBe("https://desktop-releases.nexu.io/stable/win32/x64/latest-win.json");
  });

  it("compares desktop prerelease versions correctly", () => {
    expect(
      compareDesktopVersionsForTests(
        "0.1.10-nightly.20260409",
        "0.1.10-nightly.20260408",
      ),
    ).toBeGreaterThan(0);
    expect(
      compareDesktopVersionsForTests("0.1.10", "0.1.10-nightly.20260408"),
    ).toBeGreaterThan(0);
    expect(
      compareDesktopVersionsForTests("0.1.10-beta.1", "0.1.10-beta.1"),
    ).toBe(0);
  });

  it("checks manifest and downloads installer in-app", async () => {
    const payload = Buffer.from("windows-installer-payload");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const requestUrls: string[] = [];
    const server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404).end();
        return;
      }
      requestUrls.push(req.url);
      if (req.url === "/installer.exe") {
        res.writeHead(200, {
          "Content-Length": String(payload.length),
          "Content-Type": "application/octet-stream",
        });
        res.end(payload);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected test server to bind to a TCP port");
    }
    const installerUrl = `http://127.0.0.1:${address.port}/installer.exe`;

    const onChecking = vi.fn();
    const onAvailable = vi.fn();
    const onDownloaded = vi.fn();
    const onUnavailable = vi.fn();

    const driver = new WindowsUpdateDriver({
      currentVersion: "0.1.10-nightly.20260408",
      autoDownload: false,
      openExternal: vi.fn().mockResolvedValue(undefined),
      writeLog: vi.fn(),
    });
    driver.configure({
      source: "r2",
      channel: "nightly",
      feedUrl:
        "https://desktop-releases.nexu.io/nightly/win32/x64/latest-win.json",
    });
    driver.bindEvents({
      onChecking,
      onAvailable,
      onUnavailable,
      onProgress: vi.fn(),
      onDownloaded,
      onError: vi.fn(),
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "0.1.10-nightly.20260409",
        channel: "nightly",
        platform: "win32",
        arch: "x64",
        releaseDate: "2026-04-09T00:00:00Z",
        installer: {
          url: installerUrl,
          sha256,
          size: payload.length,
        },
      }),
      status: 200,
      statusText: "OK",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const result = await driver.checkForUpdates();
      expect(result.updateAvailable).toBe(true);
      expect(onChecking).toHaveBeenCalledTimes(1);
      expect(onAvailable).toHaveBeenCalledWith(
        expect.objectContaining({
          version: "0.1.10-nightly.20260409",
          actionUrl: installerUrl,
        }),
      );

      await expect(driver.downloadUpdate()).resolves.toEqual({ ok: true });
      expect(onDownloaded).toHaveBeenCalledWith(
        expect.objectContaining({ version: "0.1.10-nightly.20260409" }),
      );
      expect(requestUrls).toEqual(["/installer.exe"]);
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("does not start a second download while one is in progress", async () => {
    const payload = Buffer.from("dedupe-download-payload");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    let downloadRequests = 0;
    let releaseResponse: (() => void) | null = null;
    let signalRequestStarted: (() => void) | null = null;
    const requestStarted = new Promise<void>((resolve) => {
      signalRequestStarted = resolve;
    });
    const server = createServer((req, res) => {
      if (req.url !== "/installer.exe") {
        res.writeHead(404).end();
        return;
      }
      downloadRequests += 1;
      signalRequestStarted?.();
      res.writeHead(200, {
        "Content-Length": String(payload.length),
        "Content-Type": "application/octet-stream",
      });
      releaseResponse = () => {
        res.end(payload);
      };
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected test server to bind to a TCP port");
    }
    const installerUrl = `http://127.0.0.1:${address.port}/installer.exe`;

    const driver = new WindowsUpdateDriver({
      currentVersion: "0.1.10-nightly.20260408",
      autoDownload: false,
      openExternal: vi.fn().mockResolvedValue(undefined),
      writeLog: vi.fn(),
    });
    driver.configure({
      source: "r2",
      channel: "nightly",
      feedUrl:
        "https://desktop-releases.nexu.io/nightly/win32/x64/latest-win.json",
    });
    driver.bindEvents({
      onChecking: vi.fn(),
      onAvailable: vi.fn(),
      onUnavailable: vi.fn(),
      onProgress: vi.fn(),
      onDownloaded: vi.fn(),
      onError: vi.fn(),
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "0.1.10-nightly.20260409",
        channel: "nightly",
        platform: "win32",
        arch: "x64",
        releaseDate: "2026-04-09T00:00:00Z",
        installer: {
          url: installerUrl,
          sha256,
          size: payload.length,
        },
      }),
      status: 200,
      statusText: "OK",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await driver.checkForUpdates();
      const first = driver.downloadUpdate();
      const second = driver.downloadUpdate();
      await requestStarted;
      releaseResponse?.();
      await expect(Promise.all([first, second])).resolves.toEqual([
        { ok: true },
        { ok: true },
      ]);
      expect(downloadRequests).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("emits onError when manifest fetch fails", async () => {
    const onError = vi.fn();
    const driver = new WindowsUpdateDriver({
      currentVersion: "0.1.10",
      autoDownload: false,
      openExternal: vi.fn().mockResolvedValue(undefined),
      writeLog: vi.fn(),
    });
    driver.configure({
      source: "r2",
      channel: "stable",
      feedUrl:
        "https://desktop-releases.nexu.io/stable/win32/x64/latest-win.json",
    });
    driver.bindEvents({
      onChecking: vi.fn(),
      onAvailable: vi.fn(),
      onUnavailable: vi.fn(),
      onProgress: vi.fn(),
      onDownloaded: vi.fn(),
      onError,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await expect(driver.checkForUpdates()).rejects.toThrow(
        "Windows update manifest request failed: 503 Service Unavailable",
      );
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Windows update manifest request failed: 503 Service Unavailable",
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
