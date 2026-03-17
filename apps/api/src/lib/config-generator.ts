import * as fs from "node:fs";
import * as path from "node:path";
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
  modelProviders,
} from "../db/schema/index.js";
import { decrypt } from "./crypto.js";
import { ServiceError } from "./error.js";

/**
 * Load cloud connection credentials (Link gateway) in desktop mode.
 * Returns null if not in desktop mode or no credentials exist.
 */
function loadCloudConfig(): {
  linkUrl: string;
  apiKey: string;
  models: Array<{ id: string; name: string; provider?: string }>;
} | null {
  if (process.env.NEXU_DESKTOP_MODE !== "true") return null;

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
  const credPath = path.join(stateDir, "cloud-credentials.json");
  if (!fs.existsSync(credPath)) return null;

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (!creds.encryptedApiKey || !creds.linkGatewayUrl) return null;
    return {
      linkUrl: creds.linkGatewayUrl,
      apiKey: decrypt(creds.encryptedApiKey),
      models: creds.cloudModels ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Read the user-selected default model from desktop state file.
 * Returns null if not in desktop mode or no selection exists.
 */
function loadDesktopSelectedModel(): string | null {
  if (process.env.NEXU_DESKTOP_MODE !== "true") return null;
  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
  const configPath = path.join(stateDir, "desktop-config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return cfg.selectedModelId || null;
  } catch {
    return null;
  }
}

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
  connectionMode: string | null;
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
        connectionMode: channel.connectionMode,
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

  // Link gateway provider (desktop cloud connection)
  const cloudCfg = loadCloudConfig();
  const hasLink = Boolean(cloudCfg && cloudCfg.models.length > 0);

  // Prefix model ID with provider namespace for routing
  function resolveModelId(rawModelId: string): string {
    if (rawModelId.startsWith("litellm/") || rawModelId.startsWith("link/"))
      return rawModelId;
    if (hasLitellm) return `litellm/${rawModelId}`;
    if (hasLink) return `link/${rawModelId}`;
    return rawModelId;
  }

  // Workspace path must be under the PVC mount so agent files survive pod restarts.
  // OPENCLAW_STATE_DIR is set to /data/openclaw in production (the PVC mount point).
  const stateDir = process.env.OPENCLAW_STATE_DIR ?? "/data/openclaw";

  const agentList: AgentConfig[] = activeBots.map((bot, index) => {
    const agent: AgentConfig = {
      id: bot.id,
      name: bot.name,
      workspace: `${stateDir}/agents/${bot.id}`,
    };

    if (index === 0) {
      agent.default = true;
    }

    if (bot.modelId) {
      agent.model = { primary: resolveModelId(bot.modelId) };
    }

    // Per-agent /tmp bind so the sandbox fs-bridge recognises /tmp as
    // a writable mount.  Without this, the Write tool rejects /tmp paths
    // because tmpfs mounts are invisible to the path-safety guard.
    // Override tmpfs to exclude /tmp — Docker rejects duplicate mount points
    // when both a bind mount and tmpfs target the same path.
    if (process.env.SANDBOX_ENABLED === "true") {
      (agent as Record<string, unknown>).sandbox = {
        docker: {
          binds: [`${stateDir}/agents/${bot.id}/.tmp:/tmp:rw`],
          tmpfs: ["/var/tmp", "/run"],
        },
      };
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

      // Socket mode for local dev: set SLACK_SOCKET_MODE_APP_TOKEN in .env
      const socketAppToken = process.env.SLACK_SOCKET_MODE_APP_TOKEN;
      const useSocket = !!socketAppToken;

      slackAccounts[ch.accountId] = {
        enabled: true,
        botToken,
        signingSecret,
        mode: useSocket ? "socket" : "http",
        webhookPath: useSocket ? undefined : `/slack/events/${ch.accountId}`,
        appToken: useSocket
          ? socketAppToken
          : "xapp-placeholder-not-used-in-http-mode",
        streaming: "partial",
        replyToMode: "off",
        typingReaction: "hourglass_flowing_sand",
        // Explicit per-account policies so `openclaw doctor --fix` cannot
        // break routing by moving top-level defaults into accounts.default.
        groupPolicy: "open",
        dmPolicy: "open",
        allowFrom: ["*"],
        requireMention: true,
        ackReaction: "eyes",
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
      const verificationToken = credMap.get("verificationToken") ?? "";

      const feishuAccount: FeishuAccountConfig = {
        enabled: true,
        appId,
        appSecret,
      };

      if (ch.connectionMode === "webhook") {
        feishuAccount.connectionMode = "webhook";
        feishuAccount.webhookPath = `/feishu/events/${ch.accountId}`;
        feishuAccount.webhookPort = 18790;
        feishuAccount.webhookHost = "0.0.0.0";
        if (verificationToken) {
          feishuAccount.verificationToken = verificationToken;
        }
      } else {
        feishuAccount.connectionMode = "websocket";
      }

      feishuAccounts[ch.accountId] = feishuAccount;

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
      loadDesktopSelectedModel() ??
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
      tools: {
        allow: ["cron"],
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
                sources: ["memory", "sessions"],
                provider: "openai",
                model: "google/gemini-embedding-001",
                remote: {
                  baseUrl: "https://openrouter.ai/api/v1/",
                  apiKey: process.env.OPENROUTER_API_KEY,
                },
                sync: {
                  intervalMinutes: 5,
                },
              },
            }
          : {}),
        ...(process.env.SANDBOX_ENABLED === "true"
          ? {
              sandbox: {
                mode: "all" as const,
                scope: "agent" as const,
                workspaceAccess: "rw" as const,
                docker: {
                  image: process.env.SANDBOX_IMAGE ?? "nexu-sandbox:latest",
                  memory: "256m",
                  cpus: 0.5,
                  pidsLimit: 128,
                  network: "bridge",
                  capDrop: ["ALL"],
                  dangerouslyAllowExternalBindSources: true,
                  binds: [
                    `${stateDir}/skills:${stateDir}/skills:ro`,
                    `${stateDir}/media:${stateDir}/media:rw`,
                    `${stateDir}/nexu-context.json:${stateDir}/nexu-context.json:ro`,
                    // Map PVC plugin-docs to the OpenClaw extensions path so
                    // agents can read extension SKILL.md files from sandbox.
                    `${stateDir}/plugin-docs:${process.env.SANDBOX_EXTENSIONS_TARGET ?? "/usr/local/lib/node_modules/openclaw/extensions"}:ro`,
                  ],
                  env: {
                    OPENCLAW_STATE_DIR: stateDir,
                    RUNTIME_API_BASE_URL:
                      process.env.RUNTIME_API_BASE_URL ||
                      process.env.NEXU_API_URL ||
                      "",
                    SKILL_API_TOKEN: process.env.SKILL_API_TOKEN ?? "",
                    // Ensure skill scripts can resolve globally-installed
                    // npm packages (e.g. sharp in nano-banana).
                    NODE_PATH: "/usr/local/lib/node_modules",
                  },
                },
                browser: {
                  enabled: false,
                },
                prune: {
                  idleHours: 4,
                  maxAgeDays: 3,
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
        host: process.env.SANDBOX_ENABLED === "true" ? "sandbox" : "gateway",
      },
      web: {
        search: {
          enabled: true,
          ...(process.env.BRAVE_API_KEY
            ? { provider: "brave", apiKey: process.env.BRAVE_API_KEY }
            : {}),
        },
        fetch: { enabled: true },
      },
      // Override sandbox tool policy:
      // - Empty allow list = "allow everything not in the deny list"
      //   (unblocks plugin tools like feishu_doc, feishu_chat, etc.)
      // - Custom deny list = only "gateway" (direct gateway control)
      //   All other DEFAULT_TOOL_DENY entries (browser, canvas, nodes,
      //   cron, channel tools) are intentionally unblocked.
      ...(process.env.SANDBOX_ENABLED === "true"
        ? { sandbox: { tools: { allow: [], deny: ["gateway"] } } }
        : {}),
    },
    session: {
      dmScope: "per-peer",
    },
    cron: {
      enabled: true,
    },
    messages: {
      ackReaction: "eyes",
      ackReactionScope: "group-mentions",
      removeAckAfterReply: true,
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

  // Add Link gateway provider when cloud-connected in desktop mode
  if (cloudCfg && cloudCfg.models.length > 0) {
    const linkProvider = {
      baseUrl: `${cloudCfg.linkUrl}/v1`,
      apiKey: cloudCfg.apiKey,
      api: "openai-completions",
      models: cloudCfg.models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
        compat: { supportsStore: false },
      })),
    };

    if (config.models) {
      config.models.providers.link = linkProvider;
    } else {
      config.models = {
        mode: "merge",
        providers: { link: linkProvider },
      };
    }
  }

  // Add BYOK (user-provided) providers from database
  const byokProviders = await db
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.enabled, true));

  const byokDefaultBaseUrls: Record<string, string> = {
    anthropic: "https://api.anthropic.com/v1",
    openai: "https://api.openai.com/v1",
    google: "https://generativelanguage.googleapis.com/v1beta/openai",
  };

  for (const bp of byokProviders) {
    const providerKey =
      bp.providerId === "custom" ? `custom_${bp.id}` : bp.providerId;
    const baseUrl = bp.baseUrl ?? byokDefaultBaseUrls[bp.providerId];
    if (!baseUrl) continue;

    const modelIds: string[] = JSON.parse(bp.modelsJson || "[]");
    const byokProvider = {
      baseUrl,
      apiKey: decrypt(bp.encryptedApiKey),
      api: "openai-completions",
      models: modelIds.map((id) => ({
        id,
        name: id,
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
        compat: { supportsStore: false },
      })),
    };

    if (config.models) {
      config.models.providers[providerKey] = byokProvider;
    } else {
      config.models = {
        mode: "merge",
        providers: { [providerKey]: byokProvider },
      };
    }
  }

  if (Object.keys(slackAccounts).length > 0) {
    // Top-level signingSecret + mode required by OpenClaw gateway validation
    const firstAccount = Object.values(slackAccounts)[0];
    config.channels.slack = {
      mode: process.env.SLACK_SOCKET_MODE_APP_TOKEN ? "socket" : "http",
      signingSecret: firstAccount?.signingSecret ?? "",
      enabled: true,
      groupPolicy: "open",
      requireMention: true,
      dmPolicy: "open",
      allowFrom: ["*"],
      ackReaction: "eyes",
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
      // Streaming disabled: long responses cause duplicate delivery (streaming
      // card + chunked final cards) because deliveredFinalTexts dedup fails
      // when mergeStreamingText diverges from the final text payload.
      // TODO: re-enable after OpenClaw fixes feishu streaming dedup for long text.
      streaming: false,
      renderMode: "card",
      dmPolicy: "open",
      groupPolicy: "open",
      requireMention: true,
      allowFrom: ["*"],
      tools: {
        doc: true,
        chat: true,
        wiki: true,
        drive: true,
        perm: true,
        scopes: true,
      },
      accounts: feishuAccounts,
    };

    // Feishu is a plugin-based channel; explicitly enable it so OpenClaw
    // loads the plugin without needing `openclaw doctor --fix`.
    config.plugins = {
      ...config.plugins,
      entries: {
        ...config.plugins?.entries,
        feishu: { enabled: true },
      },
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
    ownerAllowFrom: ["*"],
  };

  // Enable OpenTelemetry diagnostics via Datadog direct OTLP intake or
  // a local Agent/Collector.  DD_API_KEY triggers agentless mode (sends
  // directly to https://otlp.datadoghq.com); OTEL_EXPORTER_OTLP_ENDPOINT
  // overrides the endpoint for Agent-based setups.
  const ddApiKey = process.env.DD_API_KEY;
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (ddApiKey || otelEndpoint) {
    const otelConfig: Record<string, unknown> = {
      enabled: true,
      endpoint:
        otelEndpoint ??
        `https://otlp.${process.env.DD_SITE ?? "datadoghq.com"}`,
      serviceName: process.env.OTEL_SERVICE_NAME ?? "nexu-openclaw",
      traces: true,
      metrics: true,
      logs: true,
    };
    if (ddApiKey) {
      otelConfig.headers = { "dd-api-key": ddApiKey };
    }
    config.diagnostics = { enabled: true, otel: otelConfig };
  }

  const validated = openclawConfigSchema.parse(config);

  return validated;
}
