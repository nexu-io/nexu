import type { OpenClawConfig } from "@nexu/shared";
import { openclawConfigSchema } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { NexuConfig } from "../store/schemas.js";
import {
  compileChannelBindings,
  compileChannelsConfig,
} from "./channel-binding-compiler.js";
import { normalizeProviderBaseUrl } from "./provider-base-url.js";

const BYOK_DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

function isDesktopCloudConfig(value: unknown): value is {
  linkUrl: string;
  apiKey: string;
  models: Array<{ id: string; name: string; provider?: string }>;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.linkUrl === "string" &&
    typeof candidate.apiKey === "string" &&
    Array.isArray(candidate.models)
  );
}

function getDesktopSelectedModel(config: NexuConfig): string | null {
  const selectedModelId = config.desktop.selectedModelId;
  return typeof selectedModelId === "string" && selectedModelId.length > 0
    ? selectedModelId
    : null;
}

function isByokProviderProxied(
  providerId: string,
  baseUrl: string | null,
): boolean {
  const defaultBaseUrl = normalizeProviderBaseUrl(
    BYOK_DEFAULT_BASE_URLS[providerId],
  );
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl);

  return Boolean(
    defaultBaseUrl && normalizedBaseUrl && normalizedBaseUrl !== defaultBaseUrl,
  );
}

function getByokProviderKey(input: {
  id: string;
  providerId: string;
  baseUrl: string | null;
}): string {
  if (input.providerId === "custom") {
    return `custom_${input.id}`;
  }

  return isByokProviderProxied(input.providerId, input.baseUrl)
    ? `byok_${input.providerId}`
    : input.providerId;
}

function getByokProviderModelId(
  providerKey: string,
  providerId: string,
  modelId: string,
): string {
  return providerKey === `byok_${providerId}`
    ? `${providerId}/${modelId}`
    : modelId;
}

function buildModelEntry(id: string, name?: string) {
  return {
    id,
    name: name ?? id,
    reasoning: false,
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 8192,
    compat: {
      supportsStore: false,
    },
  };
}

function compileModelsConfig(config: NexuConfig): OpenClawConfig["models"] {
  const providers: NonNullable<OpenClawConfig["models"]>["providers"] = {};

  for (const provider of config.providers.filter(
    (item) => item.enabled && item.apiKey !== null,
  )) {
    const providerKey = getByokProviderKey({
      id: provider.id,
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
    });
    const baseUrl =
      normalizeProviderBaseUrl(
        provider.baseUrl ?? BYOK_DEFAULT_BASE_URLS[provider.providerId],
      ) ?? normalizeProviderBaseUrl(BYOK_DEFAULT_BASE_URLS.openai);

    if (baseUrl === null) {
      continue;
    }

    providers[providerKey] = {
      baseUrl,
      apiKey: provider.apiKey ?? "",
      api: "openai-completions",
      models: provider.models.map((modelId) =>
        buildModelEntry(
          getByokProviderModelId(providerKey, provider.providerId, modelId),
          modelId,
        ),
      ),
    };
  }

  const desktopCloud = isDesktopCloudConfig(config.desktop.cloud)
    ? config.desktop.cloud
    : null;
  if (desktopCloud && desktopCloud.models.length > 0) {
    providers.link = {
      baseUrl: `${normalizeProviderBaseUrl(desktopCloud.linkUrl) ?? desktopCloud.linkUrl}/v1`,
      apiKey: desktopCloud.apiKey,
      api: "openai-completions",
      models: desktopCloud.models.map((model) =>
        buildModelEntry(model.id, model.name),
      ),
    };
  }

  return Object.keys(providers).length > 0
    ? {
        mode: "merge",
        providers,
      }
    : undefined;
}

function resolveModelId(config: NexuConfig, rawModelId: string): string {
  if (rawModelId.startsWith("litellm/") || rawModelId.startsWith("link/")) {
    return rawModelId;
  }

  const byokPrefixToKey = new Map<string, string>();
  for (const provider of config.providers.filter((item) => item.enabled)) {
    byokPrefixToKey.set(
      provider.providerId,
      getByokProviderKey({
        id: provider.id,
        providerId: provider.providerId,
        baseUrl: provider.baseUrl,
      }),
    );
  }

  const slashIndex = rawModelId.indexOf("/");
  if (slashIndex > 0) {
    const prefix = rawModelId.slice(0, slashIndex);
    const byokKey = byokPrefixToKey.get(prefix);
    if (byokKey) {
      return byokKey === prefix ? rawModelId : `${byokKey}/${rawModelId}`;
    }
  }

  if (isDesktopCloudConfig(config.desktop.cloud)) {
    return `link/${rawModelId}`;
  }

  return rawModelId;
}

function compileAgentList(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["agents"]["list"] {
  return config.bots
    .filter((bot) => bot.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((bot, index) => ({
      id: bot.id,
      name: bot.name,
      workspace: `${env.openclawStateDir}/agents/${bot.id}`,
      default: index === 0,
      model: bot.modelId
        ? { primary: resolveModelId(config, bot.modelId) }
        : undefined,
    }));
}

function compilePlugins(config: NexuConfig): OpenClawConfig["plugins"] {
  const hasFeishu = config.channels.some(
    (channel) =>
      channel.channelType === "feishu" && channel.status === "connected",
  );

  return hasFeishu
    ? {
        entries: {
          feishu: {
            enabled: true,
          },
        },
      }
    : undefined;
}

export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig {
  const activeBots = config.bots.filter((bot) => bot.status === "active");
  const firstBotModel = activeBots[0]?.modelId ?? null;
  const defaultModelId = resolveModelId(
    config,
    firstBotModel ??
      getDesktopSelectedModel(config) ??
      config.runtime.defaultModelId,
  );

  const openClawConfig: OpenClawConfig = {
    gateway: {
      port: config.runtime.gateway.port,
      mode: "local",
      bind: config.runtime.gateway.bind,
      auth: {
        mode: config.runtime.gateway.authMode,
        ...(env.openclawGatewayToken
          ? { token: env.openclawGatewayToken }
          : {}),
      },
      reload: {
        mode: "hybrid",
      },
      controlUi: {
        allowedOrigins: [env.webUrl],
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
      },
      list: compileAgentList(config, env),
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
        fetch: {
          enabled: true,
        },
      },
      ...(process.env.SANDBOX_ENABLED === "true"
        ? {
            sandbox: {
              tools: {
                allow: [],
                deny: ["gateway"],
              },
            },
          }
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
    models: compileModelsConfig(config),
    channels: compileChannelsConfig({
      channels: config.channels,
      secrets: config.secrets,
    }),
    bindings: compileChannelBindings(config.bots, config.channels),
    plugins: compilePlugins(config),
    skills: {
      load: {
        watch: true,
        watchDebounceMs: 250,
        extraDirs: [env.openclawSkillsDir],
      },
    },
    commands: {
      native: "auto",
      nativeSkills: "auto",
      restart: true,
      ownerDisplay: "raw",
      ownerAllowFrom: ["*"],
    },
    diagnostics: {
      enabled: true,
      ...(process.env.DD_API_KEY || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? {
            otel: {
              enabled: true,
              endpoint:
                process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
                `https://otlp.${process.env.DD_SITE ?? "datadoghq.com"}`,
              serviceName: process.env.OTEL_SERVICE_NAME ?? "nexu-openclaw",
              traces: true,
              metrics: true,
              logs: true,
              ...(process.env.DD_API_KEY
                ? {
                    headers: {
                      "dd-api-key": process.env.DD_API_KEY,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  };

  return openclawConfigSchema.parse(openClawConfig);
}
