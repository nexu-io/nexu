import {
  sendHeartbeat,
  syncDiscordSessions,
  syncFeishuSessions,
} from "./api.js";
import { pollLatestConfig } from "./config.js";
import { env } from "./env.js";
import {
  probeGatewayDeepHealth,
  probeGatewayLiveness,
} from "./gateway-health.js";
import {
  type GatewayHealthEvaluator,
  type GatewayHealthEvaluatorConfig,
  type GatewayStatusTransition,
  createGatewayHealthEvaluator,
  onDeepHealthFailure,
  onDeepHealthSuccess,
  onLivenessFailure,
  onLivenessSuccess,
} from "./health-state.js";
import { BaseError, GatewayError, logger } from "./log.js";
import {
  reportHeartbeatFailure,
  reportProbeFailure,
  reportProbeSuccess,
  reportStateTransition,
} from "./metrics.js";
import { killForRestart } from "./openclaw-process.js";
import { pollLatestSkills } from "./skills.js";
import {
  type RuntimeState,
  markGatewayProbeFailure,
  markGatewayProbeSuccess,
  setConfigSyncStatus,
  setGatewayStatus,
  setSkillsSyncStatus,
  setWorkspaceTemplatesSyncStatus,
} from "./state.js";
import { sleep } from "./utils.js";
import { pollLatestWorkspaceTemplates } from "./workspace-templates.js";

const gatewayHealthConfig: GatewayHealthEvaluatorConfig = {
  failDegradedThreshold: env.RUNTIME_GATEWAY_FAIL_DEGRADED_THRESHOLD,
  failUnhealthyThreshold: env.RUNTIME_GATEWAY_FAIL_UNHEALTHY_THRESHOLD,
  recoverThreshold: env.RUNTIME_GATEWAY_RECOVER_THRESHOLD,
  unhealthyWindowMs: env.RUNTIME_GATEWAY_UNHEALTHY_WINDOW_MS,
  minStateHoldMs: env.RUNTIME_GATEWAY_MIN_STATE_HOLD_MS,
};

export async function runHeartbeatLoop(state: RuntimeState): Promise<never> {
  for (;;) {
    try {
      await sendHeartbeat(state);
    } catch (error) {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "loop/heartbeat",
            message: "heartbeat failed",
            code: baseError.code,
          },
          {
            reason: baseError.message,
          },
        ).toJSON(),
        "heartbeat failed",
      );
      reportHeartbeatFailure({ errorCode: baseError.code ?? "unknown" });
    }

    await sleep(env.RUNTIME_HEARTBEAT_INTERVAL_MS);
  }
}

export async function runDiscordSessionSyncLoop(): Promise<never> {
  // Initial delay to let the gateway stabilize
  await sleep(5000);

  for (;;) {
    try {
      await syncDiscordSessions();
    } catch (error) {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "loop/discord-session-sync",
            message: "discord session sync failed",
            code: baseError.code,
          },
          {
            reason: baseError.message,
          },
        ).toJSON(),
        "discord session sync failed",
      );
    }

    // Sync every 30 seconds
    await sleep(30000);
  }
}

export async function runFeishuSessionSyncLoop(): Promise<never> {
  // Initial delay to let the gateway stabilize
  await sleep(5000);

  for (;;) {
    try {
      await syncFeishuSessions();
    } catch (error) {
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "loop/feishu-session-sync",
            message: "feishu session sync failed",
            code: baseError.code,
          },
          {
            reason: baseError.message,
          },
        ).toJSON(),
        "feishu session sync failed",
      );
    }

    // Sync every 30 seconds
    await sleep(30000);
  }
}

export async function runPollLoop(state: RuntimeState): Promise<never> {
  let backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

  for (;;) {
    try {
      const changed = await pollLatestConfig(state);
      backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

      const jitter = Math.floor(
        Math.random() * (env.RUNTIME_POLL_JITTER_MS + 1),
      );
      await sleep(env.RUNTIME_POLL_INTERVAL_MS + jitter);

      if (changed) {
        await sendHeartbeat(state);
      }
    } catch (error) {
      setConfigSyncStatus(state, "degraded");
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "loop/config-poll",
            message: "config poll failed",
            code: baseError.code,
          },
          {
            retryInMs: backoffMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "config poll failed",
      );
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, env.RUNTIME_MAX_BACKOFF_MS);
    }
  }
}

export async function runSkillsPollLoop(state: RuntimeState): Promise<never> {
  let backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

  for (;;) {
    try {
      await pollLatestSkills(state);
      backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

      const jitter = Math.floor(
        Math.random() * (env.RUNTIME_POLL_JITTER_MS + 1),
      );
      await sleep(env.RUNTIME_POLL_INTERVAL_MS + jitter);
    } catch (error) {
      setSkillsSyncStatus(state, "degraded");
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "loop/skills-poll",
            message: "skills poll failed",
            code: baseError.code,
          },
          {
            retryInMs: backoffMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "skills poll failed",
      );
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, env.RUNTIME_MAX_BACKOFF_MS);
    }
  }
}

export async function runWorkspaceTemplatesPollLoop(
  state: RuntimeState,
): Promise<never> {
  let backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

  for (;;) {
    try {
      await pollLatestWorkspaceTemplates(state);
      backoffMs = env.RUNTIME_POLL_INTERVAL_MS;

      const jitter = Math.floor(
        Math.random() * (env.RUNTIME_POLL_JITTER_MS + 1),
      );
      await sleep(env.RUNTIME_POLL_INTERVAL_MS + jitter);
    } catch (error) {
      setWorkspaceTemplatesSyncStatus(state, "degraded");
      const baseError = BaseError.from(error);
      logger.warn(
        GatewayError.from(
          {
            source: "loop/workspace-templates-poll",
            message: "workspace templates poll failed",
            code: baseError.code,
          },
          {
            retryInMs: backoffMs,
            reason: baseError.message,
          },
        ).toJSON(),
        "workspace templates poll failed",
      );
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, env.RUNTIME_MAX_BACKOFF_MS);
    }
  }
}

function logProbeFailure(
  evaluator: GatewayHealthEvaluator,
  probeType: "liveness" | "deep",
  errorCode: string,
  latencyMs: number,
  exitCode?: number,
): void {
  logger.warn(
    GatewayError.from(
      {
        source: "loop/gateway-probe",
        message: "gateway probe failed",
        code: errorCode,
      },
      {
        event: "gateway_probe",
        probeType,
        status: evaluator.status,
        latencyMs,
        exitCode,
        consecutiveFailures:
          probeType === "liveness"
            ? evaluator.counters.consecutiveLivenessFailures
            : evaluator.counters.consecutiveDeepFailures,
        consecutiveSuccesses:
          probeType === "liveness"
            ? evaluator.counters.consecutiveLivenessSuccesses
            : evaluator.counters.consecutiveDeepSuccesses,
      },
    ).toJSON(),
    "gateway probe failed",
  );
}

function applyGatewayTransition(
  state: RuntimeState,
  transition: GatewayStatusTransition | null,
): void {
  if (!transition) {
    return;
  }

  setGatewayStatus(state, transition.to);
  logger.info(
    {
      event: "gateway_state_changed",
      from: transition.from,
      status: transition.to,
      reason: transition.reason,
    },
    "gateway health state changed",
  );
  reportStateTransition({
    from: transition.from,
    to: transition.to,
    reason: transition.reason,
  });

  // Kill the hung process so scheduleRestart can take over
  if (transition.to === "unhealthy") {
    killForRestart();
  }
}

async function runGatewayLivenessLoop(
  state: RuntimeState,
  evaluator: GatewayHealthEvaluator,
): Promise<never> {
  for (;;) {
    const nowMs = Date.now();
    const result = await probeGatewayLiveness();

    if (result.ok) {
      markGatewayProbeSuccess(state, result.checkedAt);
      reportProbeSuccess({
        probeType: result.probeType,
        latencyMs: result.latencyMs,
      });
      const transition = onLivenessSuccess(
        evaluator,
        gatewayHealthConfig,
        nowMs,
      );
      applyGatewayTransition(state, transition);
    } else {
      markGatewayProbeFailure(state, result.errorCode, result.checkedAt);
      reportProbeFailure({
        probeType: result.probeType,
        errorCode: result.errorCode,
        latencyMs: result.latencyMs,
        exitCode: result.exitCode,
      });
      const transition = onLivenessFailure(
        evaluator,
        gatewayHealthConfig,
        nowMs,
      );
      applyGatewayTransition(state, transition);
      logProbeFailure(
        evaluator,
        result.probeType,
        result.errorCode,
        result.latencyMs,
        result.exitCode,
      );
    }

    await sleep(env.RUNTIME_GATEWAY_LIVENESS_INTERVAL_MS);
  }
}

async function runGatewayDeepHealthLoop(
  state: RuntimeState,
  evaluator: GatewayHealthEvaluator,
): Promise<never> {
  for (;;) {
    const nowMs = Date.now();
    const result = await probeGatewayDeepHealth();

    if (result.ok) {
      markGatewayProbeSuccess(state, result.checkedAt);
      reportProbeSuccess({
        probeType: result.probeType,
        latencyMs: result.latencyMs,
      });
      const transition = onDeepHealthSuccess(
        evaluator,
        gatewayHealthConfig,
        nowMs,
      );
      applyGatewayTransition(state, transition);
    } else {
      markGatewayProbeFailure(state, result.errorCode, result.checkedAt);
      reportProbeFailure({
        probeType: result.probeType,
        errorCode: result.errorCode,
        latencyMs: result.latencyMs,
        exitCode: result.exitCode,
      });
      const transition = onDeepHealthFailure(
        evaluator,
        gatewayHealthConfig,
        nowMs,
      );
      applyGatewayTransition(state, transition);
      logProbeFailure(
        evaluator,
        result.probeType,
        result.errorCode,
        result.latencyMs,
        result.exitCode,
      );
    }

    await sleep(env.RUNTIME_GATEWAY_DEEP_INTERVAL_MS);
  }
}

export function runGatewayHealthLoops(state: RuntimeState): void {
  if (!env.RUNTIME_GATEWAY_PROBE_ENABLED) {
    logger.warn(
      {
        enabled: env.RUNTIME_GATEWAY_PROBE_ENABLED,
      },
      "gateway runtime probes disabled",
    );
    return;
  }

  const evaluator = createGatewayHealthEvaluator(Date.now());
  void runGatewayLivenessLoop(state, evaluator);
  void runGatewayDeepHealthLoop(state, evaluator);
}
