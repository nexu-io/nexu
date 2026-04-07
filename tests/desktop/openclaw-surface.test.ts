import { describe, expect, it } from "vitest";
import type {
  RuntimeState,
  RuntimeUnitState,
} from "../../apps/desktop/shared/host";
import {
  getDesktopOpenClawUrl,
  isOpenClawSurfaceReady,
} from "../../apps/desktop/src/lib/openclaw-surface";

function createUnit(overrides: Partial<RuntimeUnitState>): RuntimeUnitState {
  return {
    id: "openclaw",
    label: "OpenClaw",
    kind: "service",
    launchStrategy: "launchd",
    phase: "starting",
    autoStart: true,
    pid: null,
    port: 18789,
    startedAt: null,
    exitedAt: null,
    exitCode: null,
    lastError: null,
    lastReasonCode: null,
    lastProbeAt: null,
    restartCount: 0,
    commandSummary: null,
    binaryPath: null,
    logFilePath: null,
    logTail: [],
    ...overrides,
  };
}

function createRuntimeState(units: RuntimeUnitState[]): RuntimeState {
  return {
    startedAt: new Date(0).toISOString(),
    units,
  };
}

describe("openclaw surface gating", () => {
  it("keeps the surface unavailable until the openclaw runtime unit is running", () => {
    const runtimeState = createRuntimeState([
      createUnit({ phase: "starting" }),
    ]);

    expect(isOpenClawSurfaceReady(runtimeState)).toBe(false);
  });

  it("builds the gateway URL only after the openclaw runtime unit is running", () => {
    const startingState = createRuntimeState([
      createUnit({ phase: "starting" }),
    ]);
    const runningState = createRuntimeState([createUnit({ phase: "running" })]);

    expect(
      getDesktopOpenClawUrl({
        runtimeConfig: {
          urls: { openclawBase: "http://127.0.0.1:18789" },
          tokens: { gateway: "gw-secret-token" },
        },
        runtimeState: startingState,
      }),
    ).toBeNull();

    expect(
      getDesktopOpenClawUrl({
        runtimeConfig: {
          urls: { openclawBase: "http://127.0.0.1:18789" },
          tokens: { gateway: "gw-secret-token" },
        },
        runtimeState: runningState,
      }),
    ).toBe("http://127.0.0.1:18789/#token=gw-secret-token");
  });
});
