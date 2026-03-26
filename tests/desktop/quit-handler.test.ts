/**
 * Quit Handler tests — covers quitWithDecision (the programmatic API).
 *
 * installLaunchdQuitHandler depends on real Electron BrowserWindow events
 * and dialog, so we test via quitWithDecision which exercises the same
 * teardown logic without needing a real window.
 *
 * 1. quit-completely: calls onBeforeQuit, closes webServer, teardown, exits
 * 2. quit-completely: sets __nexuForceQuit flag
 * 3. quit-completely: calls app.exit(0)
 * 4. quit-completely: continues even if onBeforeQuit throws
 * 5. quit-completely: continues even if webServer.close throws
 * 6. quit-completely: skips teardown if plistDir not set
 * 7. run-in-background: hides window, does NOT call teardown
 * 8. run-in-background: does NOT call app.exit
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApp = {
  isPackaged: true,
  getLocale: vi.fn(() => "en-US"),
  exit: vi.fn(),
  on: vi.fn(),
  __nexuForceQuit: false as unknown,
};

const mockWindow = {
  hide: vi.fn(),
  isVisible: vi.fn(() => true),
  show: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
};

vi.mock("electron", () => ({
  app: mockApp,
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow]),
  },
}));

const mockTeardown = vi.fn().mockResolvedValue(undefined);

vi.mock("../../apps/desktop/main/services/launchd-bootstrap", () => ({
  teardownLaunchdServices: mockTeardown,
}));

vi.mock("../../apps/desktop/main/services/launchd-manager", () => ({
  LaunchdManager: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQuitOpts(overrides?: Record<string, unknown>) {
  return {
    launchd: {} as never,
    labels: { controller: "io.nexu.controller", openclaw: "io.nexu.openclaw" },
    plistDir: "/tmp/test-plist",
    webServer: { close: vi.fn().mockResolvedValue(undefined) },
    onBeforeQuit: vi.fn().mockResolvedValue(undefined),
    onForceQuit: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("quitWithDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.__nexuForceQuit = false;
    mockTeardown.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // 1. quit-completely: full sequence
  // -----------------------------------------------------------------------
  it("quit-completely calls onBeforeQuit → webServer.close → teardown → exit", async () => {
    const opts = createQuitOpts();

    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("quit-completely", opts as never);

    expect(opts.onBeforeQuit).toHaveBeenCalledTimes(1);
    expect(opts.webServer.close).toHaveBeenCalledTimes(1);
    expect(mockTeardown).toHaveBeenCalledWith({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: "/tmp/test-plist",
    });
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -----------------------------------------------------------------------
  // 2. quit-completely: sets __nexuForceQuit
  // -----------------------------------------------------------------------
  it("quit-completely sets __nexuForceQuit before exit", async () => {
    let flagWhenExitCalled = false;
    mockApp.exit.mockImplementation(() => {
      flagWhenExitCalled = !!(mockApp as Record<string, unknown>)
        .__nexuForceQuit;
    });

    const opts = createQuitOpts();
    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("quit-completely", opts as never);

    expect(flagWhenExitCalled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 3. quit-completely: calls app.exit(0)
  // -----------------------------------------------------------------------
  it("quit-completely calls app.exit(0)", async () => {
    const opts = createQuitOpts();
    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("quit-completely", opts as never);

    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -----------------------------------------------------------------------
  // 4. quit-completely: continues even if onBeforeQuit throws
  // -----------------------------------------------------------------------
  it("quit-completely proceeds if onBeforeQuit throws", async () => {
    const opts = createQuitOpts({
      onBeforeQuit: vi.fn().mockRejectedValue(new Error("flush failed")),
    });

    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("quit-completely", opts as never);

    // Should still teardown and exit
    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -----------------------------------------------------------------------
  // 5. quit-completely: continues even if webServer.close throws
  // -----------------------------------------------------------------------
  it("quit-completely proceeds if webServer.close throws", async () => {
    const opts = createQuitOpts({
      webServer: {
        close: vi.fn().mockRejectedValue(new Error("close failed")),
      },
    });

    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("quit-completely", opts as never);

    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -----------------------------------------------------------------------
  // 6. quit-completely: skips teardown if no plistDir
  // -----------------------------------------------------------------------
  it("quit-completely skips teardown when plistDir is not set", async () => {
    const opts = createQuitOpts({ plistDir: undefined });

    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("quit-completely", opts as never);

    expect(mockTeardown).not.toHaveBeenCalled();
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -----------------------------------------------------------------------
  // 7. run-in-background: hides window, no teardown
  // -----------------------------------------------------------------------
  it("run-in-background hides window and does NOT call teardown", async () => {
    const opts = createQuitOpts();

    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("run-in-background", opts as never);

    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockTeardown).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 8. run-in-background: does NOT set __nexuForceQuit
  // -----------------------------------------------------------------------
  it("run-in-background does NOT set __nexuForceQuit", async () => {
    const opts = createQuitOpts();

    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("run-in-background", opts as never);

    expect((mockApp as Record<string, unknown>).__nexuForceQuit).toBe(false);
  });
});
