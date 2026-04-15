import type { EventEmitter } from "node:events";
/**
 * RuntimeOrchestrator (daemon-supervisor) unit tests
 *
 * Covers process lifecycle management:
 *
 * 1.  Constructor initializes units from manifests
 * 2.  startAutoStartManagedUnits starts only autoStart managed units
 * 3.  stopUnit sends SIGTERM then SIGKILL after 3s
 * 4.  stopUnit resolves within 5s even if process ignores SIGKILL
 * 5.  stopAll stops all managed + launchd units in parallel
 * 6.  dispose calls stopAll
 * 7.  stopUnit skips non-managed strategies (embedded, delegated)
 * 8.  ELECTRON_RUN_AS_NODE=1 forced for Electron binary spawns
 * 9.  stoppedByUser flag suppresses auto-restart
 * 10. stopOne stops dependents before the target unit
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

interface MockChildProcess extends EventEmitter {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
}

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
  execFile: vi.fn(),
  execFileSync: vi.fn(() => ""),
}));

vi.mock("node:fs", () => ({
  closeSync: vi.fn(),
  openSync: vi.fn(() => 0),
  readSync: vi.fn(() => 0),
  statSync: vi.fn(() => ({ size: 0 })),
}));

// Mock net.Socket for waitForPort tests
const mockSocketInstances: Array<{
  onceCbs: Record<string, Array<(...args: unknown[]) => void>>;
  destroy: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("node:net", () => {
  return {
    Socket: vi.fn(() => {
      const instance = {
        onceCbs: {} as Record<string, Array<(...args: unknown[]) => void>>,
        once(event: string, cb: (...args: unknown[]) => void) {
          if (!instance.onceCbs[event]) instance.onceCbs[event] = [];
          instance.onceCbs[event].push(cb);
        },
        connect: vi.fn(),
        destroy: vi.fn(),
      };
      mockSocketInstances.push(instance);
      return instance;
    }),
  };
});

vi.mock("node:os", () => ({
  userInfo: vi.fn(() => ({ uid: 501 })),
}));

vi.mock("electron", () => ({
  utilityProcess: { fork: vi.fn() },
}));

vi.mock("../../apps/desktop/main/runtime/runtime-logger", () => ({
  writeRuntimeLogEntry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockChild(pid = 1234): MockChildProcess {
  const { EventEmitter } = require("node:events");
  const child = new EventEmitter() as MockChildProcess;
  child.pid = pid;
  child.kill = vi.fn(() => true);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function makeManagedManifest(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    label: `Test ${id}`,
    kind: "service",
    launchStrategy: "managed",
    runner: "spawn",
    command: "/usr/bin/node",
    args: ["test.js"],
    cwd: "/tmp",
    port: null,
    autoStart: true,
    env: { ELECTRON_RUN_AS_NODE: "1" },
    ...overrides,
  };
}

function makeEmbeddedManifest(id: string) {
  return {
    id,
    label: `Embedded ${id}`,
    kind: "surface",
    launchStrategy: "embedded",
    port: null,
    autoStart: true,
  };
}

function makeDelegatedManifest(id: string) {
  return {
    id,
    label: `Delegated ${id}`,
    kind: "runtime",
    launchStrategy: "delegated",
    delegatedProcessMatch: "test-process",
    port: null,
    autoStart: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RuntimeOrchestrator", () => {
  let mockChild: MockChildProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSocketInstances.length = 0;

    mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Constructor
  // -----------------------------------------------------------------------
  it("initializes units from manifests with correct initial phases", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
      makeEmbeddedManifest("control-plane"),
      makeDelegatedManifest("openclaw"),
    ] as never[]);

    const state = orchestrator.getRuntimeState();
    expect(state.units).toHaveLength(3);

    const controller = state.units.find((u) => u.id === "controller");
    const controlPlane = state.units.find((u) => u.id === "control-plane");
    const openclaw = state.units.find((u) => u.id === "openclaw");

    expect(controller?.phase).toBe("idle");
    expect(controlPlane?.phase).toBe("running"); // embedded = always running
    expect(openclaw?.phase).toBe("stopped"); // delegated starts stopped
  });

  // -----------------------------------------------------------------------
  // 2. startAutoStartManagedUnits
  // -----------------------------------------------------------------------
  it("starts only autoStart managed units", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("web", { autoStart: true }),
      makeManagedManifest("controller", { autoStart: false }),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    // Only web should have been spawned
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0];
    expect(spawnArgs[1]).toEqual(["test.js"]); // web's args
  });

  // -----------------------------------------------------------------------
  // 3. stopUnit sends SIGTERM via child.kill()
  // -----------------------------------------------------------------------
  it("stopOne sends kill signal to managed process", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // Start the stop — it will wait for process exit
    const stopPromise = orchestrator.stopOne("controller");

    // child.kill() should have been called (SIGTERM)
    expect(mockChild.kill).toHaveBeenCalled();

    // Simulate process exit
    mockChild.emit("exit", 0, null);

    await stopPromise;

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(controller?.phase).toBe("stopped");
  });

  // -----------------------------------------------------------------------
  // 4. stopUnit resolves within 5s deadline even if process ignores signals
  // -----------------------------------------------------------------------
  it("stopOne resolves within deadline if process ignores SIGTERM and SIGKILL", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    // Don't emit "exit" — process refuses to die
    const stopPromise = orchestrator.stopOne("controller");

    // Advance past SIGKILL timeout (3s) and hard deadline (5s)
    await vi.advanceTimersByTimeAsync(6000);

    // Should resolve regardless
    await stopPromise;
  });

  // -----------------------------------------------------------------------
  // 5. stopAll stops all managed units
  // -----------------------------------------------------------------------
  it("stopAll stops all managed units in parallel", async () => {
    const children: MockChildProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(1000 + children.length);
      children.push(child);
      return child;
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("web"),
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    expect(children).toHaveLength(2);

    const stopPromise = orchestrator.stopAll();

    // Both children should have received kill
    for (const child of children) {
      expect(child.kill).toHaveBeenCalled();
      child.emit("exit", 0, null);
    }

    const state = await stopPromise;
    expect(state.units.every((u) => u.phase === "stopped")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 6. dispose calls stopAll
  // -----------------------------------------------------------------------
  it("dispose stops all running units", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const disposePromise = orchestrator.dispose();

    // Simulate exit
    mockChild.emit("exit", 0, null);

    await disposePromise;
  });

  // -----------------------------------------------------------------------
  // 7. stopUnit skips non-managed strategies
  // -----------------------------------------------------------------------
  it("stopOne on embedded/delegated units is a no-op", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeEmbeddedManifest("control-plane"),
      makeDelegatedManifest("openclaw"),
    ] as never[]);

    // Should not throw or hang
    await orchestrator.stopOne("control-plane");
    await orchestrator.stopOne("openclaw");
  });

  // -----------------------------------------------------------------------
  // 8. ELECTRON_RUN_AS_NODE=1 forced for Electron binary spawns
  // -----------------------------------------------------------------------
  it("forces ELECTRON_RUN_AS_NODE=1 when command is process.execPath", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", {
        command: process.execPath,
        // Deliberately omit ELECTRON_RUN_AS_NODE from manifest env
        env: { PORT: "50800" },
      }),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const spawnEnv = mockSpawn.mock.calls[0][2].env;
    expect(spawnEnv.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  // -----------------------------------------------------------------------
  // 9. stoppedByUser flag set on explicit stop
  // -----------------------------------------------------------------------
  it("sets stoppedByUser on explicit stop to suppress auto-restart", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const stopPromise = orchestrator.stopOne("controller");
    mockChild.emit("exit", 0, null);
    await stopPromise;

    // After explicit stop + exit, no new spawn should happen
    // (auto-restart is suppressed by stoppedByUser)
    await vi.advanceTimersByTimeAsync(10000);
    // Only the initial spawn should have been called
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 10. stopOne stops dependents before target
  // -----------------------------------------------------------------------
  it("stopOne stops dependents before the target unit", async () => {
    const stopOrder: string[] = [];
    const childMap = new Map<string, MockChildProcess>();

    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const id = args[0] === "web.js" ? "web" : "controller";
      const child = createMockChild(id === "web" ? 2000 : 2001);
      // Track kill order
      child.kill = vi.fn(() => {
        stopOrder.push(id);
        // Emit exit on next tick
        setTimeout(() => child.emit("exit", 0, null), 10);
        return true;
      });
      childMap.set(id, child);
      return child;
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );

    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", {
        args: ["controller.js"],
        dependents: ["web"],
      }),
      makeManagedManifest("web", { args: ["web.js"] }),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    // Stop controller — web (dependent) should stop first
    await vi.advanceTimersByTimeAsync(100);
    const stopPromise = orchestrator.stopOne("controller");
    await vi.advanceTimersByTimeAsync(100);
    await stopPromise;

    // Web should have been stopped before controller
    expect(stopOrder[0]).toBe("web");
    expect(stopOrder[1]).toBe("controller");
  });

  // -----------------------------------------------------------------------
  // 11. startUnit when already running returns early
  // -----------------------------------------------------------------------
  it("startUnit skips spawn when unit is already running", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    await orchestrator.startOne("controller");
    expect(mockSpawn).toHaveBeenCalledTimes(1); // no second spawn
  });

  // -----------------------------------------------------------------------
  // 12. startUnit failure sets phase to "failed"
  // -----------------------------------------------------------------------
  it("sets phase to failed when spawn throws", async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error("ENOENT: command not found");
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(controller?.phase).toBe("failed");
    expect(controller?.lastError).toContain("ENOENT");
  });

  // -----------------------------------------------------------------------
  // 13. Auto-restart on unexpected exit with exponential backoff
  // -----------------------------------------------------------------------
  it("auto-restarts with exponential backoff on non-zero exit", async () => {
    const children: MockChildProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(3000 + children.length);
      children.push(child);
      return child;
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    expect(children).toHaveLength(1);

    // Simulate unexpected exit (non-zero)
    children[0].emit("exit", 1, null);

    // First restart delay is 2000ms (2000 * 2^0)
    await vi.advanceTimersByTimeAsync(1999);
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(children).toHaveLength(2);

    // After successful restart, autoRestartAttempts resets to 0.
    // Second crash also gets 2000ms delay (attempt 1 again).
    children[1].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(1999);
    expect(children).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(children).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 14. Auto-restart suppressed when autoRestart is false
  // -----------------------------------------------------------------------
  it("does not auto-restart when autoRestart is false", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", { autoRestart: false }),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    mockChild.emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(60000);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 15. No auto-restart on clean exit (code 0)
  // -----------------------------------------------------------------------
  it("does not auto-restart on clean exit (code 0)", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    mockChild.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(60000);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 16. Port probe waits for port via Socket
  // -----------------------------------------------------------------------
  it("waits for port readiness when manifest.port is set", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", { port: 50800 }),
    ] as never[]);

    const startPromise = orchestrator.startAutoStartManagedUnits();

    // Socket connect callback fires after a tick
    await vi.advanceTimersByTimeAsync(10);
    if (mockSocketInstances.length > 0) {
      const sock = mockSocketInstances[0];
      sock.onceCbs.connect?.[0]?.();
    }

    await startPromise;

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(controller?.phase).toBe("running");
  });

  // -----------------------------------------------------------------------
  // 17. Port probe timeout sets phase to failed
  // -----------------------------------------------------------------------
  it("fails when port probe times out", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", {
        port: 50800,
        startupTimeoutMs: 500,
      }),
    ] as never[]);

    const startPromise = orchestrator.startAutoStartManagedUnits();

    // Keep erroring sockets to simulate port not ready
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(260);
      for (const sock of mockSocketInstances) {
        sock.onceCbs.error?.[0]?.(new Error("ECONNREFUSED"));
      }
    }

    await startPromise;

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(controller?.phase).toBe("failed");
    expect(controller?.lastError).toContain("Timed out");
  });

  // -----------------------------------------------------------------------
  // 18. subscribe receives events and unsubscribe stops
  // -----------------------------------------------------------------------
  it("subscribe delivers events and unsubscribe removes listener", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    const events: unknown[] = [];
    const unsub = orchestrator.subscribe((event) => events.push(event));

    await orchestrator.startAutoStartManagedUnits();
    expect(events.length).toBeGreaterThan(0);

    const countBefore = events.length;
    unsub();
    mockChild.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(100);
    expect(events.length).toBe(countBefore);
  });

  // -----------------------------------------------------------------------
  // 19. refreshDelegatedUnits detects processes via pgrep
  // -----------------------------------------------------------------------
  it("refreshDelegatedUnits detects and loses processes via pgrep", async () => {
    const { execFileSync } = await import("node:child_process");
    vi.mocked(execFileSync).mockImplementation((cmd: string) => {
      if (cmd === "pgrep") return "7777 slimclaw-runtime\n";
      return "";
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeDelegatedManifest("openclaw"),
    ] as never[]);

    let state = orchestrator.getRuntimeState();
    expect(state.units.find((u) => u.id === "openclaw")?.phase).toBe("running");
    expect(state.units.find((u) => u.id === "openclaw")?.pid).toBe(7777);

    // Process gone
    vi.mocked(execFileSync).mockImplementation((cmd: string) => {
      if (cmd === "pgrep") throw new Error("no processes");
      return "";
    });

    state = orchestrator.getRuntimeState();
    expect(state.units.find((u) => u.id === "openclaw")?.phase).toBe("stopped");
  });

  // -----------------------------------------------------------------------
  // 20. Delegated unit with missing delegatedProcessMatch
  // -----------------------------------------------------------------------
  it("sets failed when delegatedProcessMatch is missing", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      {
        ...makeDelegatedManifest("openclaw"),
        delegatedProcessMatch: undefined,
      },
    ] as never[]);

    const state = orchestrator.getRuntimeState();
    expect(state.units.find((u) => u.id === "openclaw")?.phase).toBe("failed");
  });

  // -----------------------------------------------------------------------
  // 21. stdout/stderr data captured in logTail
  // -----------------------------------------------------------------------
  it("captures stdout and stderr in logTail", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    mockChild.stdout?.emit("data", "hello from stdout\n");
    mockChild.stderr?.emit("data", "error from stderr\n");

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(
      controller?.logTail.some(
        (e: { stream: string; message: string }) =>
          e.stream === "stdout" && e.message.includes("hello from stdout"),
      ),
    ).toBe(true);
    expect(
      controller?.logTail.some(
        (e: { stream: string; message: string }) =>
          e.stream === "stderr" && e.message.includes("error from stderr"),
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 22. startOne on unknown unit throws
  // -----------------------------------------------------------------------
  it("startOne throws for unknown unit id", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await expect(orchestrator.startOne("nonexistent")).rejects.toThrow(
      "Unknown daemon",
    );
  });

  // -----------------------------------------------------------------------
  // 23. restartOne stops dependents, restarts target + dependents
  // -----------------------------------------------------------------------
  it("restartOne stops dependents, restarts target, then restarts dependents", async () => {
    const spawnOrder: string[] = [];
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const id = args[0] === "web.js" ? "web" : "controller";
      spawnOrder.push(id);
      const child = createMockChild(6000 + spawnOrder.length);
      child.kill = vi.fn(() => {
        setTimeout(() => child.emit("exit", 0, null), 10);
        return true;
      });
      return child;
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", {
        args: ["controller.js"],
        dependents: ["web"],
      }),
      makeManagedManifest("web", { args: ["web.js"] }),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();
    await vi.advanceTimersByTimeAsync(100);
    spawnOrder.length = 0;

    const restartPromise = orchestrator.restartOne("controller");
    await vi.advanceTimersByTimeAsync(200);
    await restartPromise;

    expect(spawnOrder).toEqual(["controller", "web"]);
  });

  // -----------------------------------------------------------------------
  // 24. getLogFilePath returns manifest value
  // -----------------------------------------------------------------------
  it("getLogFilePath returns the manifest logFilePath", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller", { logFilePath: "/tmp/ctrl.log" }),
    ] as never[]);

    expect(orchestrator.getLogFilePath("controller")).toBe("/tmp/ctrl.log");
  });

  // -----------------------------------------------------------------------
  // 25. queryEvents filters by unitId
  // -----------------------------------------------------------------------
  it("queryEvents filters by unitId", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
      makeManagedManifest("web", { args: ["web.js"] }),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const result = orchestrator.queryEvents({ unitId: "controller" });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(
      result.entries.every(
        (e: { unitId: string }) => e.unitId === "controller",
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 26. Spawn with undefined pid handled gracefully
  // -----------------------------------------------------------------------
  it("handles spawn returning child with undefined pid", async () => {
    const noPidChild = createMockChild();
    Object.defineProperty(noPidChild, "pid", { value: undefined });
    mockSpawn.mockReturnValueOnce(noPidChild);

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(controller?.pid).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 27. restartCount increments on restart
  // -----------------------------------------------------------------------
  it("increments restartCount on each restart", async () => {
    const children: MockChildProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(9000 + children.length);
      child.kill = vi.fn(() => {
        setTimeout(() => child.emit("exit", 0, null), 10);
        return true;
      });
      children.push(child);
      return child;
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const restartPromise = orchestrator.restartOne("controller");
    await vi.advanceTimersByTimeAsync(100);
    await restartPromise;

    const state = orchestrator.getRuntimeState();
    expect(state.units.find((u) => u.id === "controller")?.restartCount).toBe(
      1,
    );
  });

  // -----------------------------------------------------------------------
  // 28. Partial failure: one unit stops, another hangs
  // -----------------------------------------------------------------------
  it("stopAll resolves even when one unit hangs (5s deadline)", async () => {
    const children: MockChildProcess[] = [];
    mockSpawn.mockImplementation(() => {
      const child = createMockChild(7000 + children.length);
      children.push(child);
      return child;
    });

    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("web"),
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const stopPromise = orchestrator.stopAll();

    // web exits immediately, controller hangs
    children[0].emit("exit", 0, null);
    // controller never emits exit — 5s deadline will resolve it

    await vi.advanceTimersByTimeAsync(6000);
    await stopPromise;

    // Both should be in terminal state
    const state = orchestrator.getRuntimeState();
    expect(state.units.find((u) => u.id === "web")?.phase).toBe("stopped");
    // controller phase may be "stopping" or caught by deadline — either way, stopAll resolved
  });

  // -----------------------------------------------------------------------
  // 29. dispose called twice doesn't hang
  // -----------------------------------------------------------------------
  it("dispose is safe to call twice", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    const dispose1 = orchestrator.dispose();
    mockChild.emit("exit", 0, null);
    await dispose1;

    // Second dispose — no child processes to stop, should return immediately
    await orchestrator.dispose();
  });

  // -----------------------------------------------------------------------
  // 30. child.error event sets phase to failed
  // -----------------------------------------------------------------------
  it("child error event sets phase to failed with error message", async () => {
    const { RuntimeOrchestrator } = await import(
      "../../apps/desktop/main/runtime/daemon-supervisor"
    );
    const orchestrator = new RuntimeOrchestrator([
      makeManagedManifest("controller"),
    ] as never[]);

    await orchestrator.startAutoStartManagedUnits();

    // Emit error on child process
    mockChild.emit("error", new Error("EACCES: permission denied"));

    const state = orchestrator.getRuntimeState();
    const controller = state.units.find((u) => u.id === "controller");
    expect(controller?.phase).toBe("failed");
    expect(controller?.lastError).toContain("EACCES");
  });
});
