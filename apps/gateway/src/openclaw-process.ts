import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
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

function pipeChildStream(
  stream: NodeJS.ReadableStream | null,
  streamName: "stdout" | "stderr",
): void {
  if (!stream) {
    return;
  }

  const reader = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  reader.on("line", (line) => {
    if (line.length === 0) {
      return;
    }

    logger.info(
      {
        stream: streamName,
        raw_line: line,
      },
      "openclaw output",
    );
  });
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
  const child = spawn(env.OPENCLAW_BIN, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...safeEnv,
      SKILL_API_TOKEN: env.SKILL_API_TOKEN,
      OPENCLAW_LOG_LEVEL: "error",
    },
  });

  pipeChildStream(child.stdout, "stdout");
  pipeChildStream(child.stderr, "stderr");

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
