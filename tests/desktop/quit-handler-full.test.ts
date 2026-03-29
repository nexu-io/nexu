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
  // 2. Window close in packaged mode shows quit dialog (prevent default)
  // -------------------------------------------------------------------------
  it("prevents default and shows quit dialog in packaged mode", async () => {
    mockApp.isPackaged = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();

    expect(event.preventDefault).toHaveBeenCalled();
    // Dialog is shown asynchronously
    await flush();
    expect(mockDialog.showMessageBox).toHaveBeenCalledTimes(1);
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
  // 5. Dialog "cancel" (response=2) does nothing
  // -------------------------------------------------------------------------
  it("cancel response does nothing", async () => {
    mockDialog.showMessageBox.mockResolvedValue({ response: 2 });

    const opts = createQuitOpts();
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(opts as never);

    simulateClose();
    await flush();

    expect(mockWindow.hide).not.toHaveBeenCalled();
    expect(opts.onBeforeQuit).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. Dialog "run-in-background" (response=1) hides window
  // -------------------------------------------------------------------------
  it("run-in-background hides window", async () => {
    mockDialog.showMessageBox.mockResolvedValue({ response: 1 });

    const opts = createQuitOpts();
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(opts as never);

    simulateClose();
    await flush();

    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockTeardown).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. Dialog "quit-completely" (response=0) full teardown sequence
  // -------------------------------------------------------------------------
  it("quit-completely calls onBeforeQuit, webServer.close, teardown, exit", async () => {
    mockDialog.showMessageBox.mockResolvedValue({ response: 0 });

    const opts = createQuitOpts();
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(opts as never);

    simulateClose();
    await flush();

    expect(opts.onBeforeQuit).toHaveBeenCalledTimes(1);
    expect(opts.webServer.close).toHaveBeenCalledTimes(1);
    expect(mockTeardown).toHaveBeenCalledWith({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: "/tmp/test-plist",
    });
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  // -------------------------------------------------------------------------
  // 8. dialogOpen guard prevents re-entrant close
  // -------------------------------------------------------------------------
  it("prevents re-entrant close while dialog is open", async () => {
    // Make the dialog hang until we resolve it
    let resolveDialog!: (value: { response: number }) => void;
    mockDialog.showMessageBox.mockReturnValue(
      new Promise((resolve) => {
        resolveDialog = resolve;
      }),
    );

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    // First close triggers dialog
    const event1 = simulateClose();
    expect(event1.preventDefault).toHaveBeenCalled();

    // Allow microtask to start the dialog
    await flush();
    expect(mockDialog.showMessageBox).toHaveBeenCalledTimes(1);

    // Second close while dialog is open — should preventDefault but not show another dialog
    const event2 = simulateClose();
    expect(event2.preventDefault).toHaveBeenCalled();
    await flush();
    expect(mockDialog.showMessageBox).toHaveBeenCalledTimes(1); // Still just 1

    // Resolve the dialog
    resolveDialog({ response: 2 }); // cancel
    await flush();
  });

  // -------------------------------------------------------------------------
  // 9. before-quit in packaged mode prevents quit and shows window
  // -------------------------------------------------------------------------
  it("before-quit in packaged mode prevents quit and shows/closes window", async () => {
    mockApp.isPackaged = true;
    mockWindow.isVisible.mockReturnValue(false);

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.close).toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// getQuitDialogLocale (tested indirectly via showMessageBox call content)
// ---------------------------------------------------------------------------

describe("getQuitDialogLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeHandlers.length = 0;
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockApp.__nexuForceQuit = false;
    mockApp.isPackaged = true;
    mockTeardown.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // 12. Returns zh for zh-CN locale
  // -------------------------------------------------------------------------
  it("uses Chinese locale for zh-CN", async () => {
    mockApp.getLocale.mockReturnValue("zh-CN");
    mockDialog.showMessageBox.mockResolvedValue({ response: 2 }); // cancel

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    simulateClose();
    await flush();

    const dialogCall = mockDialog.showMessageBox.mock.calls[0][0];
    expect(dialogCall.title).toBe("\u9000\u51FA Nexu");
    expect(dialogCall.buttons).toContain("\u5B8C\u5168\u9000\u51FA");
  });

  // -------------------------------------------------------------------------
  // 13. Returns en for non-zh locale
  // -------------------------------------------------------------------------
  it("uses English locale for non-zh locale", async () => {
    mockApp.getLocale.mockReturnValue("en-US");
    mockDialog.showMessageBox.mockResolvedValue({ response: 2 }); // cancel

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    simulateClose();
    await flush();

    const dialogCall = mockDialog.showMessageBox.mock.calls[0][0];
    expect(dialogCall.title).toBe("Quit Nexu");
    expect(dialogCall.buttons).toContain("Quit Completely");
  });
});
