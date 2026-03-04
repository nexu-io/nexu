import type {
  AgentConfig,
  BindingConfig,
  DiscordAccountConfig,
  FeishuAccountConfig,
  OpenClawConfig,
  SlackAccountConfig,
} from "@nexu/shared";
import { openclawConfigSchema } from "@nexu/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  botChannels,
  bots,
  channelCredentials,
  gatewayPools,
} from "../db/schema/index.js";
import { decrypt } from "./crypto.js";
import { ServiceError } from "./error.js";

interface ChannelCredentialRow {
  credentialType: string;
  encryptedValue: string;
}

interface ChannelWithBot {
  channelId: string;
  botId: string;
  channelType: string;
  accountId: string;
  status: string | null;
  botSlug: string;
  botName: string;
  botModelId: string | null;
  credentials: ChannelCredentialRow[];
}

export async function generatePoolConfig(
  db: Database,
  poolIdOrName: string,
  gatewayToken?: string,
): Promise<OpenClawConfig> {
  // Try lookup by id first, fall back to poolName
  const [poolById] = await db
    .select()
    .from(gatewayPools)
    .where(eq(gatewayPools.id, poolIdOrName));
  const pool =
    poolById ??
    (
      await db
        .select()
        .from(gatewayPools)
        .where(eq(gatewayPools.poolName, poolIdOrName))
    )[0];

  if (!pool) {
    throw ServiceError.from("config-generator", {
      code: "pool_not_found",
      message: `Pool ${poolIdOrName} not found`,
      pool_id_or_name: poolIdOrName,
    });
  }

  const poolId = pool.id;

  const poolBots = await db.select().from(bots).where(eq(bots.poolId, poolId));

  const activeBots = poolBots
    .filter((b) => b.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const channelsWithBots: ChannelWithBot[] = [];

  for (const bot of activeBots) {
    const channels = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.botId, bot.id));

    const connectedChannels = channels.filter(
      (ch) => ch.status === "connected",
    );

    for (const channel of connectedChannels) {
      const creds = await db
        .select({
          credentialType: channelCredentials.credentialType,
          encryptedValue: channelCredentials.encryptedValue,
        })
        .from(channelCredentials)
        .where(eq(channelCredentials.botChannelId, channel.id));

      channelsWithBots.push({
        channelId: channel.id,
        botId: bot.id,
        channelType: channel.channelType,
        accountId: channel.accountId,
        status: channel.status,
        botSlug: bot.slug,
        botName: bot.name,
        botModelId: bot.modelId,
        credentials: creds,
      });
    }
  }

  // LiteLLM provider config from env vars
  const litellmBaseUrl = process.env.LITELLM_BASE_URL;
  const litellmApiKey = process.env.LITELLM_API_KEY;
  const hasLitellm = Boolean(litellmBaseUrl && litellmApiKey);

  // Prefix model ID with "litellm/" when LiteLLM is configured
  function resolveModelId(rawModelId: string): string {
    if (!hasLitellm) return rawModelId;
    // Already prefixed — skip
    if (rawModelId.startsWith("litellm/")) return rawModelId;
    return `litellm/${rawModelId}`;
  }

  // Workspace path must be under the PVC mount so agent files survive pod restarts.
  // OPENCLAW_STATE_DIR is set to /data/openclaw in production (the PVC mount point).
  const stateDir = process.env.OPENCLAW_STATE_DIR ?? "/data/openclaw";

  const agentList: AgentConfig[] = activeBots.map((bot, index) => {
    const agent: AgentConfig = {
      id: bot.id,
      name: bot.name,
      workspace: `${stateDir}/workspaces/${bot.id}`,
    };

    if (index === 0) {
      agent.default = true;
    }

    if (bot.modelId) {
      agent.model = { primary: resolveModelId(bot.modelId) };
    }

    return agent;
  });

  const slackAccounts: Record<string, SlackAccountConfig> = {};
  const discordAccounts: Record<string, DiscordAccountConfig> = {};
  const feishuAccounts: Record<string, FeishuAccountConfig> = {};
  const bindingsList: BindingConfig[] = [];

  for (const ch of channelsWithBots) {
    if (ch.channelType === "slack") {
      const credMap = new Map<string, string>();
      for (const cred of ch.credentials) {
        try {
          credMap.set(cred.credentialType, decrypt(cred.encryptedValue));
        } catch {
          credMap.set(cred.credentialType, "");
        }
      }

      const botToken = credMap.get("botToken") ?? "";
      const signingSecret = credMap.get("signingSecret") ?? "";

      slackAccounts[ch.accountId] = {
        enabled: true,
        botToken,
        signingSecret,
        mode: "http",
        webhookPath: `/slack/events/${ch.accountId}`,
        // OpenClaw Slack plugin's isConfigured requires appToken even in HTTP mode.
        // Provide a placeholder so the account passes the configured check.
        appToken: "xapp-placeholder-not-used-in-http-mode",
        // Disable preview streaming to avoid duplicate messages.
        // When streaming is "partial" (default), OpenClaw sends a draft preview
        // message then a final reply — but without a thread context the draft
        // cannot be finalized via edit, resulting in two visible messages.
        streaming: "off",
      };

      bindingsList.push({
        agentId: ch.botId,
        match: {
          channel: "slack",
          accountId: ch.accountId,
        },
      });
    } else if (ch.channelType === "discord") {
      const credMap = new Map<string, string>();
      for (const cred of ch.credentials) {
        try {
          credMap.set(cred.credentialType, decrypt(cred.encryptedValue));
        } catch {
          credMap.set(cred.credentialType, "");
        }
      }

      const botToken = credMap.get("botToken") ?? "";

      discordAccounts[ch.accountId] = {
        enabled: true,
        token: botToken,
        groupPolicy: "open",
      };

      bindingsList.push({
        agentId: ch.botId,
        match: {
          channel: "discord",
          accountId: ch.accountId,
        },
      });
    } else if (ch.channelType === "feishu") {
      const credMap = new Map<string, string>();
      for (const cred of ch.credentials) {
        try {
          credMap.set(cred.credentialType, decrypt(cred.encryptedValue));
        } catch {
          credMap.set(cred.credentialType, "");
        }
      }

      const appId = credMap.get("appId") ?? "";
      const appSecret = credMap.get("appSecret") ?? "";

      feishuAccounts[ch.accountId] = {
        enabled: true,
        appId,
        appSecret,
      };

      bindingsList.push({
        agentId: ch.botId,
        match: {
          channel: "feishu",
          accountId: ch.accountId,
        },
      });
    }
  }

  // Collect unique model IDs across all active bots for LiteLLM provider config
  const uniqueModelIds = [
    ...new Set(activeBots.map((b) => b.modelId).filter(Boolean) as string[]),
  ];
  const defaultModelId = resolveModelId(
    activeBots[0]?.modelId ??
      process.env.DEFAULT_MODEL_ID ??
      "anthropic/claude-sonnet-4",
  );

  const config: OpenClawConfig = {
    gateway: {
      port: 18789,
      mode: "local",
      bind: "lan",
      auth: {
        mode: "token",
        token: gatewayToken ?? process.env.GATEWAY_TOKEN ?? "gw-secret-token",
      },
      reload: { mode: "hybrid" },
      controlUi: {
        dangerouslyAllowHostHeaderOriginFallback: true,
      },
    },
    agents: {
      defaults: {
        model: { primary: defaultModelId },
        compaction: {
          mode: "safeguard",
          maxHistoryShare: 0.5,
          keepRecentTokens: 20000,
          memoryFlush: {
            enabled: true,
          },
        },
        ...(process.env.OPENROUTER_API_KEY
          ? {
              memorySearch: {
                enabled: true,
                sources: ["memory"],
                provider: "openai",
                model: "google/gemini-embedding-001",
                remote: {
                  baseUrl: "https://openrouter.ai/api/v1/",
                  apiKey: process.env.OPENROUTER_API_KEY,
                },
              },
            }
          : {}),
      },
      list: agentList,
    },
    tools: {
      exec: {
        security: "full",
        ask: "off",
        host: "gateway",
      },
      web: {
        search: { enabled: true },
        fetch: { enabled: true },
      },
    },
    cron: {
      enabled: true,
    },
    channels: {},
    bindings: bindingsList,
  };

  // Add LiteLLM model provider when configured via env vars
  if (litellmBaseUrl && litellmApiKey) {
    config.models = {
      mode: "merge",
      providers: {
        litellm: {
          baseUrl: litellmBaseUrl,
          apiKey: litellmApiKey,
          api: "openai-completions",
          models: uniqueModelIds.map((id) => ({
            id,
            name: id,
            reasoning: false,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 8192,
            compat: { supportsStore: false },
          })),
        },
      },
    };
  }

  if (Object.keys(slackAccounts).length > 0) {
    // Top-level signingSecret + mode required by OpenClaw gateway validation
    const firstAccount = Object.values(slackAccounts)[0];
    config.channels.slack = {
      mode: "http",
      signingSecret: firstAccount?.signingSecret ?? "",
      enabled: true,
      groupPolicy: "open",
      requireMention: false,
      dmPolicy: "open",
      allowFrom: ["*"],
      accounts: slackAccounts,
    };
  }

  if (Object.keys(discordAccounts).length > 0) {
    config.channels.discord = {
      enabled: true,
      groupPolicy: "open",
      dmPolicy: "open",
      allowFrom: ["*"],
      accounts: discordAccounts,
    };
  }

  if (Object.keys(feishuAccounts).length > 0) {
    config.channels.feishu = {
      enabled: true,
      connectionMode: "websocket",
      dmPolicy: "open",
      groupPolicy: "open",
      requireMention: true,
      allowFrom: ["*"],
      accounts: feishuAccounts,
    };
  }

  // Enable skill hot-reload watcher so OpenClaw picks up managed skills
  // written by the sidecar without requiring a restart.
  // extraDirs ensures OpenClaw scans the sidecar's write directory
  // (${stateDir}/skills) which may differ from OpenClaw's CONFIG_DIR/skills.
  config.skills = {
    load: {
      watch: true,
      watchDebounceMs: 250,
      extraDirs: [`${stateDir}/skills`],
    },
  };

  // Standard command config for multi-tenant gateway
  config.commands = {
    native: "auto",
    nativeSkills: "auto",
    restart: true,
    ownerDisplay: "raw",
  };

  const validated = openclawConfigSchema.parse(config);

  return validated;
}
