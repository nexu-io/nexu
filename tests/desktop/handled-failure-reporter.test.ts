import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, RuntimeLogEntry } from "#desktop/shared/host";

// We test the detection functions and reporting logic by importing the module
// and inspecting Sentry mock calls.

vi.mock("@sentry/electron/main", () => ({
  isInitialized: vi.fn(() => true),
  withScope: vi.fn((callback: (scope: unknown) => void) => {
    const scope = {
      setLevel: vi.fn(),
      setTag: vi.fn(),
      setContext: vi.fn(),
    };
    callback(scope);
    return scope;
  }),
  captureMessage: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("#desktop/main/runtime/runtime-logger", () => ({
  writeDesktopMainLog: vi.fn(),
}));

import * as Sentry from "@sentry/electron/main";
import { registerHandledFailureReporter } from "#desktop/main/handled-failure-reporter";

function makeLogEntry(
  overrides: Partial<RuntimeLogEntry> = {},
): RuntimeLogEntry {
  return {
    id: "test:1",
    cursor: 1,
    ts: "2026-03-31T10:00:00.000Z",
    unitId: "controller",
    stream: "stdout",
    kind: "app",
    actionId: null,
    reasonCode: "stdout_line",
    message: "",
    ...overrides,
  };
}

function makeWedgeMessage(overrides: Record<string, unknown> = {}): string {
  const payload = {
    level: "warn",
    service: "nexu-controller",
    time: "2026-03-31T10:00:00.000Z",
    event: "gateway_wedge_detected",
    consecutiveFailures: 12,
    firstSeenAt: "2026-03-31T09:59:00.000Z",
    lastSuccessfulProbeAt: "2026-03-31T08:00:00.000Z",
    lastProbeErrorCode: "ECONNREFUSED",
    processAlive: true,
    pid: 42817,
    intervalMs: 5000,
    bootPhase: "ready",
    gatewayStatusBefore: "active",
    msg: "gateway wedge detected: process alive but port unreachable",
    ...overrides,
  };
  return JSON.stringify(payload);
}

type Subscriber = (event: RuntimeEvent) => void;

function createMockOrchestrator() {
  const subscribers = new Set<Subscriber>();
  return {
    subscribe: vi.fn((listener: Subscriber) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    }),
    emit(event: RuntimeEvent) {
      for (const listener of subscribers) {
        listener(event);
      }
    },
    getRuntimeState: vi.fn(() => ({
      units: [],
    })),
  };
}

describe("handled-failure-reporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("gateway wedge detection", () => {
    it("detects controller stdout_line with gateway_wedge_detected marker", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "controller",
        entry: makeLogEntry({
          reasonCode: "stdout_line",
          message: makeWedgeMessage(),
        }),
      };

      orchestrator.emit(event);

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "desktop.handled_failure.gateway_wedge",
      );
    });

    it("does NOT match openclaw unit events", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "openclaw",
        entry: makeLogEntry({
          unitId: "openclaw",
          reasonCode: "stdout_line",
          message: makeWedgeMessage(),
        }),
      };

      orchestrator.emit(event);

      expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
        "desktop.handled_failure.gateway_wedge",
      );
    });

    it("does NOT match controller events without the marker", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "controller",
        entry: makeLogEntry({
          reasonCode: "stdout_line",
          message:
            '{"event":"gateway_status_transition","from":"active","to":"starting"}',
        }),
      };

      orchestrator.emit(event);

      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("detects stderr_line (logger.warn goes to stderr)", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "controller",
        entry: makeLogEntry({
          reasonCode: "stderr_line",
          message: makeWedgeMessage(),
        }),
      };

      orchestrator.emit(event);

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "desktop.handled_failure.gateway_wedge",
      );
    });

    it("does NOT match non-stdout/stderr reason codes", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "controller",
        entry: makeLogEntry({
          reasonCode: "launchd_log_line",
          message: makeWedgeMessage(),
        }),
      };

      orchestrator.emit(event);

      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("sets correct Sentry tags (no attachment)", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const tags: Record<string, string> = {};
      const contexts: Record<string, unknown> = {};

      vi.mocked(Sentry.withScope).mockImplementationOnce(
        (callback: (scope: unknown) => void) => {
          const scope = {
            setLevel: vi.fn(),
            setTag: vi.fn((key: string, value: string) => {
              tags[key] = value;
            }),
            setContext: vi.fn((name: string, ctx: unknown) => {
              contexts[name] = ctx;
            }),
            addAttachment: vi.fn(),
          };
          callback(scope);
          // Verify no attachment was added
          expect(scope.addAttachment).not.toHaveBeenCalled();
        },
      );

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "controller",
        entry: makeLogEntry({
          reasonCode: "stdout_line",
          message: makeWedgeMessage(),
        }),
      };

      orchestrator.emit(event);

      expect(tags["nexu.handled_failure"]).toBe("true");
      expect(tags["nexu.handled_failure_kind"]).toBe("gateway_wedge");
      expect(tags["nexu.wedge_error_code"]).toBe("ECONNREFUSED");
      expect(tags["nexu.wedge_consecutive"]).toBe("12");
      expect(tags["nexu.boot_phase"]).toBe("ready");

      const ctx = contexts.handled_failure as Record<string, unknown>;
      expect(ctx.pid).toBe(42817);
      expect(ctx.durationMs).toBe(60000);
      expect(ctx.probeIntervalMs).toBe(5000);
    });
  });

  describe("cooldown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("prevents duplicate reports within 10 minutes", () => {
      const orchestrator = createMockOrchestrator();
      registerHandledFailureReporter({
        orchestrator: orchestrator as unknown as Parameters<
          typeof registerHandledFailureReporter
        >[0]["orchestrator"],
      });

      const event: RuntimeEvent = {
        type: "runtime:unit-log",
        unitId: "controller",
        entry: makeLogEntry({
          reasonCode: "stdout_line",
          message: makeWedgeMessage(),
        }),
      };

      // First report
      orchestrator.emit(event);
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);

      // Advance 5 minutes — within cooldown
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Emit flush to release reportInFlight
      vi.mocked(Sentry.flush).mockResolvedValue(true);

      // Second report within cooldown — should be skipped
      orchestrator.emit(event);
      // Still only 1 call (the process_exited path might also match, but
      // this event is controller/stdout_line so it won't)
      expect(
        vi
          .mocked(Sentry.captureMessage)
          .mock.calls.filter(
            (call) => call[0] === "desktop.handled_failure.gateway_wedge",
          ),
      ).toHaveLength(1);
    });
  });
});
