import type { OpenClawConfig } from "@nexu/shared";
import { openclawConfigSchema } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { OAuthConnectionState } from "../runtime/openclaw-auth-profiles-store.js";
import type { NexuConfig } from "../store/schemas.js";
import { isSupportedByokProviderId } from "./byok-providers.js";
import {
  compileChannelBindings,
  compileChannelsConfig,
} from "./channel-binding-compiler.js";
import { normalizeProviderBaseUrl } from "./provider-base-url.js";

export type { OAuthConnectionState };

const BYOK_DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  siliconflow: "https://api.siliconflow.com/v1",
  ppio: "https://api.ppinfra.com/v3/openai",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimax.io/anthropic",
  kimi: "https://api.moonshot.cn/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  zai: "https://open.bigmodel.cn/api/paas/v4",
};

const LINK_PROVIDER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
};

const EMPTY_OAUTH_CONNECTION_STATE: OAuthConnectionState = {
  connectedProviderIds: [],
};

const OAUTH_PROVIDER_MAP: Record<string, string> = {
  openai: "openai-codex",
};

function resolveByokDefaultBaseUrl(input: {
  providerId: string;
  oauthRegion: "global" | "cn" | null;
}): string | undefined {
  const openclawProviderId = resolveOpenClawProviderId(input.providerId);

  if (openclawProviderId === "minimax" && input.oauthRegion === "cn") {
    return "https://api.minimaxi.com/anthropic";
  }

  return BYOK_DEFAULT_BASE_URLS[openclawProviderId];
}

function resolveOpenClawProviderId(providerId: string): string {
  switch (providerId) {
    case "kimi":
      return "moonshot";
    case "glm":
      return "zai";
    default:
      return providerId;
  }
}

function resolveOpenClawProviderApi(providerId: string): string {
  switch (resolveOpenClawProviderId(providerId)) {
    case "minimax":
      return "anthropic-messages";
    default:
      return "openai-completions";
  }
}

function resolveOpenClawProviderAuthHeader(
  providerId: string,
): boolean | undefined {
  return resolveOpenClawProviderId(providerId) === "minimax" ? true : undefined;
}

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
  oauthRegion: "global" | "cn" | null,
): boolean {
  const defaultBaseUrl = normalizeProviderBaseUrl(
    resolveByokDefaultBaseUrl({ providerId, oauthRegion }),
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
  oauthRegion: "global" | "cn" | null;
}): string {
  const openclawProviderId = resolveOpenClawProviderId(input.providerId);
  return isByokProviderProxied(
    input.providerId,
    input.baseUrl,
    input.oauthRegion,
  )
    ? `byok_${openclawProviderId}`
    : openclawProviderId;
}

function getByokProviderModelId(
  providerKey: string,
  providerId: string,
  modelId: string,
): string {
  const openclawProviderId = resolveOpenClawProviderId(providerId);
  return providerKey === `byok_${openclawProviderId}`
    ? `${openclawProviderId}/${modelId}`
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

function collectLitellmModelIds(config: NexuConfig): string[] {
  const selectedModelId = getDesktopSelectedModel(config);
  const candidateIds = [
    ...config.bots.map((bot) => bot.modelId),
    config.runtime.defaultModelId,
    selectedModelId,
  ];

  return [...new Set(candidateIds)]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    .map((value) => value.replace(/^litellm\//, ""))
    .filter(
      (value) => !value.startsWith("link/") && !value.startsWith("debug/"),
    );
}

function compileModelsConfig(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["models"] {
  const providers: NonNullable<OpenClawConfig["models"]>["providers"] = {};

  if (env.litellmBaseUrl && env.litellmApiKey) {
    providers.litellm = {
      baseUrl: env.litellmBaseUrl,
      apiKey: env.litellmApiKey,
      api: "openai-completions",
      models: collectLitellmModelIds(config).map((modelId) =>
        buildModelEntry(modelId),
      ),
    };
  }

  for (const provider of config.providers.filter(
    (item) =>
      item.enabled &&
      (item.apiKey !== null || item.authMode === "oauth") &&
      isSupportedByokProviderId(item.providerId),
  )) {
    const providerKey = getByokProviderKey({
      id: provider.id,
      providerId: provider.providerId,
      baseUrl: provider.baseUrl,
      oauthRegion: provider.oauthRegion,
    });
    const baseUrl =
      normalizeProviderBaseUrl(
        provider.baseUrl ??
          resolveByokDefaultBaseUrl({
            providerId: provider.providerId,
            oauthRegion: provider.oauthRegion,
          }),
      ) ?? normalizeProviderBaseUrl(BYOK_DEFAULT_BASE_URLS.openai);

    if (baseUrl === null) {
      continue;
    }

    providers[providerKey] = {
      baseUrl,
      apiKey:
        provider.authMode === "oauth"
          ? (provider.oauthCredential?.access ?? "")
          : (provider.apiKey ?? ""),
      api: resolveOpenClawProviderApi(provider.providerId),
      ...(resolveOpenClawProviderAuthHeader(provider.providerId)
        ? { authHeader: true }
        : {}),
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
      headers: LINK_PROVIDER_HEADERS,
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

export function resolveModelId(
  config: NexuConfig,
  env: ControllerEnv,
  rawModelId: string,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
): string {
  if (rawModelId.startsWith("litellm/") || rawModelId.startsWith("link/")) {
    return rawModelId;
  }

  const byokPrefixToKey = new Map<string, string>();
  const byokPrefixToProvider = new Map<string, string>();
  for (const provider of config.providers.filter((item) => item.enabled)) {
    if (!isSupportedByokProviderId(provider.providerId)) {
      continue;
    }

    const openclawProviderId = resolveOpenClawProviderId(provider.providerId);
    byokPrefixToKey.set(
      provider.providerId,
      getByokProviderKey({
        id: provider.id,
        providerId: provider.providerId,
        baseUrl: provider.baseUrl,
        oauthRegion: provider.oauthRegion,
      }),
    );
    byokPrefixToProvider.set(provider.providerId, openclawProviderId);
  }

  const slashIndex = rawModelId.indexOf("/");
  if (slashIndex > 0) {
    const prefix = rawModelId.slice(0, slashIndex);
    const modelSuffix = rawModelId.slice(slashIndex + 1);
    const byokKey = byokPrefixToKey.get(prefix);
    const openclawProviderId = byokPrefixToProvider.get(prefix);
    if (byokKey && openclawProviderId) {
      const oauthTarget = OAUTH_PROVIDER_MAP[prefix];
      if (oauthTarget) {
        const provider = config.providers.find(
          (item) => item.providerId === prefix,
        );
        if (
          provider?.enabled &&
          oauthState.connectedProviderIds.includes(prefix)
        ) {
          return `${oauthTarget}/${modelSuffix}`;
        }
      }

      const providerScopedModelId = `${openclawProviderId}/${modelSuffix}`;
      return byokKey === openclawProviderId
        ? providerScopedModelId
        : `${byokKey}/${providerScopedModelId}`;
    }
  }

  if (isDesktopCloudConfig(config.desktop.cloud)) {
    const cloudModels = config.desktop.cloud.models;
    const slashIndex = rawModelId.indexOf("/");
    const modelSuffix =
      slashIndex > 0 ? rawModelId.slice(slashIndex + 1) : null;
    // Only use Link fallback if the model actually exists in Link's model list
    if (cloudModels.some((m) => m.id === rawModelId)) {
      return `link/${rawModelId}`;
    }
    if (
      modelSuffix &&
      cloudModels.some((m) => m.id === modelSuffix || m.name === modelSuffix)
    ) {
      return `link/${modelSuffix}`;
    }
  }

  if (env.litellmBaseUrl && env.litellmApiKey) {
    return `litellm/${rawModelId}`;
  }

  return rawModelId;
}

function compileAgentList(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
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
        ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
        : undefined,
    }));
}

function compilePlugins(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["plugins"] {
  const hasMiniMaxOauth = config.providers.some(
    (provider) =>
      provider.providerId === "minimax" &&
      provider.enabled &&
      provider.authMode === "oauth" &&
      provider.oauthCredential !== null,
  );

  return {
    load: {
      paths: [env.openclawExtensionsDir],
    },
    entries: {
      feishu: {
        enabled: true,
      },
      "openclaw-weixin": {
        enabled: true,
      },
      "nexu-runtime-model": {
        enabled: true,
      },
      ...(hasMiniMaxOauth
        ? {
            "minimax-portal-auth": {
              enabled: true,
            },
          }
        : {}),
    },
  };
}

export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
  oauthState: OAuthConnectionState = EMPTY_OAUTH_CONNECTION_STATE,
): OpenClawConfig {
  const activeBots = config.bots.filter((bot) => bot.status === "active");
  const firstBotModel = activeBots[0]?.modelId ?? null;
  const defaultModelId = resolveModelId(
    config,
    env,
    firstBotModel ??
      getDesktopSelectedModel(config) ??
      config.runtime.defaultModelId,
    oauthState,
  );

  const openClawConfig: OpenClawConfig = {
    gateway: {
      port: env.openclawGatewayPort,
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
        humanDelay: {
          mode: "off",
        },
        verboseDefault: "on",
      },
      list: compileAgentList(config, env, oauthState),
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
    models: compileModelsConfig(config, env),
    channels: compileChannelsConfig({
      channels: config.channels,
      secrets: config.secrets,
    }),
    bindings: compileChannelBindings(config.bots, config.channels),
    plugins: compilePlugins(config, env),
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
