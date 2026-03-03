import { type ChildProcess, spawn } from "node:child_process";
import { env } from "./env.js";
import { log } from "./log.js";

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
  const child = spawn(env.OPENCLAW_BIN, args, {
    stdio: "inherit",
    env: { ...safeEnv, SKILL_API_TOKEN: env.SKILL_API_TOKEN },
  });

  openclawGatewayProcess = child;

  child.once("error", (error: Error) => {
    log("failed to spawn openclaw gateway", {
      bin: env.OPENCLAW_BIN,
      args,
      error: error.message,
    });
    openclawGatewayProcess = null;
  });

  child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    log("openclaw gateway process exited", {
      code,
      signal,
    });
    openclawGatewayProcess = null;
  });

  log("spawned openclaw gateway process", {
    bin: env.OPENCLAW_BIN,
    args,
  });
}

export function stopManagedOpenclawGateway(): void {
  if (openclawGatewayProcess === null || openclawGatewayProcess.killed) {
    return;
  }

  openclawGatewayProcess.kill("SIGTERM");
}
