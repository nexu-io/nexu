import { describe, expect, it, vi } from "vitest";
import {
  WindowsUpdateDriver,
  compareDesktopVersionsForTests,
  resolveWindowsManifestUrlForTests,
} from "../../apps/desktop/main/updater/windows-update-driver";

describe("windows update driver", () => {
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

  it("checks manifest and opens installer externally", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const onChecking = vi.fn();
    const onAvailable = vi.fn();
    const onUnavailable = vi.fn();

    const driver = new WindowsUpdateDriver({
      currentVersion: "0.1.10-nightly.20260408",
      autoDownload: false,
      openExternal,
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
          url: "https://desktop-releases.nexu.io/nightly/win32/x64/nexu-latest-nightly-win-x64.exe",
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
          actionUrl:
            "https://desktop-releases.nexu.io/nightly/win32/x64/nexu-latest-nightly-win-x64.exe",
        }),
      );

      await driver.downloadUpdate();
      expect(openExternal).toHaveBeenCalledWith(
        "https://desktop-releases.nexu.io/nightly/win32/x64/nexu-latest-nightly-win-x64.exe",
      );
      expect(onUnavailable).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
