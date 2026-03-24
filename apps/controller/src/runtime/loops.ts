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

export function startHealthLoop(params: {
  env: ControllerEnv;
  state: ControllerRuntimeState;
  runtimeHealth: RuntimeHealth;
  processManager?: OpenClawProcessManager;
  wsClient?: OpenClawWsClient;
}): () => void {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      const prevGateway = params.state.gatewayStatus;
      const checkedAt = new Date().toISOString();
      const result = await params.runtimeHealth.probe();
      params.state.lastGatewayProbeAt = checkedAt;
      if (result.ok) {
        params.state.gatewayStatus = "active";
        params.state.lastGatewayError = null;
        // Gateway just became reachable — nudge WS client to connect now
        // instead of waiting for the backoff timer.
        if (prevGateway !== "active") {
          params.wsClient?.retryNow();
        }
      } else if (result.status !== null) {
        // Gateway responded but with an error status code
        params.state.gatewayStatus = "degraded";
        params.state.lastGatewayError = `http_${result.status}`;
      } else {
        // Gateway unreachable — use bootPhase + process check to decide status.
        // During boot, gateway not responding is expected ("starting").
        // After boot, check if process is alive to distinguish starting vs dead.
        const stillBooting = params.state.bootPhase === "booting";
        const processAlive = params.processManager?.isAlive() ?? false;
        if (stillBooting || processAlive) {
          params.state.gatewayStatus = "starting";
          params.state.lastGatewayError = "gateway_starting";
        } else {
          params.state.gatewayStatus = "unhealthy";
          params.state.lastGatewayError = "gateway_unreachable";
          params.processManager?.restartForHealth();
        }
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
