import type {
  AgentConfig,
  BindingConfig,
  DiscordAccountConfig,
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
    throw new Error(`Pool ${poolIdOrName} not found`);
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

  const agentList: AgentConfig[] = activeBots.map((bot, index) => {
    const agent: AgentConfig = {
      id: bot.slug,
      name: bot.name,
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
      };

      bindingsList.push({
        agentId: ch.botSlug,
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
        agentId: ch.botSlug,
        match: {
          channel: "discord",
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
      },
      list: agentList,
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
      accounts: discordAccounts,
    };
  }

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
