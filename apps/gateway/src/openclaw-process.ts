import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fetchInitialConfig } from "./config.js";
import { env } from "./env.js";
import { BaseError, GatewayError, logger as gatewayLogger } from "./log.js";
import {
  reportOpenclawCrash,
  reportOpenclawKillForRestart,
  reportOpenclawRestart,
  reportOpenclawRestartLimitExceeded,
} from "./metrics.js";

const logger = gatewayLogger.child({ log_source: "openclaw" });

let openclawGatewayProcess: ChildProcess | null = null;
let autoRestartEnabled = false;
let consecutiveRestarts = 0;
let lastStartTime = 0;

const MAX_CONSECUTIVE_RESTARTS = 10;
const BASE_RESTART_DELAY_MS = 3000;
const RESTART_WINDOW_MS = 120_000; // reset counter after 2 min of stable running

function buildOpenclawGatewayArgs(): string[] {
  const args = ["gateway"];

  if (env.OPENCLAW_PROFILE) {
    args.push("--profile", env.OPENCLAW_PROFILE);
  }

  return args;
}

function scheduleRestart(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): void {
  if (!autoRestartEnabled) {
    return;
  }

  const uptime = Date.now() - lastStartTime;

  // Reset counter if the process was running long enough
  if (uptime > RESTART_WINDOW_MS) {
    consecutiveRestarts = 0;
  }

  consecutiveRestarts++;

  reportOpenclawCrash({ exitCode, signal: signal ?? null });

  if (consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
    logger.error(
      {
        event: "openclaw_restart_limit",
        attempts: consecutiveRestarts,
        maxAttempts: MAX_CONSECUTIVE_RESTARTS,
      },
      "openclaw gateway exceeded max restart attempts; giving up",
    );
    reportOpenclawRestartLimitExceeded(consecutiveRestarts);
    return;
  }

  const delayMs = BASE_RESTART_DELAY_MS * Math.min(consecutiveRestarts, 5);

  logger.info(
    {
      event: "openclaw_restart_scheduled",
      attempt: consecutiveRestarts,
      delayMs,
      exitCode,
      signal,
    },
    "scheduling openclaw gateway restart",
  );

  setTimeout(() => {
    void (async () => {
      try {
        await fetchInitialConfig();
        logger.info(
          { event: "openclaw_restart_config_refreshed" },
          "wrote fresh config before restart",
        );
      } catch (error) {
        const baseError = BaseError.from(error);
        logger.warn(
          GatewayError.from(
            {
              source: "openclaw-process/restart",
              message: "failed to refresh config before restart",
              code: baseError.code,
            },
            { reason: baseError.message },
          ).toJSON(),
          "failed to refresh config before restart; proceeding anyway",
        );
      }

      startManagedOpenclawGateway();
      reportOpenclawRestart({
        attempt: consecutiveRestarts,
        success: openclawGatewayProcess !== null,
      });
    })();
  }, delayMs);
}

export function startManagedOpenclawGateway(): void {
  if (openclawGatewayProcess !== null) {
    return;
  }

  const args = buildOpenclawGatewayArgs();
  const {
    INTERNAL_API_TOKEN: _internalToken,
    ENCRYPTION_KEY: _encryptionKey,
    ...safeEnv
  } = process.env;
  // Resolve CWD to match OPENCLAW_STATE_DIR so that relative workspace paths
  // (e.g. ".openclaw/workspaces/{id}") resolve consistently for both the exec
  // tool and the memory indexer.  Without this, exec resolves relative to the
  // sidecar's CWD (apps/gateway/) while the indexer resolves relative to
  // CONFIG_DIR, causing memory files to be written to the wrong location.
  const openclawCwd = env.OPENCLAW_STATE_DIR
    ? path.resolve(env.OPENCLAW_STATE_DIR)
    : undefined;

  const child = spawn(env.OPENCLAW_BIN, args, {
    stdio: ["ignore", "ignore", "ignore"],
    cwd: openclawCwd,
    env: {
      ...safeEnv,
      SKILL_API_TOKEN: env.SKILL_API_TOKEN,
      OPENCLAW_LOG_LEVEL: "error",
    },
  });

  openclawGatewayProcess = child;
  lastStartTime = Date.now();

  child.once("error", (error: Error) => {
    const baseError = BaseError.from(error);
    logger.error(
      GatewayError.from(
        {
          source: "openclaw-process/spawn",
          message: "failed to spawn openclaw gateway",
          code: baseError.code,
        },
        {
          bin: env.OPENCLAW_BIN,
          args,
          reason: baseError.message,
        },
      ).toJSON(),
      "failed to spawn openclaw gateway",
    );
    openclawGatewayProcess = null;
    scheduleRestart(null, null);
  });

  child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    logger.warn(
      {
        code,
        signal,
      },
      "openclaw gateway process exited",
    );
    openclawGatewayProcess = null;

    // Auto-restart unless intentionally stopped (SIGTERM from stopManagedOpenclawGateway)
    if (signal !== "SIGTERM") {
      scheduleRestart(code, signal);
    }
  });

  logger.info(
    {
      bin: env.OPENCLAW_BIN,
      args,
    },
    "spawned openclaw gateway process",
  );
}

export function enableAutoRestart(): void {
  autoRestartEnabled = true;
}

/**
 * Kill the managed process so that the `exit` handler triggers
 * `scheduleRestart`.  Used by the health monitor when the gateway is
 * confirmed unhealthy but the process hasn't crashed on its own.
 *
 * Unlike `stopManagedOpenclawGateway`, this does NOT disable auto-restart
 * and uses SIGKILL so the exit handler sees `signal !== "SIGTERM"` and
 * proceeds with the restart flow.
 */
export function killForRestart(): void {
  if (openclawGatewayProcess === null || openclawGatewayProcess.killed) {
    return;
  }

  logger.warn(
    { event: "openclaw_kill_for_restart" },
    "killing unhealthy openclaw gateway for restart",
  );
  reportOpenclawKillForRestart();
  openclawGatewayProcess.kill("SIGKILL");
}

export function stopManagedOpenclawGateway(): void {
  autoRestartEnabled = false;

  if (openclawGatewayProcess === null || openclawGatewayProcess.killed) {
    return;
  }

  openclawGatewayProcess.kill("SIGTERM");
}
