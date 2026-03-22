import crypto from "node:crypto";
import type {
  BotResponse,
  ChannelResponse,
  ConnectDiscordInput,
  ConnectFeishuInput,
  ConnectSlackInput,
} from "@nexu/shared";
import {
  type connectIntegrationResponseSchema,
  type connectIntegrationSchema,
  type integrationResponseSchema,
  type providerResponseSchema,
  type refreshIntegrationSchema,
  type updateAuthSourceSchema,
  type updateUserProfileSchema,
  type upsertProviderBodySchema,
  userProfileResponseSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { LowDbStore } from "./lowdb-store.js";
import {
  type ControllerProvider,
  type ControllerRuntimeConfig,
  type NexuConfig,
  nexuConfigSchema,
  type storedProviderResponseSchema,
} from "./schemas.js";

type ProviderResponse = z.infer<typeof providerResponseSchema>;
type UpsertProviderBody = z.infer<typeof upsertProviderBodySchema>;
type IntegrationResponse = z.infer<typeof integrationResponseSchema>;
type StoredProviderResponse = z.infer<typeof storedProviderResponseSchema>;
type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;
type ConnectIntegrationResponse = z.infer<
  typeof connectIntegrationResponseSchema
>;
type RefreshIntegrationInput = z.infer<typeof refreshIntegrationSchema>;
type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;
type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
type UpdateAuthSourceInput = z.infer<typeof updateAuthSourceSchema>;

type CloudModel = { id: string; name: string; provider?: string };

type CloudPollingState = {
  deviceId: string;
  deviceSecret: string;
  abortController: AbortController;
};

export type DesktopCloudStateChange = {
  hadCloudInventory: boolean;
  hasCloudInventory: boolean;
  connected: boolean;
};

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  const cause = error.cause;

  if (cause && typeof cause === "object") {
    const code = "code" in cause ? cause.code : undefined;
    const message = "message" in cause ? cause.message : undefined;

    if (typeof code === "string" && code.length > 0) {
      parts.push(code);
    }

    if (typeof message === "string" && message.length > 0) {
      parts.push(message);
    }
  }

  return parts.join(" | ");
}

function buildLinkModelsUrl(baseUrl: string): string {
  return new URL(
    "v1/models",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}

type CloudPollResponse = {
  status: string;
  apiKey?: string;
  userName?: string;
  userEmail?: string;
  cloudModels?: CloudModel[];
  linkGatewayUrl?: string;
};

function defaultLocalProfile(): UserProfileResponse {
  return {
    id: "desktop-local-user",
    email: "desktop@nexu.local",
    name: "Desktop User",
    image: null,
    plan: "local",
    inviteAccepted: true,
    onboardingCompleted: true,
    authSource: "desktop-local",
  };
}

function readLocalProfile(config: NexuConfig): UserProfileResponse {
  const desktop = config.desktop as Record<string, unknown>;
  const parsed = userProfileResponseSchema.safeParse(desktop.localProfile);
  return parsed.success ? parsed.data : defaultLocalProfile();
}

function readDesktopCloud(config: NexuConfig): {
  connected: boolean;
  polling: boolean;
  userName?: string | null;
  userEmail?: string | null;
  connectedAt?: string | null;
  linkUrl?: string;
  apiKey?: string;
  models?: Array<{ id: string; name: string; provider?: string }>;
} {
  const desktop = config.desktop as Record<string, unknown>;
  const cloud =
    typeof desktop.cloud === "object" && desktop.cloud !== null
      ? (desktop.cloud as Record<string, unknown>)
      : null;

  return {
    connected: cloud?.connected === true,
    polling: cloud?.polling === true,
    userName: typeof cloud?.userName === "string" ? cloud.userName : null,
    userEmail: typeof cloud?.userEmail === "string" ? cloud.userEmail : null,
    connectedAt:
      typeof cloud?.connectedAt === "string" ? cloud.connectedAt : null,
    linkUrl: typeof cloud?.linkUrl === "string" ? cloud.linkUrl : undefined,
    apiKey: typeof cloud?.apiKey === "string" ? cloud.apiKey : undefined,
    models: Array.isArray(cloud?.models)
      ? (cloud.models as Array<{ id: string; name: string; provider?: string }>)
      : [],
  };
}

function readDesktopLocale(config: NexuConfig): "en" | "zh-CN" | null {
  const desktop = config.desktop as Record<string, unknown>;
  if (desktop.locale === "zh-CN") {
    return "zh-CN";
  }
  if (desktop.locale === "en") {
    return "en";
  }
  return null;
}

function now(): string {
  return new Date().toISOString();
}

function parseModelsJson(modelsJson: string | undefined): string[] {
  if (!modelsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(modelsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function serializeProvider(
  provider: ControllerProvider,
): StoredProviderResponse {
  return {
    id: provider.id,
    providerId: provider.providerId,
    displayName: provider.displayName,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    hasApiKey: provider.apiKey !== null,
    modelsJson: JSON.stringify(provider.models),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    apiKey: provider.apiKey,
    models: provider.models,
  };
}

export class NexuConfigStore {
  private readonly store: LowDbStore<NexuConfig>;
  private readonly nexuCloudUrl: string;
  private readonly nexuLinkUrl: string | null;
  private pollingState: CloudPollingState | null = null;

  /** Callback fired when cloud state changes (connect/disconnect). */
  onCloudStateChanged?: (change: DesktopCloudStateChange) => Promise<void>;

  constructor(env: ControllerEnv) {
    this.nexuCloudUrl = env.nexuCloudUrl;
    this.nexuLinkUrl = env.nexuLinkUrl;
    this.store = new LowDbStore<NexuConfig>(
      env.nexuConfigPath,
      nexuConfigSchema,
      () => ({
        $schema: "https://nexu.io/config.json",
        schemaVersion: 1,
        app: {},
        bots: [],
        runtime: {
          gateway: {
            port: env.openclawGatewayPort,
            bind: "loopback",
            authMode: env.openclawGatewayToken ? "token" : "none",
          },
          defaultModelId: env.defaultModelId,
        },
        providers: [],
        integrations: [],
        channels: [],
        templates: {},
        desktop: {},
        secrets: {},
      }),
    );
  }

  async getConfig(): Promise<NexuConfig> {
    return this.store.read();
  }

  private resolveDesktopCloudLinkUrl(linkUrl?: string | null): string {
    return this.nexuLinkUrl ?? linkUrl ?? this.nexuCloudUrl;
  }

  async reconcileConfiguredDesktopCloudState(): Promise<void> {
    const config = await this.getConfig();
    const cloud = readDesktopCloud(config);

    if (!cloud.connected) {
      return;
    }

    const linkUrl = this.resolveDesktopCloudLinkUrl(cloud.linkUrl);
    if (cloud.linkUrl === linkUrl) {
      return;
    }

    const endpointChanged = cloud.linkUrl !== linkUrl;

    await this.setDesktopCloudState({
      connected: endpointChanged ? false : cloud.connected,
      polling: false,
      userName: endpointChanged ? null : (cloud.userName ?? null),
      userEmail: endpointChanged ? null : (cloud.userEmail ?? null),
      connectedAt: endpointChanged ? null : (cloud.connectedAt ?? null),
      linkUrl,
      apiKey: endpointChanged ? null : (cloud.apiKey ?? null),
      models: endpointChanged ? [] : (cloud.models ?? []),
    });
  }

  private async setDesktopCloudState(input: {
    connected: boolean;
    polling: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    linkUrl?: string | null;
    apiKey?: string | null;
    models?: CloudModel[];
  }): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      desktop: {
        ...config.desktop,
        cloud: {
          connected: input.connected,
          polling: input.polling,
          userName: input.userName ?? null,
          userEmail: input.userEmail ?? null,
          connectedAt: input.connectedAt ?? null,
          linkUrl: input.linkUrl ?? null,
          apiKey: input.apiKey ?? null,
          models: input.models ?? [],
        },
      },
    }));
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });
  }

  private async pollDesktopCloudAuthorization(
    cloudApiUrl: string,
    deviceId: string,
    deviceSecret: string,
    signal: AbortSignal,
  ): Promise<void> {
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.sleep(3000, signal);
      } catch {
        return;
      }

      if (signal.aborted) {
        return;
      }

      try {
        const res = await fetch(`${cloudApiUrl}/api/auth/device-poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, deviceSecret }),
          signal,
        });

        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as CloudPollResponse;

        if (data.status === "completed" && data.apiKey) {
          const previousCloud = readDesktopCloud(await this.getConfig());
          const linkUrl =
            data.linkGatewayUrl ?? this.nexuLinkUrl ?? this.nexuCloudUrl;
          const models =
            data.cloudModels && data.cloudModels.length > 0
              ? data.cloudModels
              : ((await this.fetchDesktopCloudModels(linkUrl, data.apiKey)) ??
                []);

          this.pollingState = null;
          await this.setDesktopCloudState({
            connected: true,
            polling: false,
            userName: data.userName ?? null,
            userEmail: data.userEmail ?? null,
            connectedAt: now(),
            linkUrl,
            apiKey: data.apiKey,
            models,
          });
          await this.onCloudStateChanged?.({
            hadCloudInventory: (previousCloud.models?.length ?? 0) > 0,
            hasCloudInventory: models.length > 0,
            connected: true,
          });
          return;
        }

        if (data.status === "expired") {
          this.pollingState = null;
          await this.setDesktopCloudState({
            connected: false,
            polling: false,
            userName: null,
            userEmail: null,
            connectedAt: null,
            linkUrl: null,
            apiKey: null,
            models: [],
          });
          return;
        }
      } catch {
        if (signal.aborted) {
          return;
        }
      }
    }

    this.pollingState = null;
    await this.setDesktopCloudState({
      connected: false,
      polling: false,
      userName: null,
      userEmail: null,
      connectedAt: null,
      linkUrl: null,
      apiKey: null,
      models: [],
    });
  }

  async listBots(): Promise<BotResponse[]> {
    const config = await this.getConfig();
    return config.bots;
  }

  async getBot(botId: string): Promise<BotResponse | null> {
    const config = await this.getConfig();
    return config.bots.find((bot) => bot.id === botId) ?? null;
  }

  async getOrCreateDefaultBot(): Promise<BotResponse> {
    const existing = await this.listBots();
    if (existing.length > 0) {
      const firstBot = existing[0];
      if (firstBot) {
        return firstBot;
      }
    }

    const config = await this.getConfig();
    return this.createBot({
      name: "Nexu Assistant",
      slug: "nexu-assistant",
      modelId: config.runtime.defaultModelId,
    });
  }

  async createBot(input: {
    name: string;
    slug: string;
    systemPrompt?: string;
    modelId?: string;
    poolId?: string;
  }): Promise<BotResponse> {
    const createdAt = now();
    const bot: BotResponse = {
      id: crypto.randomUUID(),
      name: input.name,
      slug: input.slug,
      poolId: input.poolId ?? null,
      status: "active",
      modelId: input.modelId ?? (await this.getConfig()).runtime.defaultModelId,
      systemPrompt: input.systemPrompt ?? null,
      createdAt,
      updatedAt: createdAt,
    };

    await this.store.update((config) => ({
      ...config,
      bots: [...config.bots, bot],
    }));

    return bot;
  }

  async updateBot(
    botId: string,
    input: {
      name?: string;
      systemPrompt?: string;
      modelId?: string;
    },
  ): Promise<BotResponse | null> {
    let updatedBot: BotResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      bots: config.bots.map((bot) => {
        if (bot.id !== botId) {
          return bot;
        }

        updatedBot = {
          ...bot,
          name: input.name ?? bot.name,
          systemPrompt: input.systemPrompt ?? bot.systemPrompt,
          modelId: input.modelId ?? bot.modelId,
          updatedAt: now(),
        };
        return updatedBot;
      }),
    }));

    return updatedBot;
  }

  async setBotStatus(
    botId: string,
    status: BotResponse["status"],
  ): Promise<BotResponse | null> {
    let updatedBot: BotResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      bots: config.bots.map((bot) => {
        if (bot.id !== botId) {
          return bot;
        }

        updatedBot = {
          ...bot,
          status,
          updatedAt: now(),
        };
        return updatedBot;
      }),
    }));

    return updatedBot;
  }

  async deleteBot(botId: string): Promise<boolean> {
    let deleted = false;

    await this.store.update((config) => {
      const bots = config.bots.filter((bot) => {
        if (bot.id === botId) {
          deleted = true;
          return false;
        }

        return true;
      });

      return {
        ...config,
        bots,
        channels: config.channels.filter((channel) => channel.botId !== botId),
      };
    });

    return deleted;
  }

  async listChannels(): Promise<ChannelResponse[]> {
    const config = await this.getConfig();
    return config.channels;
  }

  async getSecret(key: string): Promise<string | null> {
    const config = await this.getConfig();
    return config.secrets[key] ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      secrets: {
        ...config.secrets,
        [key]: value,
      },
    }));
  }

  async deleteSecretsByPrefix(prefix: string): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      secrets: Object.fromEntries(
        Object.entries(config.secrets).filter(
          ([key]) => !key.startsWith(prefix),
        ),
      ),
    }));
  }

  async getChannel(channelId: string): Promise<ChannelResponse | null> {
    const config = await this.getConfig();
    return config.channels.find((channel) => channel.id === channelId) ?? null;
  }

  async connectSlack(
    input: ConnectSlackInput & { botUserId?: string | null },
  ): Promise<ChannelResponse> {
    const bot = await this.getOrCreateDefaultBot();
    const connectedAt = now();
    const teamId = input.teamId ?? crypto.randomUUID();
    const appId = input.appId ?? crypto.randomUUID();
    const accountId = `slack-${appId}-${teamId}`;
    const channel: ChannelResponse = {
      id: crypto.randomUUID(),
      botId: bot.id,
      channelType: "slack",
      accountId,
      status: "connected",
      teamName: input.teamName ?? null,
      appId,
      botUserId: input.botUserId ?? null,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    };

    await this.store.update((config) => ({
      ...config,
      channels: [
        ...config.channels.filter(
          (existing) =>
            !(
              existing.channelType === channel.channelType &&
              existing.accountId === channel.accountId
            ),
        ),
        channel,
      ],
      secrets: {
        ...config.secrets,
        [`channel:${channel.id}:botToken`]: input.botToken,
        [`channel:${channel.id}:signingSecret`]: input.signingSecret,
      },
    }));

    return channel;
  }

  async connectDiscord(
    input: ConnectDiscordInput & { botUserId?: string | null },
  ): Promise<ChannelResponse> {
    const bot = await this.getOrCreateDefaultBot();
    const connectedAt = now();
    const channel: ChannelResponse = {
      id: crypto.randomUUID(),
      botId: bot.id,
      channelType: "discord",
      accountId: `discord-${input.appId}`,
      status: "connected",
      teamName: input.guildName ?? null,
      appId: input.appId,
      botUserId: input.botUserId ?? null,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    };

    await this.store.update((config) => ({
      ...config,
      channels: [
        ...config.channels.filter(
          (existing) =>
            !(
              existing.channelType === channel.channelType &&
              existing.accountId === channel.accountId
            ),
        ),
        channel,
      ],
      secrets: {
        ...config.secrets,
        [`channel:${channel.id}:botToken`]: input.botToken,
      },
    }));

    return channel;
  }

  async connectWechat(input: { accountId: string }): Promise<ChannelResponse> {
    const bot = await this.getOrCreateDefaultBot();
    const connectedAt = now();
    const channel: ChannelResponse = {
      id: crypto.randomUUID(),
      botId: bot.id,
      channelType: "wechat",
      accountId: input.accountId,
      status: "connected",
      teamName: null,
      appId: null,
      botUserId: null,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    };

    await this.store.update((config) => ({
      ...config,
      channels: [
        ...config.channels.filter(
          (existing) =>
            !(
              existing.channelType === channel.channelType &&
              existing.accountId === channel.accountId
            ),
        ),
        channel,
      ],
    }));

    return channel;
  }

  async connectFeishu(input: ConnectFeishuInput): Promise<ChannelResponse> {
    const bot = await this.getOrCreateDefaultBot();
    const connectedAt = now();
    const channel: ChannelResponse = {
      id: crypto.randomUUID(),
      botId: bot.id,
      channelType: "feishu",
      accountId: input.appId,
      status: "connected",
      teamName: null,
      appId: input.appId,
      botUserId: null,
      createdAt: connectedAt,
      updatedAt: connectedAt,
    };

    await this.store.update((config) => ({
      ...config,
      channels: [
        ...config.channels.filter(
          (existing) =>
            !(
              existing.channelType === channel.channelType &&
              existing.accountId === channel.accountId
            ),
        ),
        channel,
      ],
      secrets: {
        ...config.secrets,
        [`channel:${channel.id}:appSecret`]: input.appSecret,
        [`channel:${channel.id}:appId`]: input.appId,
        [`channel:${channel.id}:connectionMode`]:
          input.connectionMode ?? "websocket",
        ...(input.verificationToken
          ? {
              [`channel:${channel.id}:verificationToken`]:
                input.verificationToken,
            }
          : {}),
      },
    }));

    return channel;
  }

  async disconnectChannel(channelId: string): Promise<boolean> {
    let disconnectedChannel: ChannelResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      channels: config.channels.flatMap((channel) => {
        if (channel.id === channelId) {
          disconnectedChannel = channel;
          if (channel.channelType === "feishu") {
            return [
              {
                ...channel,
                status: "disconnected",
                updatedAt: new Date().toISOString(),
              },
            ];
          }

          return [];
        }

        return [channel];
      }),
      secrets:
        disconnectedChannel === null ||
        disconnectedChannel.channelType === "feishu"
          ? config.secrets
          : Object.fromEntries(
              Object.entries(config.secrets).filter(
                ([key]) => !key.startsWith(`channel:${channelId}:`),
              ),
            ),
    }));

    return disconnectedChannel !== null;
  }

  async listProviders(): Promise<ProviderResponse[]> {
    const config = await this.getConfig();
    return config.providers.map((provider) => serializeProvider(provider));
  }

  async getProvider(
    providerId: string,
  ): Promise<StoredProviderResponse | null> {
    const config = await this.getConfig();
    const provider =
      config.providers.find((item) => item.providerId === providerId) ?? null;
    return provider ? serializeProvider(provider) : null;
  }

  async upsertProvider(
    providerId: string,
    input: UpsertProviderBody,
  ): Promise<{ provider: StoredProviderResponse; created: boolean }> {
    const currentTime = now();
    let result: ControllerProvider | null = null;
    let created = false;

    await this.store.update((config) => {
      const existing = config.providers.find(
        (item) => item.providerId === providerId,
      );
      const nextProvider: ControllerProvider = existing
        ? {
            ...existing,
            displayName: input.displayName ?? existing.displayName,
            enabled: input.enabled ?? existing.enabled,
            baseUrl:
              input.baseUrl === undefined ? existing.baseUrl : input.baseUrl,
            apiKey: input.apiKey ?? existing.apiKey,
            models:
              input.modelsJson === undefined
                ? existing.models
                : parseModelsJson(input.modelsJson),
            updatedAt: currentTime,
          }
        : {
            id: crypto.randomUUID(),
            providerId,
            displayName: input.displayName ?? providerId,
            enabled: input.enabled ?? true,
            baseUrl: input.baseUrl ?? null,
            apiKey: input.apiKey ?? null,
            models: parseModelsJson(input.modelsJson),
            createdAt: currentTime,
            updatedAt: currentTime,
          };

      created = existing === undefined;
      result = nextProvider;

      return {
        ...config,
        providers: existing
          ? config.providers.map((item) =>
              item.providerId === providerId ? nextProvider : item,
            )
          : [...config.providers, nextProvider],
      };
    });

    if (result === null) {
      throw new Error(`Failed to upsert provider ${providerId}`);
    }

    return {
      provider: serializeProvider(result),
      created,
    };
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    let deleted = false;

    await this.store.update((config) => ({
      ...config,
      providers: config.providers.filter((provider) => {
        if (provider.providerId === providerId) {
          deleted = true;
          return false;
        }

        return true;
      }),
    }));

    return deleted;
  }

  async listIntegrations(): Promise<IntegrationResponse[]> {
    const config = await this.getConfig();
    return config.integrations;
  }

  async getLocalProfile(): Promise<UserProfileResponse> {
    const config = await this.getConfig();
    return readLocalProfile(config);
  }

  async updateLocalProfile(
    input: UpdateUserProfileInput,
  ): Promise<UserProfileResponse> {
    let nextProfile = defaultLocalProfile();

    await this.store.update((config) => {
      const currentProfile = readLocalProfile(config);
      nextProfile = {
        ...currentProfile,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
      };

      return {
        ...config,
        desktop: {
          ...config.desktop,
          localProfile: nextProfile,
        },
      };
    });

    return nextProfile;
  }

  async updateLocalAuthSource(
    input: UpdateAuthSourceInput,
  ): Promise<UserProfileResponse> {
    let nextProfile = defaultLocalProfile();

    await this.store.update((config) => {
      const currentProfile = readLocalProfile(config);
      nextProfile = {
        ...currentProfile,
        authSource: input.source,
      };

      return {
        ...config,
        desktop: {
          ...config.desktop,
          localProfile: nextProfile,
        },
      };
    });

    return nextProfile;
  }

  async getDesktopCloudStatus() {
    const config = await this.getConfig();
    const cloud = readDesktopCloud(config);
    return {
      connected: cloud.connected,
      polling: cloud.polling,
      userName: cloud.userName ?? null,
      userEmail: cloud.userEmail ?? null,
      connectedAt: cloud.connectedAt ?? null,
      models: cloud.models ?? [],
    };
  }

  async getStoredDesktopLocale(): Promise<"en" | "zh-CN" | null> {
    const config = await this.getConfig();
    return readDesktopLocale(config);
  }

  async getDesktopLocale(): Promise<"en" | "zh-CN"> {
    return (await this.getStoredDesktopLocale()) ?? "en";
  }

  async setDesktopLocale(locale: "en" | "zh-CN"): Promise<"en" | "zh-CN"> {
    await this.store.update((config) => ({
      ...config,
      desktop: {
        ...config.desktop,
        locale,
      },
    }));

    return locale;
  }

  async refreshDesktopCloudModels() {
    await this.hydrateDesktopCloudModels(true);
    const config = await this.getConfig();
    const cloud = readDesktopCloud(config);
    return {
      connected: cloud.connected,
      polling: cloud.polling,
      userName: cloud.userName ?? null,
      userEmail: cloud.userEmail ?? null,
      connectedAt: cloud.connectedAt ?? null,
      models: cloud.models ?? [],
    };
  }

  async prepareDesktopCloudModelsForBootstrap(): Promise<void> {
    await this.hydrateDesktopCloudModels();
  }

  async getDesktopCloudInventoryStatus(): Promise<{
    connected: boolean;
    hasCloudInventory: boolean;
  }> {
    const config = await this.getConfig();
    const cloud = readDesktopCloud(config);
    return {
      connected: cloud.connected,
      hasCloudInventory: (cloud.models?.length ?? 0) > 0,
    };
  }

  async setDefaultModel(modelId: string): Promise<void> {
    await this.store.update((config) => ({
      ...config,
      runtime: {
        ...config.runtime,
        defaultModelId: modelId,
      },
      bots: config.bots.map((bot) => ({
        ...bot,
        modelId,
        updatedAt: now(),
      })),
    }));
  }

  private async fetchDesktopCloudModels(
    linkUrl: string,
    apiKey: string,
  ): Promise<CloudModel[] | null> {
    try {
      const res = await fetch(buildLinkModelsUrl(linkUrl), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as {
        data?: Array<{ id: string; owned_by?: string }>;
      };
      if (!Array.isArray(data.data)) {
        return null;
      }

      return data.data.map((model) => ({
        id: model.id,
        name: model.id,
        provider: model.owned_by,
      }));
    } catch {
      return null;
    }
  }

  private async hydrateDesktopCloudModels(forceRefresh = false): Promise<void> {
    const config = await this.getConfig();
    const cloud = readDesktopCloud(config);
    const linkUrl = this.resolveDesktopCloudLinkUrl(cloud.linkUrl);

    if (cloud.connected && cloud.linkUrl !== linkUrl) {
      await this.setDesktopCloudState({
        connected: cloud.connected,
        polling: cloud.polling,
        userName: cloud.userName ?? null,
        userEmail: cloud.userEmail ?? null,
        connectedAt: cloud.connectedAt ?? null,
        linkUrl,
        apiKey: cloud.apiKey ?? null,
        models: cloud.models ?? [],
      });
    }

    if (
      !cloud.connected ||
      !cloud.apiKey ||
      (!forceRefresh && (cloud.models?.length ?? 0) > 0)
    ) {
      return;
    }

    const models = await this.fetchDesktopCloudModels(linkUrl, cloud.apiKey);
    if (models === null) {
      return;
    }

    await this.setDesktopCloudState({
      connected: cloud.connected,
      polling: cloud.polling,
      userName: cloud.userName ?? null,
      userEmail: cloud.userEmail ?? null,
      connectedAt: cloud.connectedAt ?? null,
      linkUrl,
      apiKey: cloud.apiKey,
      models,
    });
  }

  async connectDesktopCloud() {
    const current = readDesktopCloud(await this.getConfig());
    if (this.pollingState || current.polling) {
      return { error: "Connection attempt already in progress" };
    }
    if (current.connected && current.apiKey) {
      return { error: "Already connected. Disconnect first." };
    }

    const deviceId = crypto.randomUUID();
    const deviceSecret = crypto.randomUUID();
    const deviceSecretHash = crypto
      .createHash("sha256")
      .update(deviceSecret)
      .digest("hex");

    let res: Response;
    const registerUrl = `${this.nexuCloudUrl}/api/auth/device-register`;
    try {
      res = await fetch(registerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, deviceSecretHash }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logger.warn(
        {
          url: registerUrl,
          error: describeFetchError(error),
        },
        "desktop_cloud_connect_register_failed",
      );
      return {
        error: `Cloud unreachable: ${describeFetchError(error)}`,
      };
    }

    if (!res.ok) {
      return { error: `Failed to register device: ${await res.text()}` };
    }

    await this.setDesktopCloudState({
      connected: false,
      polling: true,
      userName: null,
      userEmail: null,
      connectedAt: null,
      linkUrl: null,
      apiKey: null,
      models: [],
    });

    const abortController = new AbortController();
    this.pollingState = { deviceId, deviceSecret, abortController };
    void this.pollDesktopCloudAuthorization(
      this.nexuCloudUrl,
      deviceId,
      deviceSecret,
      abortController.signal,
    );

    return {
      browserUrl: `${this.nexuCloudUrl}/auth?desktop=1&device_id=${encodeURIComponent(deviceId)}`,
      error: undefined,
    };
  }

  async disconnectDesktopCloud() {
    const previousCloud = readDesktopCloud(await this.getConfig());
    if (this.pollingState) {
      this.pollingState.abortController.abort();
      this.pollingState = null;
    }

    await this.setDesktopCloudState({
      connected: false,
      polling: false,
      userName: null,
      userEmail: null,
      connectedAt: null,
      linkUrl: null,
      apiKey: null,
      models: [],
    });
    await this.onCloudStateChanged?.({
      hadCloudInventory: (previousCloud.models?.length ?? 0) > 0,
      hasCloudInventory: false,
      connected: false,
    });

    return { ok: true };
  }

  async setDesktopCloudModels(enabledModelIds: string[]) {
    await this.store.update((config) => {
      const cloud = readDesktopCloud(config);
      return {
        ...config,
        desktop: {
          ...config.desktop,
          cloud: {
            ...cloud,
            models: (cloud.models ?? []).filter((model) =>
              enabledModelIds.includes(model.id),
            ),
          },
        },
      };
    });

    const next = await this.getDesktopCloudStatus();
    return {
      ok: true,
      models: next.models,
    };
  }

  async connectIntegration(
    input: ConnectIntegrationInput,
  ): Promise<ConnectIntegrationResponse> {
    const timestamp = now();
    const integrationId = crypto.randomUUID();
    const integration: IntegrationResponse = {
      id: integrationId,
      toolkit: {
        slug: input.toolkitSlug,
        displayName: input.toolkitSlug,
        description: "Controller-managed integration",
        iconUrl: `/toolkit-icons/${input.toolkitSlug}.svg`,
        fallbackIconUrl: "https://www.google.com/s2/favicons?sz=64",
        category: "tooling",
        authScheme: input.credentials ? "api_key_user" : "oauth2",
        authFields: input.credentials
          ? Object.keys(input.credentials).map((key) => ({
              key,
              label: key,
              type: "secret" as const,
            }))
          : undefined,
      },
      status: input.credentials ? "active" : "initiated",
      connectUrl:
        input.credentials === undefined
          ? `${input.returnTo ?? "/"}?integration=${input.toolkitSlug}`
          : undefined,
      connectedAt: input.credentials ? timestamp : undefined,
      credentialHints: input.credentials
        ? Object.fromEntries(
            Object.keys(input.credentials).map((key) => [key, "***"]),
          )
        : undefined,
      returnTo: input.returnTo,
      source: input.source,
    };

    await this.store.update((config) => ({
      ...config,
      integrations: [
        ...config.integrations.filter(
          (item) => item.toolkit.slug !== input.toolkitSlug,
        ),
        integration,
      ],
      secrets: {
        ...config.secrets,
        ...Object.fromEntries(
          Object.entries(input.credentials ?? {})
            .filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            )
            .map(([key, value]) => [
              `integration:${integrationId}:${key}`,
              value,
            ]),
        ),
      },
    }));

    return {
      integration,
      connectUrl: integration.connectUrl,
      state: integration.id,
    };
  }

  async refreshIntegration(
    integrationId: string,
    _input: RefreshIntegrationInput,
  ): Promise<IntegrationResponse | null> {
    let updated: IntegrationResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      integrations: config.integrations.map((integration) => {
        if (integration.id !== integrationId) {
          return integration;
        }

        updated = {
          ...integration,
          status: "active",
          connectedAt: integration.connectedAt ?? now(),
        };

        return updated;
      }),
    }));

    return updated;
  }

  async deleteIntegration(
    integrationId: string,
  ): Promise<IntegrationResponse | null> {
    let removed: IntegrationResponse | null = null;

    await this.store.update((config) => ({
      ...config,
      integrations: config.integrations.filter((integration) => {
        if (integration.id === integrationId) {
          removed = {
            ...integration,
            status: "disconnected",
          };
          return false;
        }

        return true;
      }),
      secrets: Object.fromEntries(
        Object.entries(config.secrets).filter(
          ([key]) => !key.startsWith(`integration:${integrationId}:`),
        ),
      ),
    }));

    return removed;
  }

  async getRuntimeConfig(): Promise<ControllerRuntimeConfig> {
    const config = await this.getConfig();
    return config.runtime;
  }

  async setRuntimeConfig(
    runtime: ControllerRuntimeConfig,
  ): Promise<ControllerRuntimeConfig> {
    await this.store.update((config) => ({
      ...config,
      runtime,
    }));

    return runtime;
  }

  async syncManagedRuntimeGateway(input: {
    port: number;
    authMode: ControllerRuntimeConfig["gateway"]["authMode"];
  }): Promise<void> {
    await this.store.update((config) => {
      if (
        config.runtime.gateway.port === input.port &&
        config.runtime.gateway.authMode === input.authMode
      ) {
        return config;
      }

      return {
        ...config,
        runtime: {
          ...config.runtime,
          gateway: {
            ...config.runtime.gateway,
            port: input.port,
            authMode: input.authMode,
          },
        },
      };
    });
  }

  async listTemplates() {
    const config = await this.getConfig();
    return Object.values(config.templates);
  }

  async upsertTemplate(input: {
    name: string;
    content: string;
    writeMode?: "seed" | "inject";
    status?: "active" | "inactive";
  }) {
    const existing = (await this.getConfig()).templates[input.name];
    const timestamp = now();
    const template = {
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name,
      content: input.content,
      writeMode: input.writeMode ?? existing?.writeMode ?? "seed",
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    await this.store.update((config) => ({
      ...config,
      templates: {
        ...config.templates,
        [input.name]: template,
      },
    }));

    return template;
  }

  async getRuntimeTemplatesSnapshot(): Promise<{
    version: number;
    templatesHash: string;
    templates: Record<
      string,
      { content: string; writeMode: "seed" | "inject" }
    >;
    createdAt: string;
  }> {
    const templates = (await this.listTemplates()).filter(
      (template) => template.status === "active",
    );
    const payload = Object.fromEntries(
      templates.map((template) => [
        template.name,
        {
          content: template.content,
          writeMode: template.writeMode,
        },
      ]),
    );
    const createdAt = now();
    return {
      version: templates.length,
      templatesHash: crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      templates: payload,
      createdAt,
    };
  }
}
