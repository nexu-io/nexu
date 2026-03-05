import { logger } from "./log.js";

type DogStatsDClient = {
  increment(name: string, value?: number, tags?: string[]): void;
  gauge(name: string, value: number, tags?: string[]): void;
};

let client: DogStatsDClient | null | undefined;

async function getClient(): Promise<DogStatsDClient | null> {
  if (client !== undefined) return client;
  if (!process.env.DD_ENV) {
    client = null;
    return null;
  }
  try {
    const mod = await import("dd-trace");
    const tracer = mod.default as unknown as { dogstatsd?: DogStatsDClient };
    client = tracer.dogstatsd ?? null;
    return client;
  } catch {
    client = null;
    return null;
  }
}

function emitMetric(
  name: string,
  tags: string[],
  logPayload: Record<string, unknown>,
): void {
  void getClient().then((c) => {
    if (c) {
      c.increment(name, 1, tags);
    }
  });
  logger.info(logPayload, name);
}

export function reportOpenclawCrash(context: {
  exitCode: number | null;
  signal: string | null;
}): void {
  emitMetric(
    "gateway.openclaw.crash",
    [
      `exit_code:${context.exitCode ?? "null"}`,
      `signal:${context.signal ?? "none"}`,
    ],
    {
      event: "openclaw_crash",
      exitCode: context.exitCode,
      signal: context.signal,
    },
  );
}

export function reportOpenclawRestart(context: {
  attempt: number;
  success: boolean;
}): void {
  emitMetric(
    "gateway.openclaw.restart",
    [`attempt:${context.attempt}`, `success:${context.success}`],
    {
      event: "openclaw_restart",
      attempt: context.attempt,
      success: context.success,
    },
  );
}

export function reportOpenclawRestartLimitExceeded(attempts: number): void {
  emitMetric(
    "gateway.openclaw.restart_limit_exceeded",
    [`attempts:${attempts}`],
    {
      event: "openclaw_restart_limit_exceeded",
      attempts,
    },
  );
}

export function reportOpenclawKillForRestart(): void {
  emitMetric("gateway.openclaw.kill_for_restart", [], {
    event: "openclaw_kill_for_restart",
  });
}

export function reportProbeFailure(context: {
  probeType: string;
  errorCode: string;
  latencyMs: number;
  exitCode?: number;
}): void {
  emitMetric(
    "gateway.probe.failure",
    [`probe_type:${context.probeType}`, `error_code:${context.errorCode}`],
    {
      event: "gateway_probe_failure",
      probeType: context.probeType,
      errorCode: context.errorCode,
      latencyMs: context.latencyMs,
      exitCode: context.exitCode,
    },
  );
}

export function reportProbeSuccess(context: {
  probeType: string;
  latencyMs: number;
}): void {
  emitMetric("gateway.probe.success", [`probe_type:${context.probeType}`], {
    event: "gateway_probe_success",
    probeType: context.probeType,
    latencyMs: context.latencyMs,
  });
}

export function reportStateTransition(context: {
  from: string;
  to: string;
  reason: string;
}): void {
  emitMetric(
    "gateway.state.transition",
    [`from:${context.from}`, `to:${context.to}`, `reason:${context.reason}`],
    {
      event: "gateway_state_transition",
      from: context.from,
      to: context.to,
      reason: context.reason,
    },
  );
}

export function reportHeartbeatFailure(context: {
  errorCode: string;
}): void {
  emitMetric("gateway.heartbeat.failure", [`error_code:${context.errorCode}`], {
    event: "gateway_heartbeat_failure",
    errorCode: context.errorCode,
  });
}
