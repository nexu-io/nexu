/**
 * UpdateManager Full Coverage Tests
 *
 * Covers all remaining uncovered code paths beyond quitAndInstall (update-install.test.ts)
 * and feed URL resolution (update-manager.test.ts):
 *
 *  - bindEvents: all 6 autoUpdater event callbacks
 *  - checkNow: success, same version, error, dedup, reset
 *  - downloadUpdate: delegates to autoUpdater
 *  - startPeriodicCheck / stopPeriodicCheck: timer lifecycle
 *  - setChannel / setSource: reconfigures feed URL
 *  - configureFeedUrl: generic vs github provider
 *  - send: forwards to main window + webviews, skips destroyed
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAutoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  forceDevUpdateConfig: false,
  on: vi.fn(),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
};

vi.mock("electron-updater", () => ({
  autoUpdater: mockAutoUpdater,
}));

const mockApp = {
  isPackaged: true,
  getVersion: vi.fn(() => "0.2.0"),
  __nexuForceQuit: false as unknown,
};

const mockGetAllWebContents = vi.fn(
  () =>
    [] as Array<{
      id: number;
      isDestroyed: () => boolean;
      send: ReturnType<typeof vi.fn>;
    }>,
);

vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: vi.fn(),
  webContents: { getAllWebContents: mockGetAllWebContents },
}));

const mockWriteDesktopMainLog = vi.fn();

vi.mock("../../apps/desktop/main/runtime/runtime-logger", () => ({
  writeDesktopMainLog: mockWriteDesktopMainLog,
}));

const mockTeardown = vi.fn().mockResolvedValue(undefined);
const mockEnsureDead = vi
  .fn()
  .mockResolvedValue({ clean: true, remainingPids: [] });

vi.mock("../../apps/desktop/main/services/launchd-bootstrap", () => ({
  teardownLaunchdServices: mockTeardown,
  ensureNexuProcessesDead: mockEnsureDead,
}));

vi.mock("../../apps/desktop/main/services/launchd-manager", () => ({
  LaunchdManager: vi.fn(),
}));

vi.mock("../../apps/desktop/main/updater/component-updater", () => ({
  R2_BASE_URL: "https://desktop-releases.nexu.io",
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockOrchestrator() {
  return {
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWindow() {
  return {
    id: 1,
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 1,
      send: vi.fn(),
    },
  };
}

type EventHandlers = Record<string, (...args: unknown[]) => void>;

function extractHandlers(): EventHandlers {
  const handlers: EventHandlers = {};
  for (const call of mockAutoUpdater.on.mock.calls) {
    handlers[call[0] as string] = call[1] as (...args: unknown[]) => void;
  }
  return handlers;
}

async function createManager(
  winOverride?: ReturnType<typeof createMockWindow>,
  options?: Record<string, unknown>,
) {
  const win = winOverride ?? createMockWindow();
  const orchestrator = createMockOrchestrator();
  const { UpdateManager } = await import(
    "../../apps/desktop/main/updater/update-manager"
  );
  const mgr = new UpdateManager(win as never, orchestrator as never, {
    channel: "stable",
    feedUrl: null,
    platform: "darwin",
    ...options,
  });
  return { mgr, win, orchestrator };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockApp.__nexuForceQuit = false;
  mockApp.getVersion.mockReturnValue("0.2.0");
  mockGetAllWebContents.mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// bindEvents
// ===========================================================================

describe("bindEvents", () => {
  it("registers all 6 event handlers on autoUpdater", async () => {
    await createManager();

    const eventNames = mockAutoUpdater.on.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(eventNames).toContain("checking-for-update");
    expect(eventNames).toContain("update-available");
    expect(eventNames).toContain("update-not-available");
    expect(eventNames).toContain("download-progress");
    expect(eventNames).toContain("update-downloaded");
    expect(eventNames).toContain("error");
  });

  it("logs that the update feed was configured", async () => {
    await createManager();

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("update feed configured"),
      }),
    );
  });

  it("auto-download: user-initiated checks surface available state", async () => {
    let resolveCheck!: (value: unknown) => void;
    mockAutoUpdater.checkForUpdates.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const { mgr, win } = await createManager(undefined, { autoDownload: true });
    const handlers = extractHandlers();

    const checkPromise = mgr.checkNow({ userInitiated: true });
    handlers["update-available"]({
      version: "1.0.0",
      releaseDate: "2026-03-20",
      releaseNotes: "Bug fixes",
    });
    resolveCheck({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    await checkPromise;

    expect(win.webContents.send).toHaveBeenCalledWith(
      "update:available",
      expect.objectContaining({
        version: "1.0.0",
        diagnostic: expect.objectContaining({ remoteVersion: "1.0.0" }),
      }),
    );
  });

  it("auto-download: background checks stay silent", async () => {
    let resolveCheck!: (value: unknown) => void;
    mockAutoUpdater.checkForUpdates.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const { mgr, win } = await createManager(undefined, { autoDownload: true });
    const handlers = extractHandlers();

    const checkPromise = mgr.checkNow();
    handlers["update-available"]({
      version: "1.0.0",
      releaseDate: "2026-03-20",
      releaseNotes: "Bug fixes",
    });
    resolveCheck({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    await checkPromise;

    expect(win.webContents.send).not.toHaveBeenCalledWith(
      "update:available",
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // checking-for-update
  // -------------------------------------------------------------------------

  it("checking-for-update: calls logCheck and sends update:checking", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["checking-for-update"]();

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "auto-update",
        stream: "system",
        kind: "app",
        message: expect.stringContaining(
          "update check event: checking for update",
        ),
      }),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "update:checking",
      expect.objectContaining({
        channel: "stable",
        source: "r2",
        currentVersion: "0.2.0",
      }),
    );
  });

  // -------------------------------------------------------------------------
  // update-available
  // -------------------------------------------------------------------------

  it("update-available: sends version, releaseNotes (string), and diagnostic", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-available"]({
      version: "1.0.0",
      releaseDate: "2026-03-20",
      releaseNotes: "Bug fixes and improvements",
    });

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("update available"),
      }),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "update:available",
      expect.objectContaining({
        version: "1.0.0",
        releaseNotes: "Bug fixes and improvements",
        diagnostic: expect.objectContaining({
          remoteVersion: "1.0.0",
          remoteReleaseDate: "2026-03-20",
        }),
      }),
    );
  });

  it("update-available: releaseNotes is undefined when info.releaseNotes is an array", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-available"]({
      version: "1.0.0",
      releaseDate: "2026-03-20",
      releaseNotes: [{ version: "1.0.0", note: "something" }],
    });

    const sendCall = win.webContents.send.mock.calls.find(
      (call: unknown[]) => call[0] === "update:available",
    );
    expect(sendCall).toBeDefined();
    expect(
      (sendCall?.[1] as Record<string, unknown>).releaseNotes,
    ).toBeUndefined();
  });

  it("update-available: releaseNotes is undefined when info.releaseNotes is missing", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-available"]({
      version: "1.0.0",
      releaseDate: "2026-03-20",
    });

    const sendCall = win.webContents.send.mock.calls.find(
      (call: unknown[]) => call[0] === "update:available",
    );
    expect(
      (sendCall?.[1] as Record<string, unknown>).releaseNotes,
    ).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // update-not-available
  // -------------------------------------------------------------------------

  it("update-not-available: sends update:up-to-date with diagnostic", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-not-available"]({
      version: "0.2.0",
      releaseDate: "2026-03-15",
    });

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("update not available"),
      }),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "update:up-to-date",
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          remoteVersion: "0.2.0",
          remoteReleaseDate: "2026-03-15",
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // download-progress
  // -------------------------------------------------------------------------

  it("download-progress: throttles logs but keeps first and 100% progress", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000);

    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["download-progress"]({
      percent: 1,
      bytesPerSecond: 1024000,
      transferred: 5000000,
      total: 12000000,
    });
    handlers["download-progress"]({
      percent: 2,
      bytesPerSecond: 1024000,
      transferred: 5100000,
      total: 12000000,
    });
    handlers["download-progress"]({
      percent: 4,
      bytesPerSecond: 1024000,
      transferred: 5200000,
      total: 12000000,
    });
    handlers["download-progress"]({
      percent: 100,
      bytesPerSecond: 1024000,
      transferred: 12000000,
      total: 12000000,
    });

    const progressLogs = mockWriteDesktopMainLog.mock.calls
      .map(([entry]) => entry as { message?: string })
      .filter((entry) => entry.message?.includes("download progress"));

    expect(progressLogs).toHaveLength(2);
    expect(progressLogs[0]?.message).toContain("download progress 1%");
    expect(progressLogs[1]?.message).toContain("download progress 100%");
    expect(win.webContents.send).toHaveBeenLastCalledWith("update:progress", {
      percent: 100,
      bytesPerSecond: 1024000,
      transferred: 12000000,
      total: 12000000,
    });
  });

  // -------------------------------------------------------------------------
  // update-downloaded
  // -------------------------------------------------------------------------

  it("update-downloaded: sends version", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-downloaded"]({ version: "1.0.0" });

    expect(win.webContents.send).toHaveBeenCalledWith("update:downloaded", {
      version: "1.0.0",
    });
    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("update event: downloaded"),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // error
  // -------------------------------------------------------------------------

  it("error: sends error message and diagnostic", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers.error(new Error("Network timeout"));

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("update error: Network timeout"),
      }),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      "update:error",
      expect.objectContaining({
        message: "Network timeout",
        diagnostic: expect.objectContaining({
          channel: "stable",
          source: "r2",
        }),
      }),
    );
  });
});

// ===========================================================================
// checkNow
// ===========================================================================

describe("checkNow", () => {
  it("returns { updateAvailable: true } when remote version differs", async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    const { mgr } = await createManager();
    const result = await mgr.checkNow();

    expect(result).toEqual({ updateAvailable: true });
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("returns { updateAvailable: false } when remote version matches current", async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "0.2.0", releaseDate: "2026-03-15" },
    });

    const { mgr } = await createManager();
    const result = await mgr.checkNow();

    expect(result).toEqual({ updateAvailable: false });
  });

  it("logs when a check is skipped because one is already in progress", async () => {
    let resolveCheck!: (
      value: { updateInfo: { version: string; releaseDate: string } } | null,
    ) => void;
    mockAutoUpdater.checkForUpdates.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const { mgr } = await createManager();
    const firstCheck = mgr.checkNow();
    void mgr.checkNow();
    resolveCheck({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    await firstCheck;

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "update check skipped: already in progress",
        ),
      }),
    );
  });

  it("returns { updateAvailable: false } when checkForUpdates returns null", async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null);

    const { mgr } = await createManager();
    const result = await mgr.checkNow();

    expect(result).toEqual({ updateAvailable: false });
  });

  it("returns { updateAvailable: false } on error", async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue(
      new Error("DNS resolution failed"),
    );

    const { mgr } = await createManager();
    const result = await mgr.checkNow();

    expect(result).toEqual({ updateAvailable: false });
    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("check failed: DNS resolution failed"),
      }),
    );
  });

  it("logs non-Error thrown values as strings", async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue("string error");

    const { mgr } = await createManager();
    await mgr.checkNow();

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("check failed: string error"),
      }),
    );
  });

  it("deduplicates concurrent calls (only one checkForUpdates)", async () => {
    let resolveCheck!: (value: unknown) => void;
    mockAutoUpdater.checkForUpdates.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const { mgr } = await createManager();
    const promise1 = mgr.checkNow();
    const promise2 = mgr.checkNow();

    resolveCheck({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1).toEqual({ updateAvailable: true });
    expect(result2).toEqual({ updateAvailable: true });

    // Only one actual check was made despite two calls
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("resets checkInProgress after completion (allows new check)", async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    const { mgr } = await createManager();

    await mgr.checkNow();
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // Second call should trigger a new check (not dedup)
    await mgr.checkNow();
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("resets checkInProgress after error (allows retry)", async () => {
    mockAutoUpdater.checkForUpdates
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValueOnce({
        updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
      });

    const { mgr } = await createManager();

    const first = await mgr.checkNow();
    expect(first).toEqual({ updateAvailable: false });

    const second = await mgr.checkNow();
    expect(second).toEqual({ updateAvailable: true });
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("logs check result with diagnostic on success", async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "1.0.0", releaseDate: "2026-03-20" },
    });

    const { mgr } = await createManager();
    await mgr.checkNow();

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "update check result: update available",
        ),
      }),
    );
  });
});

// ===========================================================================
// downloadUpdate
// ===========================================================================

describe("downloadUpdate", () => {
  it("calls autoUpdater.downloadUpdate and returns { ok: true }", async () => {
    mockAutoUpdater.downloadUpdate.mockResolvedValue(undefined);

    const { mgr } = await createManager();
    const result = await mgr.downloadUpdate();

    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it("surfaces cached progress immediately when switching from background to foreground", async () => {
    mockAutoUpdater.downloadUpdate.mockResolvedValue(undefined);

    const { mgr, win } = await createManager(undefined, { autoDownload: true });
    const handlers = extractHandlers();

    handlers["update-available"]({
      version: "0.3.0",
      releaseDate: "2026-04-10T00:00:00Z",
    });
    handlers["download-progress"]({
      percent: 61,
      bytesPerSecond: 1024,
      transferred: 610,
      total: 1000,
    });

    await mgr.downloadUpdate();

    expect(win.webContents.send).toHaveBeenCalledWith("update:progress", {
      percent: 61,
      bytesPerSecond: 1024,
      transferred: 610,
      total: 1000,
    });
  });
});

// ===========================================================================
// startPeriodicCheck / stopPeriodicCheck
// ===========================================================================

describe("startPeriodicCheck", () => {
  it("starts checking after initialDelayMs then at checkIntervalMs", async () => {
    vi.useFakeTimers();
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "0.2.0", releaseDate: "2026-03-15" },
    });

    const { mgr } = await createManager(undefined, {
      initialDelayMs: 1000,
      checkIntervalMs: 5000,
    });

    mgr.startPeriodicCheck();

    // Before initial delay: no check
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

    // After initial delay: first check fires
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // After one interval: second check
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);

    // After another interval: third check
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it("calling startPeriodicCheck twice after timer is set is a no-op", async () => {
    vi.useFakeTimers();
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "0.2.0", releaseDate: "2026-03-15" },
    });

    const { mgr } = await createManager(undefined, {
      initialDelayMs: 1000,
      checkIntervalMs: 5000,
    });

    mgr.startPeriodicCheck();

    // Advance past initial delay so the timer is created
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // Second call after timer exists should be a no-op
    mgr.startPeriodicCheck();

    // Advance one interval — should still only get the interval check, not doubled
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});

describe("stopPeriodicCheck", () => {
  it("clears the interval and prevents further checks", async () => {
    vi.useFakeTimers();
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: "0.2.0", releaseDate: "2026-03-15" },
    });

    const { mgr } = await createManager(undefined, {
      initialDelayMs: 1000,
      checkIntervalMs: 5000,
    });

    mgr.startPeriodicCheck();

    // Fire initial delay + first check
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // Stop periodic checks
    mgr.stopPeriodicCheck();

    // Advance past when next check would have fired
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("is safe to call when no timer exists", async () => {
    const { mgr } = await createManager();

    // Should not throw
    expect(() => mgr.stopPeriodicCheck()).not.toThrow();
  });
});

// ===========================================================================
// setChannel / setSource
// ===========================================================================

describe("setChannel", () => {
  it("reconfigures feed URL with new channel", async () => {
    const { mgr } = await createManager();

    // Clear calls from constructor
    mockAutoUpdater.setFeedURL.mockClear();

    mgr.setChannel("nightly");

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: expect.stringContaining("/nightly/"),
    });
  });
});

describe("setSource", () => {
  it("reconfigures feed URL to github provider when source is github", async () => {
    const { mgr } = await createManager();

    mockAutoUpdater.setFeedURL.mockClear();

    mgr.setSource("github");

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "nexu-io",
      repo: "nexu",
    });
  });

  it("reconfigures feed URL to generic provider when source is r2", async () => {
    // Start with github, then switch back to r2
    const { mgr } = await createManager(undefined, { source: "github" });

    mockAutoUpdater.setFeedURL.mockClear();

    mgr.setSource("r2");

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: expect.stringContaining("desktop-releases.nexu.io"),
    });
  });
});

// ===========================================================================
// configureFeedUrl
// ===========================================================================

describe("configureFeedUrl (via constructor)", () => {
  it("sets generic provider for R2 source", async () => {
    mockAutoUpdater.setFeedURL.mockClear();

    await createManager(undefined, { source: "r2", channel: "stable" });

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: expect.stringContaining("desktop-releases.nexu.io/stable/"),
    });
  });

  it("sets github provider when resolved feed URL is github://", async () => {
    mockAutoUpdater.setFeedURL.mockClear();

    await createManager(undefined, { source: "github", channel: "stable" });

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "nexu-io",
      repo: "nexu",
    });
  });

  it("uses explicit feedUrl over default resolution", async () => {
    mockAutoUpdater.setFeedURL.mockClear();

    await createManager(undefined, {
      source: "r2",
      channel: "stable",
      feedUrl: "https://custom.example.com/updates",
    });

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://custom.example.com/updates",
    });
  });
});

// ===========================================================================
// send
// ===========================================================================

describe("send (via event handlers)", () => {
  it("sends to main window webContents", async () => {
    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-downloaded"]({ version: "1.0.0" });

    expect(win.webContents.send).toHaveBeenCalledWith("update:downloaded", {
      version: "1.0.0",
    });
  });

  it("forwards events to webview webContents", async () => {
    const webviewSend = vi.fn();
    mockGetAllWebContents.mockReturnValue([
      { id: 1, isDestroyed: () => false, send: vi.fn() }, // main window (same id)
      { id: 2, isDestroyed: () => false, send: webviewSend }, // webview
    ]);

    const { win } = await createManager();
    const handlers = extractHandlers();

    handlers["update-downloaded"]({ version: "1.0.0" });

    // Main window receives via win.webContents.send
    expect(win.webContents.send).toHaveBeenCalledWith("update:downloaded", {
      version: "1.0.0",
    });
    // Webview also receives
    expect(webviewSend).toHaveBeenCalledWith("update:downloaded", {
      version: "1.0.0",
    });
  });

  it("does not send to destroyed webview", async () => {
    const destroyedSend = vi.fn();
    mockGetAllWebContents.mockReturnValue([
      { id: 1, isDestroyed: () => false, send: vi.fn() },
      { id: 2, isDestroyed: () => true, send: destroyedSend },
    ]);

    await createManager();
    const handlers = extractHandlers();

    handlers["update-downloaded"]({ version: "1.0.0" });

    expect(destroyedSend).not.toHaveBeenCalled();
  });

  it("skips all sends when main window is destroyed", async () => {
    const webviewSend = vi.fn();
    mockGetAllWebContents.mockReturnValue([
      { id: 2, isDestroyed: () => false, send: webviewSend },
    ]);

    const win = createMockWindow();
    win.isDestroyed.mockReturnValue(true);

    await createManager(win);
    const handlers = extractHandlers();

    handlers["update-downloaded"]({ version: "1.0.0" });

    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(webviewSend).not.toHaveBeenCalled();
  });

  it("does not double-send to main window webContents when it appears in getAllWebContents", async () => {
    const mainSend = vi.fn();
    const win = createMockWindow();
    win.webContents.send = mainSend;

    // getAllWebContents includes the main window (id 1) and a webview (id 2)
    const webviewSend = vi.fn();
    mockGetAllWebContents.mockReturnValue([
      { id: 1, isDestroyed: () => false, send: vi.fn() }, // same id as main
      { id: 2, isDestroyed: () => false, send: webviewSend },
    ]);

    await createManager(win);
    const handlers = extractHandlers();

    handlers["update-downloaded"]({ version: "1.0.0" });

    // Main window gets exactly one send (via win.webContents.send, not via the loop)
    expect(mainSend).toHaveBeenCalledTimes(1);
    // Webview gets one send
    expect(webviewSend).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Constructor defaults
// ===========================================================================

describe("constructor", () => {
  it("sets autoDownload to false by default", async () => {
    mockAutoUpdater.autoDownload = true; // reset
    await createManager();
    expect(mockAutoUpdater.autoDownload).toBe(false);
  });

  it("sets autoDownload to true when option is provided", async () => {
    await createManager(undefined, { autoDownload: true });
    expect(mockAutoUpdater.autoDownload).toBe(true);
  });

  it("sets autoInstallOnAppQuit to true", async () => {
    mockAutoUpdater.autoInstallOnAppQuit = false;
    await createManager();
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it("sets forceDevUpdateConfig based on app.isPackaged", async () => {
    mockApp.isPackaged = false;
    await createManager();
    expect(mockAutoUpdater.forceDevUpdateConfig).toBe(true);

    mockApp.isPackaged = true;
    await createManager();
    expect(mockAutoUpdater.forceDevUpdateConfig).toBe(false);
  });

  it("defaults source to r2 and channel to stable", async () => {
    mockAutoUpdater.setFeedURL.mockClear();
    await createManager(undefined, {});

    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: expect.stringContaining("desktop-releases.nexu.io/stable/"),
    });
  });

  it("exposes a non-in-app capability on Windows without binding autoUpdater", async () => {
    const { mgr } = await createManager(undefined, { platform: "win32" });

    expect(mgr.getCapability()).toEqual({
      platform: "win32",
      check: true,
      downloadMode: "in-app",
      applyMode: "external-installer",
      applyLabel: "Install",
      notes: null,
    });
    expect(mockAutoUpdater.on).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// logCheck (via event handlers — window destroy edge case)
// ===========================================================================

describe("logCheck edge case", () => {
  it("passes null windowId when window is destroyed", async () => {
    const win = createMockWindow();
    win.isDestroyed.mockReturnValue(true);

    await createManager(win);
    const handlers = extractHandlers();

    handlers["checking-for-update"]();

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: null,
      }),
    );
  });

  it("passes window id when window is alive", async () => {
    const win = createMockWindow();
    win.isDestroyed.mockReturnValue(false);

    await createManager(win);
    const handlers = extractHandlers();

    handlers["checking-for-update"]();

    expect(mockWriteDesktopMainLog).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: 1,
      }),
    );
  });
});
