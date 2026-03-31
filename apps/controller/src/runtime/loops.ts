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
        // In launchd mode (manageOpenclawProcess=false), we don't own the
        // child process so isAlive() always returns false. Treat the process
        // as "assumed alive" because launchd manages it — the HTTP probe is
        // the authoritative liveness signal, not PID checks.
        const stillBooting = params.state.bootPhase === "booting";
        const managedProcessAlive = params.processManager?.isAlive() ?? false;
        const externallyManaged = !params.env.manageOpenclawProcess;
        const processAlive = managedProcessAlive || externallyManaged;
        if (stillBooting || processAlive) {
          newStatus = "starting";
          params.state.gatewayStatus = "starting";
          params.state.lastGatewayError = "gateway_starting";

          // Track consecutive unreachable probes while process is alive
          // (exclude boot phase — gateway is expected to be unreachable then).
          if (!stillBooting && processAlive) {
            consecutiveUnreachableWhileAlive += 1;
            if (wedgeFirstSeenAt === null) {
              wedgeFirstSeenAt = checkedAt;
            }

            if (
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
                  processAlive: true,
                  pid: params.processManager?.getPid() ?? null,
                  intervalMs: params.env.runtimeHealthIntervalMs,
                  bootPhase: params.state.bootPhase,
                  gatewayStatusBefore: prevGateway,
                },
                "gateway wedge detected: process alive but port unreachable",
              );
              wedgeReported = true;
            }
          }
        } else {
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
