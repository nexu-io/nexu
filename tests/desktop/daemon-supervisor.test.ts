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
  execFileSync: vi.fn(() => ""),
}));

vi.mock("node:fs", () => ({
  closeSync: vi.fn(),
  openSync: vi.fn(() => 0),
  readSync: vi.fn(() => 0),
  statSync: vi.fn(() => ({ size: 0 })),
}));

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
});
