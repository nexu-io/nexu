import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type OpenClawConfig,
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
): Promise<void> {
  const stateDir = env.OPENCLAW_STATE_DIR;
  const contextPath = join(stateDir, "nexu-context.json");
  const context = {
    apiUrl: env.RUNTIME_API_BASE_URL,
    poolId: env.RUNTIME_POOL_ID,
    agents: agentMeta ?? {},
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

  if (!configChanged) {
    return false;
  }

  const configJson = JSON.stringify(payload.config, null, 2);
  await atomicWriteConfig(configJson);
  state.lastConfigHash = payload.configHash;
  state.lastSeenVersion = payload.version;

  await writeNexuContext(payload.agentMeta);

  setConfigSyncStatus(state, "active");

  logger.info(
    {
      poolId: payload.poolId,
      version: payload.version,
      hash: payload.configHash,
    },
    "applied new pool config",
  );

  return true;
}

/**
 * Strip Feishu channels and bindings from the config so OpenClaw starts
 * without them.  Feishu bot-info probes time out when the event loop is
 * saturated by concurrent Slack/Discord initialization.  By deferring
 * Feishu to a hot-reload cycle (after other channels are ready) the
 * probes complete on an idle event loop.
 */
function stripFeishuFromConfig(config: OpenClawConfig): {
  stripped: OpenClawConfig;
  hadFeishu: boolean;
} {
  if (!config.channels.feishu) {
    return { stripped: config, hadFeishu: false };
  }

  const { feishu: _, ...channelsWithoutFeishu } = config.channels;
  const bindingsWithoutFeishu = config.bindings.filter(
    (b) => b.match.channel !== "feishu",
  );

  return {
    stripped: {
      ...config,
      channels: channelsWithoutFeishu,
      bindings: bindingsWithoutFeishu,
    },
    hadFeishu: true,
  };
}

export async function fetchInitialConfig(): Promise<void> {
  const response = await fetchJson(
    `/api/internal/pools/${env.RUNTIME_POOL_ID}/config`,
    {
      method: "GET",
    },
  );

  const payload = openclawConfigSchema.parse(response);

  let configToWrite = payload;
  if (env.RUNTIME_DEFER_FEISHU_INIT) {
    const { stripped, hadFeishu } = stripFeishuFromConfig(payload);
    if (hadFeishu) {
      logger.info(
        "deferred feishu channels from initial config; will inject via hot-reload",
      );
    }
    configToWrite = stripped;
  }

  const configJson = JSON.stringify(configToWrite, null, 2);
  await atomicWriteConfig(configJson);

  // Write initial context — agentMeta not available from raw config endpoint,
  // so write with empty agents (will be populated on first poll cycle)
  await writeNexuContext(undefined);

  logger.info(
    {
      event: "startup_config_sync",
      status: "success",
      poolId: env.RUNTIME_POOL_ID,
    },
    "initial pool config synced",
  );
}
