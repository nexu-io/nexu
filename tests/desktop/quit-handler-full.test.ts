import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDeleteRuntimePorts = vi.fn().mockResolvedValue(undefined);
const mockTeardownLaunchdServices = vi.fn().mockResolvedValue(undefined);

vi.mock("../../apps/desktop/main/services/launchd-bootstrap", () => ({
  deleteRuntimePorts: mockDeleteRuntimePorts,
  teardownLaunchdServices: mockTeardownLaunchdServices,
}));

const mockApp = {
  isPackaged: true,
  exit: vi.fn(),
  on: vi.fn(),
  __nexuForceQuit: false as unknown,
};

const closeHandlers: Array<(event: { preventDefault: () => void }) => void> =
  [];
const mockWindow = {
  on: vi.fn(
    (event: string, handler: (e: { preventDefault: () => void }) => void) => {
      if (event === "close") {
        closeHandlers.push(handler);
      }
    },
  ),
  hide: vi.fn(),
};

const mockGetAllWindows = vi.fn(() => [mockWindow]);

vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
}));

function createQuitOpts(overrides?: Record<string, unknown>) {
  return {
    launchd: {
      bootoutService: vi.fn().mockResolvedValue(undefined),
      waitForExit: vi.fn().mockResolvedValue(undefined),
    } as never,
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

function simulateClose() {
  const event = { preventDefault: vi.fn() };
  const handler = closeHandlers[closeHandlers.length - 1];
  if (!handler) {
    throw new Error("No close handler registered");
  }
  handler(event);
  return event;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getBeforeQuitHandler(): (event: {
  preventDefault: () => void;
}) => void {
  const call = mockApp.on.mock.calls.find(
    (c: unknown[]) => c[0] === "before-quit",
  );
  if (!call) {
    throw new Error("No before-quit handler registered");
  }
  return call[1] as (event: { preventDefault: () => void }) => void;
}

describe("installLaunchdQuitHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeHandlers.length = 0;
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockApp.__nexuForceQuit = false;
    mockApp.isPackaged = true;
    mockDeleteRuntimePorts.mockResolvedValue(undefined);
    mockTeardownLaunchdServices.mockResolvedValue(undefined);
  });

  it("attaches close handler to main window", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    expect(mockWindow.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(closeHandlers).toHaveLength(1);
  });

  it("hides window to background on close in packaged mode", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();

    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockDeleteRuntimePorts).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  it("runs teardown and exits on close in dev mode", async () => {
    mockApp.isPackaged = false;
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();

    installLaunchdQuitHandler(opts as never);

    const event = simulateClose();
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();

    expect(opts.onBeforeQuit).toHaveBeenCalledTimes(1);
    expect(opts.webServer.close).toHaveBeenCalledTimes(1);
    expect(mockTeardownLaunchdServices).toHaveBeenCalledWith({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: "/tmp/test-plist",
    });
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  it("respects onRunInBackground override on packaged close", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const onRunInBackground = vi.fn().mockResolvedValue({ handled: true });
    const opts = createQuitOpts({
      onRunInBackground,
    });
    installLaunchdQuitHandler(opts as never);

    simulateClose();
    await flush();

    expect(onRunInBackground).toHaveBeenCalledTimes(1);
    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
  });

  it("bypasses handlers when __nexuForceQuit is true", async () => {
    mockApp.__nexuForceQuit = true;
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();
    expect(event.preventDefault).not.toHaveBeenCalled();
    await flush();

    expect(mockWindow.hide).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  it("before-quit in packaged mode runs teardown and exits", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();
    installLaunchdQuitHandler(opts as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(opts.onForceQuit).toHaveBeenCalledTimes(1);
    expect(mockTeardownLaunchdServices).toHaveBeenCalledWith({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: "/tmp/test-plist",
    });
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  it("before-quit in dev mode also runs teardown and exits", async () => {
    mockApp.isPackaged = false;
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();
    installLaunchdQuitHandler(opts as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockTeardownLaunchdServices).toHaveBeenCalledWith({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: "/tmp/test-plist",
    });
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  it("before-quit with __nexuForceQuit allows quit", async () => {
    mockApp.__nexuForceQuit = true;
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

describe("quitWithDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockApp.__nexuForceQuit = false;
  });

  it("hides the window for run-in-background", async () => {
    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    await quitWithDecision("run-in-background", createQuitOpts() as never);

    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  it("runs teardown and exits for quit-completely", async () => {
    const { quitWithDecision } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    const opts = createQuitOpts();
    await quitWithDecision("quit-completely", opts as never);

    expect(mockTeardownLaunchdServices).toHaveBeenCalledWith({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: "/tmp/test-plist",
    });
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });
});
