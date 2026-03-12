import { type ChildProcess, execSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { checkSlackTokens } from "./api.js";
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
      // Validate Slack tokens before refreshing config so the new config
      // excludes any channels with revoked tokens — prevents crash loops.
      try {
        await checkSlackTokens();
      } catch {
        // best-effort; continue with restart
      }

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

      // Clear stale gateway lock files left by the crashed process
      try {
        const uid =
          typeof process.getuid === "function" ? process.getuid() : undefined;
        const suffix = uid != null ? `openclaw-${uid}` : "openclaw";
        const lockDir = path.join(tmpdir(), suffix);
        const files = await readdir(lockDir);
        for (const file of files) {
          if (file.startsWith("gateway.") && file.endsWith(".lock")) {
            await rm(path.join(lockDir, file), { force: true });
          }
        }
      } catch {
        // lock dir may not exist
      }

      startManagedOpenclawGateway();
      reportOpenclawRestart({
        attempt: consecutiveRestarts,
        success: openclawGatewayProcess !== null,
      });
    })();
  }, delayMs);
}

/**
 * Kill any orphaned `openclaw gateway` processes left from a previous crash.
 * Reads /proc to find processes whose cmdline starts with "openclaw" and
 * contains "gateway", then sends SIGKILL. This prevents EADDRINUSE when
 * a zombie process holds port 18789 after the sidecar received the exit event.
 *
 * Safe because:
 * - The sidecar itself is `node`, never matches `openclaw`
 * - Short-lived probe commands (`openclaw health`) being killed is harmless
 * - Pod PID namespace isolates us from other pods
 */
function killOrphanedOpenclawProcesses(): void {
  // Try Linux /proc first
  try {
    const procEntries = readdirSync("/proc");
    for (const entry of procEntries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number.parseInt(entry, 10);
      if (pid === process.pid) continue;

      try {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8")
          .replace(/\0/g, " ")
          .trim();
        if (cmdline.includes("openclaw") && cmdline.includes("gateway")) {
          process.kill(pid, "SIGKILL");
          logger.info(
            { event: "openclaw_orphan_killed", pid, cmdline },
            "killed orphaned openclaw gateway process",
          );
        }
      } catch {
        // process may have exited between readdir and readFile
      }
    }
    return;
  } catch {
    // /proc not available (macOS); fall through to pgrep
  }

  // macOS / BSD fallback using pgrep
  try {
    const output = execSync("pgrep -f 'openclaw.*gateway'", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    for (const line of output.split("\n")) {
      const pid = Number.parseInt(line, 10);
      if (Number.isNaN(pid) || pid === process.pid) continue;
      try {
        process.kill(pid, "SIGKILL");
        logger.info(
          { event: "openclaw_orphan_killed", pid },
          "killed orphaned openclaw gateway process",
        );
      } catch {
        // already exited
      }
    }
  } catch {
    // pgrep returns exit 1 when no matches; ignore
  }
}

export function startManagedOpenclawGateway(): void {
  if (openclawGatewayProcess !== null) {
    return;
  }

  killOrphanedOpenclawProcesses();

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
    stdio: ["ignore", "ignore", "pipe"],
    cwd: openclawCwd,
    env: {
      ...safeEnv,
      SKILL_API_TOKEN: env.SKILL_API_TOKEN,
      OPENCLAW_LOG_LEVEL: "error",
    },
  });

  openclawGatewayProcess = child;
  lastStartTime = Date.now();

  if (child.stderr) {
    createInterface({ input: child.stderr }).on("line", (line) => {
      logger.error({ stream: "stderr" }, line);
    });
  }

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

export function stopManagedOpenclawGateway(): Promise<void> {
  autoRestartEnabled = false;

  if (openclawGatewayProcess === null || openclawGatewayProcess.killed) {
    return Promise.resolve();
  }

  const child = openclawGatewayProcess;

  return new Promise<void>((resolve) => {
    const forceKillTimer = setTimeout(() => {
      if (!child.killed) {
        logger.warn("openclaw gateway did not exit in time, sending SIGKILL");
        child.kill("SIGKILL");
      }
      resolve();
    }, 5000);

    child.once("exit", () => {
      clearTimeout(forceKillTimer);
      resolve();
    });

    child.kill("SIGTERM");
  });
}
