import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the logger to capture log calls
vi.mock("../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../src/lib/logger.js";
import { startHealthLoop } from "../src/runtime/loops.js";
import type { ControllerRuntimeState } from "../src/runtime/state.js";

const mockedLogger = vi.mocked(logger);

function createState(
  overrides: Partial<ControllerRuntimeState> = {},
): ControllerRuntimeState {
  return {
    bootPhase: "ready",
    status: "active",
    configSyncStatus: "active",
    skillsSyncStatus: "active",
    templatesSyncStatus: "active",
    gatewayStatus: "active",
    lastConfigSyncAt: null,
    lastSkillsSyncAt: null,
    lastTemplatesSyncAt: null,
    lastGatewayProbeAt: null,
    lastGatewayError: null,
    ...overrides,
  };
}

function createMockProbe(
  results: Array<{
    ok: boolean;
    status: number | null;
    errorCode: string | null;
  }>,
) {
  let index = 0;
  return {
    probe: vi.fn(async () => {
      const result = results[index] ?? results[results.length - 1];
      index += 1;
      return result;
    }),
  };
}

function createMockProcessManager(alive = true, pid = 42817) {
  return {
    isAlive: vi.fn(() => alive),
    getPid: vi.fn(() => pid),
    restartForHealth: vi.fn(),
  };
}

describe("startHealthLoop — wedge detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advanceTicks(count: number, intervalMs: number) {
    for (let i = 0; i < count; i++) {
      await vi.advanceTimersByTimeAsync(intervalMs);
    }
  }

  const UNREACHABLE = { ok: false, status: null, errorCode: "ECONNREFUSED" };
  const HEALTHY = { ok: true, status: 200, errorCode: null };
  const INTERVAL = 5000;

  it("does not log wedge before threshold (11 consecutive failures)", async () => {
    const probes = Array.from({ length: 11 }, () => UNREACHABLE);
    const runtimeHealth = createMockProbe(probes);
    const processManager = createMockProcessManager();
    const state = createState();

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(11, INTERVAL);
    stop();

    const wedgeLogs = mockedLogger.warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event === "gateway_wedge_detected",
    );
    expect(wedgeLogs).toHaveLength(0);
  });

  it("logs gateway_wedge_detected at tick 12", async () => {
    const probes = Array.from({ length: 13 }, () => UNREACHABLE);
    const runtimeHealth = createMockProbe(probes);
    const processManager = createMockProcessManager();
    const state = createState();

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(13, INTERVAL);
    stop();

    const wedgeLogs = mockedLogger.warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event === "gateway_wedge_detected",
    );
    expect(wedgeLogs).toHaveLength(1);

    const payload = wedgeLogs[0][0] as Record<string, unknown>;
    expect(payload.consecutiveFailures).toBe(12);
    expect(payload.lastProbeErrorCode).toBe("ECONNREFUSED");
    expect(payload.processAlive).toBe(true);
    expect(payload.pid).toBe(42817);
    expect(payload.bootPhase).toBe("ready");
  });

  it("does not log duplicate wedge after first report", async () => {
    const probes = Array.from({ length: 20 }, () => UNREACHABLE);
    const runtimeHealth = createMockProbe(probes);
    const processManager = createMockProcessManager();
    const state = createState();

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(20, INTERVAL);
    stop();

    const wedgeLogs = mockedLogger.warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event === "gateway_wedge_detected",
    );
    expect(wedgeLogs).toHaveLength(1);
  });

  it("resets counter when probe succeeds", async () => {
    // 12 failures → wedge, then 1 success, then 12 more failures → second wedge
    const probes = [
      ...Array.from({ length: 12 }, () => UNREACHABLE),
      HEALTHY,
      ...Array.from({ length: 12 }, () => UNREACHABLE),
    ];
    const runtimeHealth = createMockProbe(probes);
    const processManager = createMockProcessManager();
    const state = createState();

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(25, INTERVAL);
    stop();

    const wedgeLogs = mockedLogger.warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event === "gateway_wedge_detected",
    );
    expect(wedgeLogs).toHaveLength(2);
  });

  it("resets counter when process dies", async () => {
    let aliveCount = 0;
    const processManager = {
      isAlive: vi.fn(() => {
        aliveCount += 1;
        // Die after 5 probes
        return aliveCount <= 5;
      }),
      getPid: vi.fn(() => 42817),
      restartForHealth: vi.fn(),
    };

    const probes = Array.from({ length: 15 }, () => UNREACHABLE);
    const runtimeHealth = createMockProbe(probes);
    const state = createState();

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(15, INTERVAL);
    stop();

    // Process died at probe 6 → counter reset → never reaches 12
    const wedgeLogs = mockedLogger.warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event === "gateway_wedge_detected",
    );
    expect(wedgeLogs).toHaveLength(0);
  });

  it("does not increment counter during boot phase", async () => {
    const probes = Array.from({ length: 15 }, () => UNREACHABLE);
    const runtimeHealth = createMockProbe(probes);
    const processManager = createMockProcessManager();
    const state = createState({ bootPhase: "booting" });

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(15, INTERVAL);
    stop();

    const wedgeLogs = mockedLogger.warn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event === "gateway_wedge_detected",
    );
    expect(wedgeLogs).toHaveLength(0);
  });

  it("logs status transition only on change", async () => {
    // active → 3 unreachable (starting) → 1 healthy (active)
    const probes = [UNREACHABLE, UNREACHABLE, UNREACHABLE, HEALTHY];
    const runtimeHealth = createMockProbe(probes);
    const processManager = createMockProcessManager();
    const state = createState();

    const stop = startHealthLoop({
      env: { runtimeHealthIntervalMs: INTERVAL } as Parameters<
        typeof startHealthLoop
      >[0]["env"],
      state,
      runtimeHealth: runtimeHealth as Parameters<
        typeof startHealthLoop
      >[0]["runtimeHealth"],
      processManager: processManager as unknown as Parameters<
        typeof startHealthLoop
      >[0]["processManager"],
    });

    await advanceTicks(4, INTERVAL);
    stop();

    const transitionLogs = mockedLogger.info.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as Record<string, unknown>).event ===
          "gateway_status_transition",
    );

    // active → starting (once), starting → active (once) = 2 transitions
    expect(transitionLogs).toHaveLength(2);
    expect((transitionLogs[0][0] as Record<string, unknown>).from).toBe(
      "active",
    );
    expect((transitionLogs[0][0] as Record<string, unknown>).to).toBe(
      "starting",
    );
    expect((transitionLogs[1][0] as Record<string, unknown>).from).toBe(
      "starting",
    );
    expect((transitionLogs[1][0] as Record<string, unknown>).to).toBe("active");
  });
});
