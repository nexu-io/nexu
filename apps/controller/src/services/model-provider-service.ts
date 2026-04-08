import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  type Model,
  type ModelProviderConfig,
  type PersistedModelsConfig,
  type ProviderRegistryEntryDto,
  getBundledProviderModelIds,
  getDefaultProviderBaseUrls,
  getProviderRuntimePolicy,
  isCustomProviderTemplate,
  isSupportedByokProviderId,
  listProviderRegistryEntries,
  parseCustomProviderKey,
  selectPreferredModel,
  type verifyProviderBodySchema,
  type verifyProviderResponseSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
import type { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawAuthService } from "./openclaw-auth-service.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export interface ModelAutoSelectResult {
  changed: boolean;
  previousModelId: string;
  newModelId: string | null;
  newModelName: string | null;
}

export interface ModelInventoryStatus {
  hasKnownInventory: boolean;
}

export interface MiniMaxOauthStatus {
  connected: boolean;
  inProgress: boolean;
  region: MiniMaxRegion | null;
  error: string | null;
}

type DefaultModelValidity = "valid" | "invalid" | "unknown";
type VerifyProviderBody = z.infer<typeof verifyProviderBodySchema>;
type VerifyProviderResponse = z.infer<typeof verifyProviderResponseSchema>;
type MiniMaxRegion = "global" | "cn";

type MiniMaxOAuthAuthorization = {
  user_code: string;
  verification_uri: string;
  expired_in: number;
  interval?: number;
  state: string;
};

type MiniMaxOAuthToken = {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
};

type MiniMaxOauthStartResult = MiniMaxOauthStatus & {
  browserUrl: string;
};

const MINI_MAX_API_BASE_URL_GLOBAL = "https://api.minimax.io/anthropic";
const MINI_MAX_API_BASE_URL_CN = "https://api.minimaxi.com/anthropic";
const MINI_MAX_OAUTH_PROVIDER_ID = "minimax-portal";
const MINI_MAX_PLUGIN_ID = "minimax-portal-auth";
const MINI_MAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINI_MAX_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code";
const MINI_MAX_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const MINI_MAX_API_MODELS = [
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
];
const MINI_MAX_OAUTH_MODELS = [
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
];
const MINI_MAX_DEFAULT_POLL_INTERVAL_MS = 2000;
const MINI_MAX_MAX_POLL_INTERVAL_MS = 10000;
const MINI_MAX_OAUTH_REQUEST_TIMEOUT_MS = 15000;
const MINI_MAX_OAUTH_TOKEN_REQUEST_TIMEOUT_MS = 15000;
const OPENCLAW_COMMAND_TIMEOUT_MS = 30000;
const NEXU_OFFICIAL_PROVIDER_ID = "nexu";
const OLLAMA_DUMMY_API_KEY = "ollama-local";

function durationSecondsToMs(valueInSeconds: number): number {
  return valueInSeconds * 1000;
}

function normalizeMiniMaxPollIntervalMs(interval: number | undefined): number {
  if (
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    return MINI_MAX_DEFAULT_POLL_INTERVAL_MS;
  }

  return interval >= 100 ? interval : durationSecondsToMs(interval);
}

function hasSameModels(current: string[], expected: string[]): boolean {
  return (
    current.length === expected.length &&
    current.every((model, index) => model === expected[index])
  );
}

function hasSameCloudModels(
  current: ReadonlyArray<{
    id: string;
    name?: string | null;
    provider?: string | null;
  }>,
  next: ReadonlyArray<{
    id: string;
    name?: string | null;
    provider?: string | null;
  }>,
): boolean {
  const toStableKey = (model: {
    id: string;
    name?: string | null;
    provider?: string | null;
  }): string =>
    `${model.id}\u0000${model.name ?? ""}\u0000${model.provider ?? ""}`;

  const currentKeys = current.map(toStableKey).sort();
  const nextKeys = next.map(toStableKey).sort();

  return (
    currentKeys.length === nextKeys.length &&
    currentKeys.every((key, index) => key === nextKeys[index])
  );
}

type ProviderInventoryInput = {
  providerKey: string;
  providerId: string;
  enabled: boolean;
  apiKey: string | null;
  models: string[];
  baseUrl: string | null;
  oauthRegion: "global" | "cn" | null;
  auth: ModelProviderConfig["auth"] | undefined;
  oauthProfileRef: string | null;
};

function resolveInventoryModelIds(
  providerId: string,
  models: string[],
): string[] {
  return models.length > 0 ? models : getBundledProviderModelIds(providerId);
}

function toProviderInventoryInput(
  providers: PersistedModelsConfig["providers"],
): ProviderInventoryInput[] {
  return Object.entries(providers)
    .map(([providerKey, provider]) => {
      const customProvider = parseCustomProviderKey(providerKey);
      const providerId = customProvider?.templateId ?? providerKey;
      return {
        providerKey,
        providerId,
        enabled: provider.enabled,
        apiKey: typeof provider.apiKey === "string" ? provider.apiKey : null,
        models: resolveInventoryModelIds(
          providerId,
          provider.models.map((model) => model.id),
        ),
        baseUrl: provider.baseUrl ?? null,
        oauthRegion: provider.oauthRegion ?? null,
        auth: provider.auth,
        oauthProfileRef: provider.oauthProfileRef ?? null,
      };
    })
    .filter(
      (provider) =>
        isSupportedByokProviderId(provider.providerId) ||
        isCustomProviderTemplate(provider.providerId),
    );
}

function buildProviderUrl(
  baseUrl: string | null | undefined,
  pathSuffix: string,
): string | null {
  if (!baseUrl || baseUrl.trim().length === 0) {
    return null;
  }

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = pathSuffix.startsWith("/")
    ? pathSuffix
    : `/${pathSuffix}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function normalizeGoogleModelId(name: string | undefined): string {
  if (typeof name !== "string") {
    return "";
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return "";
  }

  return trimmedName.startsWith("models/")
    ? trimmedName.slice("models/".length)
    : trimmedName;
}

function getMiniMaxBaseUrl(region: MiniMaxRegion): string {
  return region === "cn"
    ? MINI_MAX_API_BASE_URL_CN
    : MINI_MAX_API_BASE_URL_GLOBAL;
}

function getMiniMaxOauthHost(region: MiniMaxRegion): string {
  return region === "cn"
    ? "https://api.minimaxi.com"
    : "https://api.minimax.io";
}

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

function generatePkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  for (let index = 0; index < 10; index += 1) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

function resolveOpenclawEntryFromBin(binPath: string): string | null {
  const resolvedBinPath = path.resolve(binPath.trim());
  if (resolvedBinPath.endsWith(".mjs") && existsSync(resolvedBinPath)) {
    return resolvedBinPath;
  }

  const entry = path.resolve(
    path.dirname(resolvedBinPath),
    "..",
    "node_modules/openclaw/openclaw.mjs",
  );
  return existsSync(entry) ? entry : null;
}

function getOpenClawCommandSpec(env: ControllerEnv): {
  command: string;
  argsPrefix: string[];
  extraEnv: Record<string, string>;
} {
  const workspaceRoot =
    process.env.NEXU_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(process.cwd());
  const runtimeEntryPath = workspaceRoot
    ? path.join(
        workspaceRoot,
        "openclaw-runtime",
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      )
    : null;
  const electronExec = process.env.OPENCLAW_ELECTRON_EXECUTABLE;
  if (electronExec) {
    const openclawEntryFromBin = resolveOpenclawEntryFromBin(env.openclawBin);
    if (openclawEntryFromBin) {
      return {
        command: electronExec,
        argsPrefix: [openclawEntryFromBin],
        extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
      };
    }

    if (runtimeEntryPath && existsSync(runtimeEntryPath)) {
      return {
        command: electronExec,
        argsPrefix: [runtimeEntryPath],
        extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
      };
    }

    const entry = resolveOpenclawEntryFromBin(env.openclawBin);
    if (!entry) {
      throw new Error(
        "Unable to resolve OpenClaw entry point from OPENCLAW_BIN",
      );
    }
    return {
      command: electronExec,
      argsPrefix: [entry],
      extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  if (path.isAbsolute(env.openclawBin) || env.openclawBin.includes(path.sep)) {
    return {
      command: env.openclawBin,
      argsPrefix: [],
      extraEnv: {},
    };
  }

  if (workspaceRoot) {
    if (runtimeEntryPath && existsSync(runtimeEntryPath)) {
      return {
        command: process.execPath,
        argsPrefix: [runtimeEntryPath],
        extraEnv: {},
      };
    }

    const wrapperPath = path.join(workspaceRoot, "openclaw-wrapper");
    if (existsSync(wrapperPath)) {
      return {
        command: wrapperPath,
        argsPrefix: [],
        extraEnv: {},
      };
    }
  }

  return {
    command: env.openclawBin,
    argsPrefix: [],
    extraEnv: {},
  };
}

// Providers that support OAuth login (no API key needed).
const OAUTH_PROVIDER_IDS = new Set(["openai"]);

export class ModelProviderService {
  private openclawAuthService: OpenClawAuthService | null = null;

  private miniMaxOauthAbortController: AbortController | null = null;

  private miniMaxOauthBrowserUrl: string | null = null;

  private miniMaxOauthState: MiniMaxOauthStatus = {
    connected: false,
    inProgress: false,
    region: null,
    error: null,
  };

  private isCurrentMiniMaxOauthAttempt(
    abortController: AbortController,
  ): boolean {
    return this.miniMaxOauthAbortController === abortController;
  }

  private createAbortSignalWithTimeout(
    signal: AbortSignal,
    timeoutMs: number,
  ): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }

  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly env: ControllerEnv,
    private readonly openclawSyncService: OpenClawSyncService,
    private readonly openclawProcess: OpenClawProcessManager,
  ) {}

  /**
   * Inject the auth service after construction to avoid circular deps.
   */
  setAuthService(authService: OpenClawAuthService): void {
    this.openclawAuthService = authService;
  }

  async listModels() {
    await this.refreshMiniMaxOauthModelsIfNeeded();

    const desktopCloud = await this.configStore.getDesktopCloudStatus();
    const providers = toProviderInventoryInput(
      (await this.configStore.getModelProviderConfigDocument()).providers,
    ).filter((provider) => provider.enabled);
    const { cloudModels, byokModels } = await this.getAvailableModels(
      providers,
      desktopCloud,
    );

    return {
      models: [...cloudModels, ...byokModels],
    };
  }

  private async getAvailableModels(
    providers: ReadonlyArray<{
      providerKey: string;
      providerId: string;
      apiKey: string | null;
      models: string[];
      auth: ModelProviderConfig["auth"] | undefined;
    }>,
    desktopCloud: {
      models?: Array<{ id: string; name?: string | null }> | null;
    },
  ): Promise<{ cloudModels: Model[]; byokModels: Model[] }> {
    const cloudModels: Model[] = (desktopCloud.models ?? []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      provider: "nexu",
      description: "Cloud model via Nexu Link",
    }));

    // Exclude OAuth-only providers whose token has expired
    const expiredOAuthProviderIds =
      await this.getExpiredOAuthProviderIds(providers);

    const byokModels: Model[] = providers
      .filter((provider) => !expiredOAuthProviderIds.has(provider.providerId))
      .flatMap((provider) =>
        provider.models.map((modelId) => ({
          id: `${provider.providerKey}/${modelId}`,
          name: modelId,
          provider: provider.providerKey,
        })),
      );

    return { cloudModels, byokModels };
  }

  /**
   * Returns provider IDs that use OAuth (no API key) and whose token is expired.
   */
  private async getExpiredOAuthProviderIds(
    providers: ReadonlyArray<{
      providerId: string;
      apiKey: string | null;
      auth: ModelProviderConfig["auth"] | undefined;
    }>,
  ): Promise<Set<string>> {
    if (!this.openclawAuthService) return new Set();

    const expired = new Set<string>();
    for (const provider of providers) {
      if (
        provider.apiKey ||
        provider.auth !== "oauth" ||
        !OAUTH_PROVIDER_IDS.has(provider.providerId)
      ) {
        continue;
      }
      const status = await this.openclawAuthService.getProviderOAuthStatus(
        provider.providerId,
      );
      if (!status.connected) {
        expired.add(provider.providerId);
      }
    }
    return expired;
  }

  async listProviders() {
    await this.refreshMiniMaxOauthModelsIfNeeded();

    const providers = toProviderInventoryInput(
      (await this.configStore.getModelProviderConfigDocument()).providers,
    );
    return {
      providers,
    };
  }

  listProviderRegistry(): ProviderRegistryEntryDto[] {
    return listProviderRegistryEntries().map((entry) => ({
      ...entry,
      aliases: [...entry.aliases],
      authModes: [...entry.authModes],
      defaultBaseUrls: [...entry.defaultBaseUrls],
      ...(entry.defaultHeaders
        ? { defaultHeaders: { ...entry.defaultHeaders } }
        : {}),
    }));
  }

  async getModelProviderConfigDocument(): Promise<PersistedModelsConfig> {
    return this.configStore.getModelProviderConfigDocument();
  }

  async setModelProviderConfigDocument(
    config: PersistedModelsConfig,
  ): Promise<PersistedModelsConfig> {
    const next = await this.configStore.setModelProviderConfigDocument(config);
    await this.ensureValidDefaultModel();
    await this.openclawSyncService.syncAll();
    return next;
  }

  async refreshNexuOfficialModels(): Promise<{
    connected: boolean;
    refreshed: boolean;
    changed: boolean;
    modelCount: number;
  }> {
    const before = await this.configStore.getDesktopCloudStatus();
    if (!before.connected) {
      return {
        connected: false,
        refreshed: false,
        changed: false,
        modelCount: before.models.length,
      };
    }

    const next = await this.configStore.refreshDesktopCloudModels();
    const changed = !hasSameCloudModels(before.models, next.models);

    if (changed) {
      await this.ensureValidDefaultModel();
      await this.openclawSyncService.syncAll();
      logger.info(
        {
          provider: NEXU_OFFICIAL_PROVIDER_ID,
          previousModelCount: before.models.length,
          modelCount: next.models.length,
        },
        "nexu_official_models_refreshed",
      );
    }

    return {
      connected: true,
      refreshed: true,
      changed,
      modelCount: next.models.length,
    };
  }

  async upsertProvider(
    providerId: string,
    input: Parameters<NexuConfigStore["upsertProvider"]>[1],
  ) {
    if (providerId === "ollama") {
      const normalizedApiKey = input.apiKey?.trim();
      return this.configStore.upsertProvider(providerId, {
        ...input,
        authMode: "apiKey",
        apiKey:
          normalizedApiKey && normalizedApiKey.length > 0
            ? normalizedApiKey
            : OLLAMA_DUMMY_API_KEY,
      });
    }

    return this.configStore.upsertProvider(providerId, input);
  }

  async deleteProvider(providerId: string) {
    return this.configStore.deleteProvider(providerId);
  }

  async getInventoryStatus(): Promise<ModelInventoryStatus> {
    const desktopCloud =
      await this.configStore.getDesktopCloudInventoryStatus();
    const hasByokInventory = toProviderInventoryInput(
      (await this.configStore.getModelProviderConfigDocument()).providers,
    ).some((provider) => provider.enabled && provider.models.length > 0);

    return {
      hasKnownInventory: desktopCloud.hasCloudInventory || hasByokInventory,
    };
  }

  async ensureValidDefaultModel(): Promise<ModelAutoSelectResult> {
    const validity = await this.getDefaultModelValidity();
    const config = await this.configStore.getConfig();
    const currentId = config.runtime.defaultModelId;

    if (validity !== "invalid") {
      return {
        changed: false,
        previousModelId: currentId,
        newModelId: null,
        newModelName: null,
      };
    }

    const { models } = await this.listModels();
    if (models.length === 0) {
      return {
        changed: false,
        previousModelId: currentId,
        newModelId: null,
        newModelName: null,
      };
    }

    const selected = selectPreferredModel(models) ?? models[0];
    if (!selected) {
      return {
        changed: false,
        previousModelId: currentId,
        newModelId: null,
        newModelName: null,
      };
    }

    await this.configStore.setDefaultModel(selected.id);
    logger.info(
      { previous: currentId, selected: selected.id },
      "default_model_auto_switched",
    );

    return {
      changed: true,
      previousModelId: currentId,
      newModelId: selected.id,
      newModelName: selected.name,
    };
  }

  async verifyProvider(
    providerId: string,
    input: VerifyProviderBody,
  ): Promise<VerifyProviderResponse> {
    return this.verifyProviderKey(providerId, input);
  }

  async verifyProviderInstance(
    instanceKey: string,
    input: VerifyProviderBody,
  ): Promise<VerifyProviderResponse> {
    return this.verifyProviderKey(instanceKey, input);
  }

  private async verifyProviderKey(
    providerKey: string,
    input: VerifyProviderBody,
  ): Promise<VerifyProviderResponse> {
    const customProvider = parseCustomProviderKey(providerKey);
    const providerId = customProvider?.templateId ?? providerKey;
    if (
      !isSupportedByokProviderId(providerId) &&
      !isCustomProviderTemplate(providerId)
    ) {
      return { valid: false, error: "Unsupported provider" };
    }

    const storedProvider = await this.configStore.getProvider(providerKey);
    const runtimePolicy = getProviderRuntimePolicy(providerId);
    if (!runtimePolicy) {
      return { valid: false, error: "Unsupported provider" };
    }

    const apiKey =
      input.apiKey !== undefined
        ? input.apiKey.trim()
        : storedProvider?.apiKey || "";
    const defaultBaseUrl =
      providerId === "minimax" && storedProvider?.oauthRegion === "cn"
        ? MINI_MAX_API_BASE_URL_CN
        : (getDefaultProviderBaseUrls(providerId)[0] ?? null);
    const resolvedBaseUrl =
      input.baseUrl ?? storedProvider?.baseUrl ?? defaultBaseUrl;

    const verifyUrl = buildProviderUrl(resolvedBaseUrl, "/models") ?? "";
    if (verifyUrl.length === 0) {
      return { valid: false, error: "Unknown provider and no baseUrl given" };
    }

    try {
      if (providerId === "ollama") {
        const headers: Record<string, string> = {};
        if (apiKey && apiKey !== OLLAMA_DUMMY_API_KEY) {
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const response = await proxyFetch(
          buildProviderUrl(resolvedBaseUrl, "/api/tags") ?? verifyUrl,
          {
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            timeoutMs: 10000,
          },
        );
        if (!response.ok) {
          return { valid: false, error: `HTTP ${response.status}` };
        }

        const payload = (await response.json()) as {
          models?: Array<{ name?: string }>;
        };
        return {
          valid: true,
          models: Array.isArray(payload.models)
            ? payload.models
                .map((item) => item.name?.trim() ?? "")
                .filter((item) => item.length > 0)
            : [],
        };
      }

      if (!apiKey) {
        return { valid: false, error: "API key required" };
      }

      if (runtimePolicy.apiKind === "google-generative-ai") {
        const response = await proxyFetch(verifyUrl, {
          headers: {
            "x-goog-api-key": apiKey,
          },
          timeoutMs: 10000,
        });

        if (!response.ok) {
          return { valid: false, error: `HTTP ${response.status}` };
        }

        const payload = (await response.json()) as {
          models?: Array<{ name?: string }>;
        };

        return {
          valid: true,
          models: Array.isArray(payload.models)
            ? payload.models
                .map((item) => normalizeGoogleModelId(item.name))
                .filter((item) => item.length > 0)
            : [],
        };
      }

      const headers: Record<string, string> =
        runtimePolicy.apiKind === "anthropic-messages"
          ? {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            }
          : { Authorization: `Bearer ${apiKey}` };

      const response = await proxyFetch(verifyUrl, {
        headers,
        timeoutMs: 10000,
      });
      if (!response.ok) {
        if (providerId === "minimax" && response.status === 404) {
          return { valid: true, models: MINI_MAX_API_MODELS };
        }
        if (providerId === "xiaomi" && response.status === 404) {
          return {
            valid: true,
            models: getBundledProviderModelIds(providerId),
          };
        }
        return { valid: false, error: `HTTP ${response.status}` };
      }

      const payload = (await response.json()) as {
        data?: Array<{ id: string }>;
      };
      if (providerId === "xiaomi") {
        return {
          valid: true,
          models:
            Array.isArray(payload.data) && payload.data.length > 0
              ? payload.data.map((item) => item.id)
              : getBundledProviderModelIds(providerId),
        };
      }

      return {
        valid: true,
        models: Array.isArray(payload.data)
          ? payload.data.map((item) => item.id)
          : providerId === "minimax"
            ? MINI_MAX_API_MODELS
            : [],
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Request failed",
      };
    }
  }

  async getMiniMaxOauthStatus(): Promise<MiniMaxOauthStatus> {
    await this.refreshMiniMaxOauthModelsIfNeeded();

    const modelProviderConfig =
      await this.configStore.getModelProviderConfigDocument();
    const canonicalProvider = modelProviderConfig.providers.minimax;
    const connected =
      canonicalProvider?.auth === "oauth" &&
      (typeof canonicalProvider.oauthProfileRef === "string" ||
        typeof canonicalProvider.metadata === "object");
    const inProgress = connected ? false : this.miniMaxOauthState.inProgress;

    this.miniMaxOauthState = {
      connected,
      inProgress,
      region: canonicalProvider?.oauthRegion ?? this.miniMaxOauthState.region,
      error: this.miniMaxOauthState.error,
    };

    return this.miniMaxOauthState;
  }

  async startMiniMaxOauth(
    region: MiniMaxRegion,
  ): Promise<MiniMaxOauthStartResult> {
    if (this.miniMaxOauthState.inProgress) {
      if (this.miniMaxOauthBrowserUrl) {
        const status = await this.getMiniMaxOauthStatus();
        return {
          ...status,
          browserUrl: this.miniMaxOauthBrowserUrl,
        };
      }

      this.miniMaxOauthAbortController?.abort();
      this.miniMaxOauthAbortController = null;
      this.miniMaxOauthState = {
        connected: false,
        inProgress: false,
        region,
        error: null,
      };
    }

    await this.enableMiniMaxOauthPlugin();

    const abortController = new AbortController();
    this.miniMaxOauthAbortController = abortController;
    this.miniMaxOauthState = {
      connected: false,
      inProgress: true,
      region,
      error: null,
    };

    try {
      const auth = await this.requestMiniMaxOAuthCode(
        region,
        abortController.signal,
      );
      if (!this.isCurrentMiniMaxOauthAttempt(abortController)) {
        return {
          connected: false,
          inProgress: false,
          region,
          error: null,
          browserUrl: auth.verification_uri,
        };
      }

      this.miniMaxOauthBrowserUrl = auth.verification_uri;
      void this.finishMiniMaxOauthLogin(auth, region, abortController);
      return {
        ...this.miniMaxOauthState,
        browserUrl: auth.verification_uri,
      };
    } catch (error) {
      if (this.isCurrentMiniMaxOauthAttempt(abortController)) {
        this.miniMaxOauthAbortController = null;
        this.miniMaxOauthState = {
          connected: false,
          inProgress: false,
          region,
          error:
            error instanceof Error
              ? error.message
              : "MiniMax OAuth init failed",
        };
      }
      throw error;
    }
  }

  async cancelMiniMaxOauth(): Promise<MiniMaxOauthStatus> {
    this.miniMaxOauthAbortController?.abort();
    this.miniMaxOauthAbortController = null;
    this.miniMaxOauthBrowserUrl = null;
    this.miniMaxOauthState = {
      ...this.miniMaxOauthState,
      inProgress: false,
      error: null,
    };

    return this.getMiniMaxOauthStatus();
  }

  private async getDefaultModelValidity(): Promise<DefaultModelValidity> {
    await this.refreshMiniMaxOauthModelsIfNeeded();

    const config = await this.configStore.getConfig();
    const currentId = config.runtime.defaultModelId;
    const desktopCloud = await this.configStore.getDesktopCloudStatus();
    const inventory = await this.getInventoryStatus();
    const providers = toProviderInventoryInput(
      (await this.configStore.getModelProviderConfigDocument()).providers,
    ).filter((provider) => provider.enabled);

    if (!inventory.hasKnownInventory) {
      return "unknown";
    }

    const { cloudModels, byokModels } = await this.getAvailableModels(
      providers,
      desktopCloud,
    );
    const knownModels = [...cloudModels, ...byokModels];

    return knownModels.some((model) => model.id === currentId)
      ? "valid"
      : "invalid";
  }

  private async enableMiniMaxOauthPlugin(): Promise<void> {
    await this.execOpenClawCommand(["plugins", "enable", MINI_MAX_PLUGIN_ID]);
  }

  private async refreshMiniMaxOauthModelsIfNeeded(): Promise<void> {
    const provider = (await this.configStore.getModelProviderConfigDocument())
      .providers.minimax;
    if (
      provider?.auth !== "oauth" ||
      typeof provider.oauthProfileRef !== "string"
    ) {
      return;
    }

    const currentModels = provider.models.map((model) => model.id);

    if (hasSameModels(currentModels, MINI_MAX_OAUTH_MODELS)) {
      return;
    }

    await this.configStore.upsertProvider("minimax", {
      modelsJson: JSON.stringify(MINI_MAX_OAUTH_MODELS),
    });
  }

  private async finishMiniMaxOauthLogin(
    auth: MiniMaxOAuthAuthorization & { verifier: string },
    region: MiniMaxRegion,
    abortController: AbortController,
  ): Promise<void> {
    const { signal } = abortController;

    try {
      const expiresAt = Date.now() + durationSecondsToMs(auth.expired_in);
      const intervalMs = normalizeMiniMaxPollIntervalMs(auth.interval);
      const token = await this.pollMiniMaxOAuthToken(
        {
          region,
          userCode: auth.user_code,
          verifier: auth.verifier,
          expiresAt,
          intervalMs,
        },
        signal,
      );

      await this.configStore.setProviderOauthCredentials("minimax", {
        displayName: "MiniMax",
        enabled: true,
        baseUrl: token.resourceUrl ?? getMiniMaxBaseUrl(region),
        models: MINI_MAX_OAUTH_MODELS,
        oauthRegion: region,
        oauthCredential: {
          provider: MINI_MAX_OAUTH_PROVIDER_ID,
          access: token.access,
          refresh: token.refresh,
          expires: token.expires,
        },
      });
      await this.ensureValidDefaultModel();
      await this.openclawSyncService.syncAll();
      await this.restartRuntime();

      if (this.isCurrentMiniMaxOauthAttempt(abortController)) {
        this.miniMaxOauthState = {
          connected: true,
          inProgress: false,
          region,
          error: null,
        };
        this.miniMaxOauthBrowserUrl = null;
      }
    } catch (error) {
      if (signal.aborted) {
        if (this.isCurrentMiniMaxOauthAttempt(abortController)) {
          this.miniMaxOauthState = {
            connected: false,
            inProgress: false,
            region,
            error: null,
          };
          this.miniMaxOauthBrowserUrl = null;
        }
        return;
      }

      if (this.isCurrentMiniMaxOauthAttempt(abortController)) {
        this.miniMaxOauthState = {
          connected: false,
          inProgress: false,
          region,
          error:
            error instanceof Error ? error.message : "MiniMax OAuth failed",
        };
        this.miniMaxOauthBrowserUrl = null;
      }
      logger.warn(
        {
          error:
            error instanceof Error ? error.message : "MiniMax OAuth failed",
          region,
        },
        "minimax_oauth_login_failed",
      );
    } finally {
      if (this.isCurrentMiniMaxOauthAttempt(abortController)) {
        this.miniMaxOauthAbortController = null;
      }
    }
  }

  private async requestMiniMaxOAuthCode(
    region: MiniMaxRegion,
    signal: AbortSignal,
  ): Promise<MiniMaxOAuthAuthorization & { verifier: string }> {
    const { verifier, challenge, state } = generatePkce();
    const requestSignal = this.createAbortSignalWithTimeout(
      signal,
      MINI_MAX_OAUTH_REQUEST_TIMEOUT_MS,
    );
    const response = await proxyFetch(
      `${getMiniMaxOauthHost(region)}/oauth/code`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "x-request-id": randomUUID(),
        },
        body: toFormUrlEncoded({
          response_type: "code",
          client_id: MINI_MAX_CLIENT_ID,
          scope: MINI_MAX_OAUTH_SCOPE,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        }),
        signal: requestSignal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        text || response.statusText || "MiniMax OAuth init failed",
      );
    }

    const payload = (await response.json()) as MiniMaxOAuthAuthorization & {
      error?: string;
    };
    if (!payload.user_code || !payload.verification_uri) {
      throw new Error(
        payload.error ?? "MiniMax OAuth returned incomplete payload",
      );
    }
    if (payload.state !== state) {
      throw new Error("MiniMax OAuth state mismatch");
    }

    return {
      ...payload,
      verifier,
    };
  }

  private async pollMiniMaxOAuthToken(
    input: {
      region: MiniMaxRegion;
      userCode: string;
      verifier: string;
      expiresAt: number;
      intervalMs: number;
    },
    signal: AbortSignal,
  ): Promise<MiniMaxOAuthToken> {
    let pollIntervalMs = input.intervalMs;

    while (Date.now() < input.expiresAt) {
      if (signal.aborted) {
        throw new Error("MiniMax OAuth cancelled");
      }

      const requestSignal = this.createAbortSignalWithTimeout(
        signal,
        MINI_MAX_OAUTH_TOKEN_REQUEST_TIMEOUT_MS,
      );

      const response = await proxyFetch(
        `${getMiniMaxOauthHost(input.region)}/oauth/token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: toFormUrlEncoded({
            grant_type: MINI_MAX_OAUTH_GRANT_TYPE,
            client_id: MINI_MAX_CLIENT_ID,
            user_code: input.userCode,
            code_verifier: input.verifier,
          }),
          signal: requestSignal,
        },
      );

      const text = await response.text();
      const payload =
        text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (response.ok && payload.status === "success") {
        const access = payload.access_token;
        const refresh = payload.refresh_token;
        const expires = payload.expired_in;
        if (
          typeof access === "string" &&
          typeof refresh === "string" &&
          typeof expires === "number"
        ) {
          return {
            access,
            refresh,
            expires: Date.now() + durationSecondsToMs(expires),
            resourceUrl:
              typeof payload.resource_url === "string"
                ? payload.resource_url
                : undefined,
          };
        }

        throw new Error("MiniMax OAuth returned incomplete token payload");
      }

      if (payload.status === "error") {
        const baseResp = payload.base_resp;
        const statusMsg =
          typeof baseResp === "object" &&
          baseResp !== null &&
          typeof (baseResp as Record<string, unknown>).status_msg === "string"
            ? ((baseResp as Record<string, unknown>).status_msg as string)
            : null;
        throw new Error(statusMsg ?? "MiniMax OAuth failed");
      }

      await sleep(pollIntervalMs);
      pollIntervalMs = Math.min(
        pollIntervalMs * 1.5,
        MINI_MAX_MAX_POLL_INTERVAL_MS,
      );
    }

    throw new Error("MiniMax OAuth timed out waiting for authorization.");
  }

  private async execOpenClawCommand(args: string[]): Promise<void> {
    const spec = getOpenClawCommandSpec(this.env);
    await new Promise<void>((resolve, reject) => {
      execFile(
        spec.command,
        [...spec.argsPrefix, ...args],
        {
          cwd: this.env.openclawStateDir,
          env: {
            ...process.env,
            ...spec.extraEnv,
            OPENCLAW_CONFIG_PATH: this.env.openclawConfigPath,
            OPENCLAW_STATE_DIR: this.env.openclawStateDir,
          },
          timeout: OPENCLAW_COMMAND_TIMEOUT_MS,
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
  }

  private async restartRuntime(): Promise<void> {
    if (!this.openclawProcess.managesProcess()) {
      logger.info(
        {},
        "model_provider_runtime_restart_skipped_external_openclaw",
      );
      return;
    }

    await this.openclawProcess.stop();
    this.openclawProcess.enableAutoRestart();
    this.openclawProcess.start();
  }
}
