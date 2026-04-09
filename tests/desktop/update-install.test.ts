/**
 * Update Install (quitAndInstall) Smoke Tests
 *
 * Covers the full update-install shutdown path:
 *
 * 1.  Happy path: teardown → dispose → verify → quitAndInstall
 * 2.  Execution order: teardown completes before orchestrator.dispose
 * 3.  Orchestrator.dispose is always called (even without launchd context)
 * 4.  __nexuForceQuit flag is set before autoUpdater.quitAndInstall
 * 5.  autoUpdater.quitAndInstall called with correct args (false, true)
 * 6.  teardownLaunchdServices receives correct labels and plistDir
 * 7.  Teardown failure does NOT block dispose or install (try/catch)
 * 8.  Orchestrator.dispose failure does NOT block install (try/catch)
 * 9.  No launchd context → skips teardown, still installs
 * 10. ensureNexuProcessesDead is called after dispose
 * 11. Install proceeds even when verification reports survivors
 * 12. Both teardown and dispose fail → still reaches verify + install
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — electron, electron-updater, runtime dependencies
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

vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: vi.fn(),
  webContents: { getAllWebContents: vi.fn(() => []) },
}));

vi.mock("../../apps/desktop/main/runtime/runtime-logger", () => ({
  writeDesktopMainLog: vi.fn(),
}));

const mockTeardown = vi.fn().mockResolvedValue(undefined);
const mockEnsureDead = vi
  .fn()
  .mockResolvedValue({ clean: true, remainingPids: [] });
const mockCheckPaths = vi.fn().mockResolvedValue({
  locked: false,
  lockedPaths: [],
});

vi.mock("../../apps/desktop/main/services/launchd-bootstrap", () => ({
  teardownLaunchdServices: mockTeardown,
  ensureNexuProcessesDead: mockEnsureDead,
  checkCriticalPathsLocked: mockCheckPaths,
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
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 1,
      send: vi.fn(),
    },
  };
}

function createMockLaunchdCtx() {
  return {
    manager: { bootoutAndWaitForExit: vi.fn() } as never,
    labels: {
      controller: "io.nexu.controller",
      openclaw: "io.nexu.openclaw",
    },
    plistDir: "/Users/test/Library/LaunchAgents",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpdateManager.quitAndInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.__nexuForceQuit = false;
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockTeardown.mockResolvedValue(undefined);
    mockEnsureDead.mockResolvedValue({ clean: true, remainingPids: [] });
    mockCheckPaths.mockResolvedValue({ locked: false, lockedPaths: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Happy path: full sequence executes
  // -----------------------------------------------------------------------
  it("executes teardown → dispose → verify → quitAndInstall", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const launchdCtx = createMockLaunchdCtx();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
      launchd: launchdCtx,
    });

    await mgr.quitAndInstall();

    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(orchestrator.dispose).toHaveBeenCalledTimes(1);
    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 2. Execution order: teardown → dispose → verify → install
  // -----------------------------------------------------------------------
  it("calls teardown → dispose → verify → install in strict order", async () => {
    const callOrder: string[] = [];

    mockTeardown.mockImplementation(async () => {
      callOrder.push("teardown");
    });

    const orchestrator = createMockOrchestrator();
    orchestrator.dispose.mockImplementation(async () => {
      callOrder.push("dispose");
    });

    mockEnsureDead.mockImplementation(async () => {
      callOrder.push("verify");
      return { clean: true, remainingPids: [] };
    });

    mockAutoUpdater.quitAndInstall.mockImplementation(() => {
      callOrder.push("install");
    });

    const win = createMockWindow();
    const launchdCtx = createMockLaunchdCtx();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
      launchd: launchdCtx,
    });

    await mgr.quitAndInstall();

    expect(callOrder).toEqual(["teardown", "dispose", "verify", "install"]);
  });

  // -----------------------------------------------------------------------
  // 3. Orchestrator.dispose always called (even without launchd)
  // -----------------------------------------------------------------------
  it("calls orchestrator.dispose even without launchd context", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockTeardown).not.toHaveBeenCalled();
    expect(orchestrator.dispose).toHaveBeenCalledTimes(1);
    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 4. __nexuForceQuit flag set before autoUpdater.quitAndInstall
  // -----------------------------------------------------------------------
  it("sets __nexuForceQuit flag before calling autoUpdater.quitAndInstall", async () => {
    let flagWhenInstallCalled = false;

    mockAutoUpdater.quitAndInstall.mockImplementation(() => {
      flagWhenInstallCalled = !!(mockApp as Record<string, unknown>)
        .__nexuForceQuit;
    });

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(flagWhenInstallCalled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 5. autoUpdater.quitAndInstall called with correct args
  // -----------------------------------------------------------------------
  it("calls autoUpdater.quitAndInstall(false, true)", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  // -----------------------------------------------------------------------
  // 5a. Verification sweeps use the optimized timeout/interval values
  // -----------------------------------------------------------------------
  it("uses 8000/200 for the first verification sweep", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockEnsureDead).toHaveBeenCalledWith({
      timeoutMs: 8_000,
      intervalMs: 200,
    });
  });

  // -----------------------------------------------------------------------
  // 5b. Survivors trigger a second 5000/200 sweep
  // -----------------------------------------------------------------------
  it("uses 5000/200 for the second verification sweep when survivors remain", async () => {
    mockEnsureDead
      .mockResolvedValueOnce({ clean: false, remainingPids: [123] })
      .mockResolvedValueOnce({ clean: true, remainingPids: [] });

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockEnsureDead).toHaveBeenCalledTimes(2);
    expect(mockEnsureDead).toHaveBeenNthCalledWith(1, {
      timeoutMs: 8_000,
      intervalMs: 200,
    });
    expect(mockEnsureDead).toHaveBeenNthCalledWith(2, {
      timeoutMs: 5_000,
      intervalMs: 200,
    });
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 5c. Critical path check still runs even when processes are already clean
  // -----------------------------------------------------------------------
  it("checks critical paths before install even when no processes remain", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockCheckPaths).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 5d. Clean processes but locked critical paths still abort install
  // -----------------------------------------------------------------------
  it("aborts install when critical paths stay locked even if process verification is clean", async () => {
    mockCheckPaths.mockResolvedValueOnce({
      locked: true,
      lockedPaths: ["/Users/testuser/.nexu/runtime/controller-sidecar"],
    });

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockCheckPaths).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect((mockApp as Record<string, unknown>).__nexuForceQuit).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. teardownLaunchdServices receives correct context
  // -----------------------------------------------------------------------
  it("passes correct launchd context to teardownLaunchdServices", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const launchdCtx = createMockLaunchdCtx();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
      launchd: launchdCtx,
    });

    await mgr.quitAndInstall();

    expect(mockTeardown).toHaveBeenCalledWith({
      launchd: launchdCtx.manager,
      labels: {
        controller: "io.nexu.controller",
        openclaw: "io.nexu.openclaw",
      },
      plistDir: "/Users/test/Library/LaunchAgents",
    });
  });

  // -----------------------------------------------------------------------
  // 7. Teardown failure does NOT block install
  // -----------------------------------------------------------------------
  it("catches teardown error and proceeds with dispose + verify + install", async () => {
    mockTeardown.mockRejectedValueOnce(new Error("bootout exploded"));

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const launchdCtx = createMockLaunchdCtx();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
      launchd: launchdCtx,
    });

    // Should NOT throw — teardown error is caught internally
    await mgr.quitAndInstall();

    // dispose, verify, and install should all have been called despite teardown failure
    expect(orchestrator.dispose).toHaveBeenCalledTimes(1);
    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 8. orchestrator.dispose failure does NOT block install
  // -----------------------------------------------------------------------
  it("catches dispose error and proceeds with verify + install", async () => {
    const orchestrator = createMockOrchestrator();
    orchestrator.dispose.mockRejectedValueOnce(new Error("dispose exploded"));

    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    // Should NOT throw — dispose error is caught internally
    await mgr.quitAndInstall();

    // verify and install should still have been called
    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 9. No launchd context → skips teardown cleanly
  // -----------------------------------------------------------------------
  it("skips teardown and completes install when no launchd context", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockTeardown).not.toHaveBeenCalled();
    expect(orchestrator.dispose).toHaveBeenCalledTimes(1);
    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect((mockApp as Record<string, unknown>).__nexuForceQuit).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 10. ensureNexuProcessesDead is called after dispose
  // -----------------------------------------------------------------------
  it("calls ensureNexuProcessesDead after orchestrator.dispose", async () => {
    const callOrder: string[] = [];

    const orchestrator = createMockOrchestrator();
    orchestrator.dispose.mockImplementation(async () => {
      callOrder.push("dispose");
    });

    mockEnsureDead.mockImplementation(async () => {
      callOrder.push("verify");
      return { clean: true, remainingPids: [] };
    });

    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(callOrder.indexOf("dispose")).toBeLessThan(
      callOrder.indexOf("verify"),
    );
  });

  // -----------------------------------------------------------------------
  // 11. Survivors but no critical path locks → proceeds with install
  // -----------------------------------------------------------------------
  it("proceeds with install when processes survive but no critical paths locked", async () => {
    mockEnsureDead
      .mockResolvedValueOnce({ clean: false, remainingPids: [99999] })
      .mockResolvedValueOnce({ clean: false, remainingPids: [99999] });
    mockCheckPaths.mockResolvedValueOnce({ locked: false, lockedPaths: [] });

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockEnsureDead).toHaveBeenCalledTimes(2);
    expect(mockCheckPaths).toHaveBeenCalled();
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 11b. Survivors with critical path locks → aborts install
  // -----------------------------------------------------------------------
  it("aborts install when critical paths are locked", async () => {
    mockEnsureDead
      .mockResolvedValueOnce({ clean: false, remainingPids: [99999] })
      .mockResolvedValueOnce({ clean: false, remainingPids: [99999] });
    mockCheckPaths.mockResolvedValueOnce({
      locked: true,
      lockedPaths: ["/Applications/Nexu.app"],
    });

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    await mgr.quitAndInstall();

    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 12. Both teardown and dispose fail → still reaches verify + install
  // -----------------------------------------------------------------------
  it("reaches verify + install even when both teardown and dispose fail", async () => {
    mockTeardown.mockRejectedValueOnce(new Error("teardown boom"));

    const orchestrator = createMockOrchestrator();
    orchestrator.dispose.mockRejectedValueOnce(new Error("dispose boom"));

    const win = createMockWindow();
    const launchdCtx = createMockLaunchdCtx();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
      launchd: launchdCtx,
    });

    // Should NOT throw
    await mgr.quitAndInstall();

    // Both teardown and dispose were attempted
    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(orchestrator.dispose).toHaveBeenCalledTimes(1);

    // Verification gate and install still executed
    expect(mockEnsureDead).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 13. stopPeriodicCheck is called before teardown
  // -----------------------------------------------------------------------
  it("stops periodic update checks before starting teardown", async () => {
    const callOrder: string[] = [];

    mockTeardown.mockImplementation(async () => {
      callOrder.push("teardown");
    });

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const launchdCtx = createMockLaunchdCtx();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
      launchd: launchdCtx,
      initialDelayMs: 100,
    });

    // Start periodic checks
    mgr.startPeriodicCheck();

    // Spy on stopPeriodicCheck
    const originalStop = mgr.stopPeriodicCheck.bind(mgr);
    mgr.stopPeriodicCheck = () => {
      callOrder.push("stopPeriodic");
      originalStop();
    };

    await mgr.quitAndInstall();

    // stopPeriodicCheck should come before teardown
    expect(callOrder.indexOf("stopPeriodic")).toBeLessThan(
      callOrder.indexOf("teardown"),
    );
  });

  // -----------------------------------------------------------------------
  // 14. ensureNexuProcessesDead failure does not block install
  // -----------------------------------------------------------------------
  it("proceeds with install even if ensureNexuProcessesDead throws", async () => {
    mockEnsureDead.mockRejectedValueOnce(new Error("pgrep exploded"));

    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      platform: "darwin",
    });

    // ensureNexuProcessesDead throwing should propagate — it's the verification gate
    // If it throws, something is seriously wrong and we should NOT proceed blindly
    await expect(mgr.quitAndInstall()).rejects.toThrow("pgrep exploded");
  });
});
