import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  openclawConfigSchema,
  runtimePoolConfigResponseSchema,
} from "@nexu/shared";
import { fetchJson } from "./api.js";
import { env } from "./env.js";
import { logger } from "./log.js";
import type { RuntimeState } from "./state.js";
import { setConfigSyncStatus } from "./state.js";

async function atomicWriteConfig(configJson: string): Promise<void> {
  await mkdir(dirname(env.OPENCLAW_CONFIG_PATH), { recursive: true });
  const tempPath = `${env.OPENCLAW_CONFIG_PATH}.tmp`;
  await writeFile(tempPath, configJson, "utf8");
  await rename(tempPath, env.OPENCLAW_CONFIG_PATH);
}

async function writeNexuContext(
  agentMeta: Record<string, { botId: string }> | undefined,
  poolSecrets: Record<string, string> | undefined,
): Promise<void> {
  const stateDir = env.OPENCLAW_STATE_DIR;
  const contextPath = join(stateDir, "nexu-context.json");
  const context = {
    apiUrl: env.RUNTIME_API_BASE_URL,
    internalToken: env.INTERNAL_API_TOKEN,
    poolId: env.RUNTIME_POOL_ID,
    agents: agentMeta ?? {},
    secrets: poolSecrets ?? {},
  };
  await mkdir(stateDir, { recursive: true });
  const tempPath = `${contextPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(context, null, 2), "utf8");
  await rename(tempPath, contextPath);
  await chmod(contextPath, 0o600);
}

export async function pollLatestConfig(state: RuntimeState): Promise<boolean> {
  const response = await fetchJson(
    `/api/internal/pools/${env.RUNTIME_POOL_ID}/config/latest`,
    {
      method: "GET",
    },
  );

  const payload = runtimePoolConfigResponseSchema.parse(response);

  const configChanged = payload.configHash !== state.lastConfigHash;
  const secretsChanged =
    (payload.secretsHash ?? "") !== (state.lastSecretsHash ?? "");

  if (!configChanged && !secretsChanged) {
    return false;
  }

  if (configChanged) {
    const configJson = JSON.stringify(payload.config, null, 2);
    await atomicWriteConfig(configJson);
    state.lastConfigHash = payload.configHash;
    state.lastSeenVersion = payload.version;
  }

  if (configChanged || secretsChanged) {
    await writeNexuContext(payload.agentMeta, payload.poolSecrets);
    state.lastSecretsHash = payload.secretsHash ?? "";
  }

  setConfigSyncStatus(state, "active");

  logger.info(
    {
      poolId: payload.poolId,
      version: payload.version,
      hash: payload.configHash,
      secretsChanged,
    },
    "applied new pool config",
  );

  return true;
}

export async function fetchInitialConfig(): Promise<void> {
  const response = await fetchJson(
    `/api/internal/pools/${env.RUNTIME_POOL_ID}/config`,
    {
      method: "GET",
    },
  );

  const payload = openclawConfigSchema.parse(response);
  const configJson = JSON.stringify(payload, null, 2);
  await atomicWriteConfig(configJson);

  // Write initial context — agentMeta and secrets not available from raw config endpoint,
  // so write with empty agents/secrets (will be populated on first poll cycle)
  await writeNexuContext(undefined, undefined);

  logger.info(
    {
      event: "startup_config_sync",
      status: "success",
      poolId: env.RUNTIME_POOL_ID,
    },
    "initial pool config synced",
  );
}
