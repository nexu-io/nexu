/**
 * Quit Handler full coverage tests — covers installLaunchdQuitHandler,
 * showQuitDialog (via close handler), getQuitDialogLocale, and
 * before-quit event handling.
 *
 * 1. installLaunchdQuitHandler attaches close handler to main window
 * 2. Window close in packaged mode shows quit dialog (prevent default)
 * 3. Window close in dev mode does NOT show dialog (allows close)
 * 4. Force-quit flag (__nexuForceQuit=true) bypasses dialog
 * 5. Dialog "cancel" does nothing
 * 6. Dialog "run-in-background" hides window
 * 7. Dialog "quit-completely" calls onBeforeQuit -> webServer.close -> teardown -> exit
 * 8. dialogOpen guard prevents re-entrant close
 * 9. before-quit handler in packaged mode prevents quit and shows window
 * 10. before-quit in dev mode allows quit
 * 11. before-quit with __nexuForceQuit allows quit
 * 12. getQuitDialogLocale returns zh for zh-CN locale
 * 13. getQuitDialogLocale returns en for non-zh locale
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTeardown = vi.fn().mockResolvedValue(undefined);

vi.mock("../../apps/desktop/main/services/launchd-bootstrap", () => ({
  teardownLaunchdServices: mockTeardown,
}));

vi.mock("../../apps/desktop/main/services/launchd-manager", () => ({
  LaunchdManager: vi.fn(),
}));

const mockApp = {
  isPackaged: true,
  getLocale: vi.fn(() => "en-US"),
  exit: vi.fn(),
  on: vi.fn(),
  __nexuForceQuit: false as unknown,
};

const mockDialog = {
  showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
};

const mockGetAllWindows = vi.fn(() => [mockWindow]);

// Capture close handlers via EventEmitter-like on()
const closeHandlers: Array<(event: { preventDefault: () => void }) => void> =
  [];
const mockWindow = {
  on: vi.fn(
    (event: string, handler: (e: { preventDefault: () => void }) => void) => {
      if (event === "close") closeHandlers.push(handler);
    },
  ),
  hide: vi.fn(),
  isVisible: vi.fn(() => true),
  show: vi.fn(),
  close: vi.fn(),
};

vi.mock("electron", () => ({
  app: mockApp,
  dialog: mockDialog,
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQuitOpts(overrides?: Record<string, unknown>) {
  return {
    launchd: {} as never,
    labels: { controller: "io.nexu.controller", openclaw: "io.nexu.openclaw" },
    plistDir: "/tmp/test-plist",
    webServer: {
      close: vi.fn().mockResolvedValue(undefined),
      port: 50810,
    },
    onBeforeQuit: vi.fn().mockResolvedValue(undefined),
    onForceQuit: vi.fn(),
    ...overrides,
  };
}

/** Simulate a window close event and return the mock event object */
function simulateClose() {
  const event = { preventDefault: vi.fn() };
  const handler = closeHandlers[closeHandlers.length - 1];
  if (!handler) throw new Error("No close handler registered");
  handler(event);
  return event;
}

/** Flush microtasks / promises */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Get the before-quit handler that was registered via app.on("before-quit", ...) */
function getBeforeQuitHandler(): (event: {
  preventDefault: () => void;
}) => void {
  const call = mockApp.on.mock.calls.find(
    (c: unknown[]) => c[0] === "before-quit",
  );
  if (!call) throw new Error("No before-quit handler registered");
  return call[1] as (event: { preventDefault: () => void }) => void;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("installLaunchdQuitHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeHandlers.length = 0;
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockApp.__nexuForceQuit = false;
    mockApp.isPackaged = true;
    mockApp.getLocale.mockReturnValue("en-US");
    mockDialog.showMessageBox.mockResolvedValue({ response: 0 });
    mockTeardown.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // 1. Attaches close handler to main window
  // -------------------------------------------------------------------------
  it("attaches close handler to main window", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    expect(mockWindow.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(closeHandlers).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 2. Window close in packaged mode hides to background (no dialog)
  // -------------------------------------------------------------------------
  it("hides window to background on close in packaged mode", async () => {
    mockApp.isPackaged = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    // No dialog, no teardown, no exit
    expect(mockTeardown).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. Window close in dev mode prevents default, runs teardown, and exits
  // -------------------------------------------------------------------------
  it("runs teardown and exits in dev mode without dialog", async () => {
    mockApp.isPackaged = false;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();
    installLaunchdQuitHandler(opts as never);

    const event = simulateClose();

    // Dev mode now prevents default to run async teardown
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    // No dialog shown in dev mode
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
    // Teardown should have been called
    expect(mockTeardown).toHaveBeenCalled();
    // App should exit after teardown
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // 4. Force-quit flag bypasses dialog
  // -------------------------------------------------------------------------
  it("bypasses dialog when __nexuForceQuit is true", async () => {
    mockApp.__nexuForceQuit = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();

    expect(event.preventDefault).not.toHaveBeenCalled();
    await flush();
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Multiple window closes just hide repeatedly (no state leak)
  // -------------------------------------------------------------------------
  it("repeated window close just hides each time", async () => {
    mockApp.isPackaged = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    simulateClose();
    simulateClose();

    expect(mockWindow.hide).toHaveBeenCalledTimes(2);
    expect(mockTeardown).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. before-quit (Cmd+Q) in packaged mode does full teardown
  // -------------------------------------------------------------------------
  it("before-quit in packaged mode runs teardown and exits", async () => {
    mockApp.isPackaged = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();
    installLaunchdQuitHandler(opts as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // 10. before-quit in packaged mode with no window tears down and exits
  // -------------------------------------------------------------------------
  it("before-quit in packaged mode with no window tears down and exits", async () => {
    mockApp.isPackaged = true;
    mockGetAllWindows.mockReturnValue([]);

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();
    installLaunchdQuitHandler(opts as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(opts.onBeforeQuit).toHaveBeenCalledTimes(1);
    expect(opts.webServer.close).toHaveBeenCalledTimes(1);
    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // 11. before-quit in dev mode teardowns then exits
  // -------------------------------------------------------------------------
  it("before-quit in dev mode prevents default and runs teardown", async () => {
    mockApp.isPackaged = false;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    // Dev mode now prevents default to do async teardown before exiting
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    expect(mockTeardown).toHaveBeenCalledTimes(1);
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // 12. before-quit with __nexuForceQuit allows quit
  // -------------------------------------------------------------------------
  it("before-quit with __nexuForceQuit allows quit", async () => {
    mockApp.__nexuForceQuit = true;
    mockApp.isPackaged = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
