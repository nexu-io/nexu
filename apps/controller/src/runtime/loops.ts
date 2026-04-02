import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { AnalyticsService } from "../services/analytics-service.js";
import type { OpenClawSyncService } from "../services/openclaw-sync-service.js";
import type { OpenClawProcessManager } from "./openclaw-process.js";
import type { OpenClawWsClient } from "./openclaw-ws-client.js";
import type { RuntimeHealth } from "./runtime-health.js";
import {
  type ControllerRuntimeState,
  recomputeRuntimeStatus,
} from "./state.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSyncLoop(params: {
  env: ControllerEnv;
  state: ControllerRuntimeState;
  syncService: OpenClawSyncService;
}): () => void {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      try {
        await params.syncService.syncAll();
        const now = new Date().toISOString();
        params.state.configSyncStatus = "active";
        params.state.skillsSyncStatus = "active";
        params.state.templatesSyncStatus = "active";
        params.state.lastConfigSyncAt = now;
        params.state.lastSkillsSyncAt = now;
        params.state.lastTemplatesSyncAt = now;
        recomputeRuntimeStatus(params.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.state.configSyncStatus = "degraded";
        params.state.skillsSyncStatus = "degraded";
        params.state.templatesSyncStatus = "degraded";
        recomputeRuntimeStatus(params.state);
        logger.warn({ error: message }, "controller sync loop failed");
      }

      await sleep(params.env.runtimeSyncIntervalMs);
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}

/**
 * Number of consecutive health probes where the process is alive but the
 * gateway port is unreachable before we emit a structured warning log.
 * At the default 5 s probe interval this gives the gateway ~60 s to become
 * ready — well above the observed ~20-45 s cold-start window.
 */
const WEDGE_REPORT_THRESHOLD = 12;

export function startHealthLoop(params: {
  env: ControllerEnv;
  state: ControllerRuntimeState;
  runtimeHealth: RuntimeHealth;
  processManager?: OpenClawProcessManager;
  wsClient?: OpenClawWsClient;
}): () => void {
  let stopped = false;
  let consecutiveUnreachableWhileAlive = 0;
  let wedgeFirstSeenAt: string | null = null;
  let wedgeReported = false;
  let lastSuccessfulProbeAt: string | null = null;

  const resetWedgeState = () => {
    consecutiveUnreachableWhileAlive = 0;
    wedgeFirstSeenAt = null;
    wedgeReported = false;
  };

  const run = async () => {
    while (!stopped) {
      const prevGateway = params.state.gatewayStatus;
      const checkedAt = new Date().toISOString();
      const result = await params.runtimeHealth.probe();
      params.state.lastGatewayProbeAt = checkedAt;

      let newStatus = prevGateway;

      if (result.ok) {
        newStatus = "active";
        params.state.gatewayStatus = "active";
        params.state.lastGatewayError = null;
        lastSuccessfulProbeAt = checkedAt;
        resetWedgeState();
        // HTTP probe succeeded — mark boot complete if still booting.
        // This is idempotent with the WS onConnected callback in bootstrap.ts.
        if (params.state.bootPhase === "booting") {
          params.state.bootPhase = "ready";
        }
        // Gateway just became reachable — nudge WS client to connect now
        // instead of waiting for the backoff timer.
        if (prevGateway !== "active") {
          params.wsClient?.retryNow();
        }
      } else if (result.status !== null) {
        // Gateway responded but with an error status code
        newStatus = "degraded";
        params.state.gatewayStatus = "degraded";
        params.state.lastGatewayError = `http_${result.status}`;
        resetWedgeState();
      } else {
        // Gateway unreachable — use bootPhase + process check to decide status.
        // During boot, gateway not responding is expected ("starting").
        // After boot, check if process is alive to distinguish starting vs dead.
        //
        // In unmanaged mode (launchd), we can't check process liveness
        // directly. Use a grace period: allow up to WEDGE_REPORT_THRESHOLD
        // consecutive failures before escalating to unhealthy. This covers:
        // - Wedged process (alive but unresponsive) — detected and logged
        // - Real crash — escalates to unhealthy after the grace period
        const stillBooting = params.state.bootPhase === "booting";
        const managedProcessAlive = params.processManager?.isAlive() ?? false;
        const inUnmanagedGracePeriod =
          !params.env.manageOpenclawProcess &&
          consecutiveUnreachableWhileAlive < WEDGE_REPORT_THRESHOLD;
        const processAlive = managedProcessAlive || inUnmanagedGracePeriod;

        // Always increment the counter when not booting (even if processAlive
        // is false in managed mode — the counter is harmless and resets on
        // recovery or when the unhealthy path runs).
        if (!stillBooting) {
          consecutiveUnreachableWhileAlive += 1;
          if (wedgeFirstSeenAt === null) {
            wedgeFirstSeenAt = checkedAt;
          }
        }

        if (stillBooting || processAlive) {
          newStatus = "starting";
          params.state.gatewayStatus = "starting";
          params.state.lastGatewayError = "gateway_starting";

          // Emit wedge log once when threshold is reached.
          if (
            !stillBooting &&
            consecutiveUnreachableWhileAlive >= WEDGE_REPORT_THRESHOLD &&
            !wedgeReported
          ) {
            logger.warn(
              {
                event: "gateway_wedge_detected",
                consecutiveFailures: consecutiveUnreachableWhileAlive,
                firstSeenAt: wedgeFirstSeenAt,
                lastSuccessfulProbeAt,
                lastProbeErrorCode: result.errorCode,
                processAlive: managedProcessAlive,
                pid: params.processManager?.getPid() ?? null,
                intervalMs: params.env.runtimeHealthIntervalMs,
                bootPhase: params.state.bootPhase,
                gatewayStatusBefore: prevGateway,
                managedProcess: params.env.manageOpenclawProcess,
              },
              "gateway wedge detected: process alive but port unreachable",
            );
            wedgeReported = true;
          }
        } else {
          // Managed mode: process is confirmed dead.
          // Unmanaged mode: grace period expired — real outage or wedge.
          newStatus = "unhealthy";
          params.state.gatewayStatus = "unhealthy";
          params.state.lastGatewayError = "gateway_unreachable";
          resetWedgeState();
          params.processManager?.restartForHealth();
        }
      }

      // Log status transitions (only when status actually changes).
      if (prevGateway !== newStatus) {
        logger.info(
          {
            event: "gateway_status_transition",
            from: prevGateway,
            to: newStatus,
            errorCode: result.errorCode ?? null,
          },
          `gateway status: ${prevGateway} → ${newStatus}`,
        );
      }

      recomputeRuntimeStatus(params.state);
      await sleep(params.env.runtimeHealthIntervalMs);
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}

export function startAnalyticsLoop(params: {
  env: ControllerEnv;
  analyticsService: AnalyticsService;
}): () => void {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      try {
        await params.analyticsService.poll();
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "controller analytics loop failed",
        );
      }

      await sleep(params.env.runtimeSyncIntervalMs);
    }
  };

  void run();
  return () => {
    stopped = true;
  };
}
