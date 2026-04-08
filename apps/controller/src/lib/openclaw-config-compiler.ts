import type { OpenClawConfig } from "@nexu/shared";
import { openclawConfigSchema } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { OAuthConnectionState } from "../runtime/openclaw-auth-profiles-store.js";
import type { NexuConfig } from "../store/schemas.js";
import {
  compileChannelBindings,
  compileChannelsConfig,
  resolveManagedChannelPluginId,
} from "./channel-binding-compiler.js";
import {
  buildProviderRuntimeModelId,
  buildProviderRuntimeModelRef,
  findProviderDescriptorForModelRef,
  listModelProviderRuntimeDescriptors,
  resolveModelProviderApiKey,
} from "./model-provider-runtime.js";
import { normalizeProviderBaseUrl } from "./provider-base-url.js";

export type { OAuthConnectionState };

const LINK_PROVIDER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
};

const EMPTY_OAUTH_CONNECTION_STATE: OAuthConnectionState = {
  connectedProviderIds: [],
};

const OAUTH_PROVIDER_MAP: Record<string, string> = {
  openai: "openai-codex",
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

  for (const descriptor of listModelProviderRuntimeDescriptors(config)) {
    if (!descriptor.provider.enabled) {
      continue;
    }

    const apiKey = resolveModelProviderApiKey(descriptor);
    if (apiKey === null && descriptor.provider.auth !== "oauth") {
      continue;
    }

    providers[descriptor.runtimeKey] = {
      baseUrl: descriptor.provider.baseUrl,
      apiKey: apiKey ?? "",
      api: descriptor.apiKind,
      ...(descriptor.authHeader ? { authHeader: true } : {}),
      ...(descriptor.defaultHeaders
        ? { headers: descriptor.defaultHeaders }
        : {}),
      models: descriptor.provider.models.map((model) =>
        buildModelEntry(
          buildProviderRuntimeModelId(descriptor, model.id),
          model.name,
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

  const descriptors = listModelProviderRuntimeDescriptors(config).filter(
    (descriptor) => descriptor.provider.enabled,
  );
  const matchedDescriptor = findProviderDescriptorForModelRef(
    descriptors,
    rawModelId,
  );

  if (matchedDescriptor) {
    const oauthTarget =
      OAUTH_PROVIDER_MAP[matchedDescriptor.descriptor.providerId];
    if (
      oauthTarget &&
      oauthState.connectedProviderIds.includes(
        matchedDescriptor.descriptor.providerId,
      )
    ) {
      return `${oauthTarget}/${matchedDescriptor.modelId}`;
    }

    return buildProviderRuntimeModelRef(
      matchedDescriptor.descriptor,
      matchedDescriptor.modelId,
    );
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
  installedSkillSlugs?: readonly string[],
  workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
): OpenClawConfig["agents"]["list"] {
  const sharedSlugs = installedSkillSlugs ?? [];

  return config.bots
    .filter((bot) => bot.status === "active")
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((bot, index) => {
      const workspaceSlugs = workspaceSkillsByAgent?.get(bot.id) ?? [];
      const merged = [...new Set([...sharedSlugs, ...workspaceSlugs])];

      return {
        id: bot.id,
        name: bot.name,
        workspace: `${env.openclawStateDir}/agents/${bot.id}`,
        default: index === 0,
        model: bot.modelId
          ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
          : undefined,
        ...(merged.length > 0 ? { skills: merged } : {}),
      };
    });
}

function compilePlugins(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig["plugins"] {
  const resolvedMiniMaxOauth = listModelProviderRuntimeDescriptors(config).some(
    (descriptor) =>
      descriptor.providerId === "minimax" &&
      descriptor.provider.enabled &&
      descriptor.provider.auth === "oauth" &&
      descriptor.legacyOauthCredential !== null,
  );

  const connectedPluginIds = [
    ...new Set(
      config.channels
        .filter((channel) => channel.status === "connected")
        .map((channel) => resolveManagedChannelPluginId(channel.channelType))
        .filter((pluginId): pluginId is string => pluginId !== null),
    ),
  ];
  const platformPluginIds = [
    "nexu-runtime-model",
    "nexu-credit-guard",
    "nexu-platform-bootstrap",
    ...(resolvedMiniMaxOauth ? ["minimax-portal-auth"] : []),
  ];

  // Sort and dedup defensively so `plugins.allow` is fully deterministic.
  // Without this, channel reorderings or brief status flaps change the
  // output order, which OpenClaw treats as a config change and triggers
  // a SIGUSR1 restart + 11s gateway drain per reload.
  const allow = Array.from(
    new Set([...connectedPluginIds, ...platformPluginIds]),
  ).sort();

  return {
    load: {
      paths: [env.openclawExtensionsDir],
    },
    allow,
    entries: {
      feishu: {
        enabled: true,
      },
      "openclaw-weixin": {
        enabled: true,
      },
      ...(connectedPluginIds.includes("dingtalk-connector")
        ? {
            "dingtalk-connector": {
              enabled: true,
            },
          }
        : {}),
      ...(connectedPluginIds.includes("wecom")
        ? {
            wecom: {
              enabled: true,
            },
          }
        : {}),
      ...(connectedPluginIds.includes("openclaw-qqbot")
        ? {
            "openclaw-qqbot": {
              enabled: true,
            },
          }
        : {}),
      "nexu-runtime-model": {
        enabled: true,
      },
      "nexu-credit-guard": {
        enabled: true,
        config: {
          contactUrl: "https://nexu.app/contact",
        },
      },
      ...(resolvedMiniMaxOauth
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
  installedSkillSlugs?: readonly string[],
  workspaceSkillsByAgent?: ReadonlyMap<string, readonly string[]>,
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
          // "safeguard" mode: Pi framework auto-compacts when prompt
          // approaches context window. The safeguard extension (compaction-
          // safeguard.ts) handles LLM summarization with quality guards.
          mode: "safeguard",
          // Max fraction of context window for retained history after
          // compaction. 0.3 = 70% reserved for system prompt + response.
          // Tested: 0.5 was too tight for models with large system prompts.
          maxHistoryShare: 0.3,
          keepRecentTokens: 20000,
          recentTurnsPreserve: 5,
          qualityGuard: { enabled: true },
          memoryFlush: {
            enabled: true,
          },
        },
        // LLM call timeout. Default is 600s (10min) which causes the bot to
        // appear unresponsive when the provider is down. 300s (5min) leaves
        // room for reasoning models (o1/o3 long thinking chains) while
        // cutting max wait time in half. Aligns with compaction's own 300s
        // safety timeout (EMBEDDED_COMPACTION_TIMEOUT_MS).
        timeoutSeconds: 300,
        humanDelay: {
          mode: "off",
        },
        verboseDefault: "off",
      },
      list: compileAgentList(
        config,
        env,
        oauthState,
        installedSkillSlugs,
        workspaceSkillsByAgent,
      ),
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
      // Disable automatic session reset. OpenClaw defaults to daily reset at
      // 4 AM which silently drops conversation history — unexpected for a
      // desktop chat app where users expect persistent sessions.
      reset: {
        mode: "idle",
        idleMinutes: 525_600, // 1 year
      },
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
      controllerBaseUrl: `http://127.0.0.1:${env.port}`,
    }),
    bindings: compileChannelBindings(config.bots, config.channels),
    plugins: compilePlugins(config, env),
    skills: {
      load: {
        watch: true,
        watchDebounceMs: 250,
        extraDirs: [env.openclawSkillsDir, env.userSkillsDir].filter(Boolean),
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
