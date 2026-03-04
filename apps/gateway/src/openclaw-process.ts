import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { env } from "./env.js";
import { BaseError, GatewayError, logger as gatewayLogger } from "./log.js";

const logger = gatewayLogger.child({ log_source: "openclaw" });

let openclawGatewayProcess: ChildProcess | null = null;

function buildOpenclawGatewayArgs(): string[] {
  const args = ["gateway"];

  if (env.OPENCLAW_PROFILE) {
    args.push("--profile", env.OPENCLAW_PROFILE);
  }

  return args;
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
  });

  logger.info(
    {
      bin: env.OPENCLAW_BIN,
      args,
    },
    "spawned openclaw gateway process",
  );
}

export function stopManagedOpenclawGateway(): void {
  if (openclawGatewayProcess === null || openclawGatewayProcess.killed) {
    return;
  }

  openclawGatewayProcess.kill("SIGTERM");
}
