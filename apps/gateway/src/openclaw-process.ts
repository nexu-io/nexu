import { type ChildProcess, spawn } from "node:child_process";
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
  const child = spawn(env.OPENCLAW_BIN, args, {
    stdio: "inherit",
    env: {
      ...process.env,
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
