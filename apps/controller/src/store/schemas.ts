import {
  type ModelProviderConfig,
  type ModelProviderModelEntry,
  type PersistedModelsConfig,
  botResponseSchema,
  buildCustomProviderKey,
  channelResponseSchema,
  getDefaultProviderBaseUrls,
  getProviderAliasCandidates,
  getProviderRuntimePolicy,
  integrationResponseSchema,
  normalizeProviderId,
  parseCustomProviderKey,
  persistedModelsConfigSchema,
  providerResponseSchema,
} from "@nexu/shared";
import { z } from "zod";

const LEGACY_PROVIDER_MIGRATION_CREATED_AT = "1970-01-01T00:00:00.000Z";
export const CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION = 2;

type ProviderMetadataRecord = Record<string, unknown>;

function getMetadataRecord(value: unknown): ProviderMetadataRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as ProviderMetadataRecord)
    : undefined;
}

function normalizeProviderStorageKey(providerId: string): string | null {
  const customProvider = parseCustomProviderKey(providerId);
  if (customProvider) {
    return buildCustomProviderKey(
      customProvider.templateId,
      customProvider.instanceId,
    );
  }

  return normalizeProviderId(providerId);
}

function encodeCustomProviderRuntimeKey(
  templateId: string,
  instanceId: string,
): string {
  return `${templateId}__${encodeURIComponent(instanceId)}`;
}

function getProviderRuntimeNamespace(providerKey: string): string | null {
  const customProvider = parseCustomProviderKey(providerKey);
  if (customProvider) {
    return null;
  }

  const runtimePolicy = getProviderRuntimePolicy(providerKey);
  if (!runtimePolicy) {
    return null;
  }

  return runtimePolicy.canonicalOpenClawId;
}

function stripRuntimeModelNamespace(
  modelId: string,
  namespace: string,
): string {
  return modelId.startsWith(`${namespace}/`)
    ? modelId.slice(namespace.length + 1)
    : modelId;
}

function matchPersistedModelRef(
  modelsConfig: PersistedModelsConfig,
  rawModelId: string,
): { persistedKey: string; modelId: string } | null {
  const prefixes = Object.entries(modelsConfig.providers).flatMap(
    ([persistedKey]): Array<{
      persistedKey: string;
      prefix: string;
      runtimeNamespace: string | null;
    }> => {
      const customProvider = parseCustomProviderKey(persistedKey);
      const providerId = customProvider?.templateId ?? persistedKey;
      const runtimePolicy = getProviderRuntimePolicy(providerId);
      const runtimeNamespace = getProviderRuntimeNamespace(persistedKey);
      if (!runtimePolicy) {
        return [];
      }

      const candidatePrefixes = customProvider
        ? [
            persistedKey,
            encodeCustomProviderRuntimeKey(
              customProvider.templateId,
              customProvider.instanceId,
            ),
          ]
        : [
            persistedKey,
            ...getProviderAliasCandidates(providerId),
            `byok_${runtimePolicy.canonicalOpenClawId}`,
          ];

      return Array.from(new Set(candidatePrefixes)).map((prefix) => ({
        persistedKey,
        prefix,
        runtimeNamespace,
      }));
    },
  );

  prefixes.sort((left, right) => right.prefix.length - left.prefix.length);

  for (const { persistedKey, prefix, runtimeNamespace } of prefixes) {
    if (!rawModelId.startsWith(`${prefix}/`)) {
      continue;
    }

    const remainder = rawModelId.slice(prefix.length + 1);
    return {
      persistedKey,
      modelId: runtimeNamespace
        ? stripRuntimeModelNamespace(remainder, runtimeNamespace)
        : remainder,
    };
  }

  return null;
}

function normalizePersistedModelRef(
  rawModelId: string,
  modelsConfig: PersistedModelsConfig,
): string {
  const modelId = rawModelId.trim();
  if (modelId.length === 0) {
    return modelId;
  }

  if (
    modelId.startsWith("link/") ||
    modelId.startsWith("litellm/") ||
    modelId.startsWith("debug/")
  ) {
    return modelId;
  }

  const matched = matchPersistedModelRef(modelsConfig, modelId);
  if (matched) {
    return `${matched.persistedKey}/${matched.modelId}`;
  }

  if (modelId.startsWith("byok_")) {
    const slashIndex = modelId.indexOf("/");
    if (slashIndex > 0 && slashIndex < modelId.length - 1) {
      return normalizePersistedModelRef(
        modelId.slice(slashIndex + 1),
        modelsConfig,
      );
    }
  }

  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0 || slashIndex === modelId.length - 1) {
    return modelId;
  }

  const providerPrefix = modelId.slice(0, slashIndex);
  const remainder = modelId.slice(slashIndex + 1);
  const normalizedProviderPrefix = normalizeProviderStorageKey(providerPrefix);
  if (!normalizedProviderPrefix) {
    return modelId;
  }

  return `${normalizedProviderPrefix}/${remainder}`;
}

function normalizeProviderModelId(
  providerKey: string,
  rawModelId: string,
  modelsConfig: PersistedModelsConfig,
): string {
  const normalizedRef = normalizePersistedModelRef(rawModelId, modelsConfig);
  if (normalizedRef.startsWith(`${providerKey}/`)) {
    return normalizedRef.slice(providerKey.length + 1);
  }

  const runtimeNamespace = getProviderRuntimeNamespace(providerKey);
  if (runtimeNamespace) {
    return stripRuntimeModelNamespace(normalizedRef, runtimeNamespace);
  }

  return normalizedRef;
}

function normalizeCanonicalModelsConfig(
  modelsConfig: PersistedModelsConfig,
): PersistedModelsConfig {
  const normalizedProviders = Object.fromEntries(
    Object.entries(modelsConfig.providers).flatMap(
      ([providerKey, provider]) => {
        const normalizedProviderKey = normalizeProviderStorageKey(providerKey);
        if (!normalizedProviderKey) {
          return [];
        }

        return [[normalizedProviderKey, provider]];
      },
    ),
  );

  const normalizedConfig: PersistedModelsConfig = {
    ...modelsConfig,
    providers: normalizedProviders,
  };

  return {
    ...normalizedConfig,
    providers: Object.fromEntries(
      Object.entries(normalizedConfig.providers).map(
        ([providerKey, provider]) => [
          providerKey,
          {
            ...provider,
            models: provider.models.map((model) => ({
              ...model,
              id: normalizeProviderModelId(
                providerKey,
                model.id,
                normalizedConfig,
              ),
            })),
          },
        ],
      ),
    ),
  };
}

function buildCanonicalModelEntry(
  providerKey: string,
  modelId: string,
): ModelProviderModelEntry {
  const customProvider = parseCustomProviderKey(providerKey);
  const providerPolicy = getProviderRuntimePolicy(
    customProvider?.templateId ?? providerKey,
  );

  return {
    id: modelId,
    name: modelId,
    api: providerPolicy?.apiKind,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 0,
    maxTokens: 0,
  };
}

function buildCanonicalProviderBaseUrl(
  providerId: string,
  baseUrl: string | null,
  oauthRegion: "global" | "cn" | null,
) {
  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    return baseUrl;
  }

  if (providerId === "minimax" && oauthRegion === "cn") {
    return "https://api.minimaxi.com/anthropic";
  }

  return getDefaultProviderBaseUrls(providerId)[0] ?? null;
}

function migrateLegacyProviderToCanonicalConfig(
  provider: ControllerProvider,
): [string, ModelProviderConfig] | null {
  const providerKey = normalizeProviderStorageKey(provider.providerId);
  if (!providerKey) {
    return null;
  }

  const customProvider = parseCustomProviderKey(providerKey);
  const runtimePolicy = getProviderRuntimePolicy(
    customProvider?.templateId ?? providerKey,
  );
  const hasApiKey =
    typeof provider.apiKey === "string" && provider.apiKey.length > 0;
  const baseUrl = buildCanonicalProviderBaseUrl(
    provider.providerId,
    provider.baseUrl,
    provider.oauthRegion,
  );

  if (baseUrl === null) {
    return null;
  }

  const metadata: ProviderMetadataRecord = {
    legacyId: provider.id,
    legacyCreatedAt: provider.createdAt,
    legacyUpdatedAt: provider.updatedAt,
  };

  if (provider.oauthCredential) {
    metadata.legacyOauthCredential = provider.oauthCredential;
  }

  const nextProvider: ModelProviderConfig = {
    ...(customProvider
      ? {
          providerTemplateId: customProvider.templateId,
          instanceId: customProvider.instanceId,
        }
      : {}),
    enabled: provider.enabled,
    displayName: provider.displayName ?? undefined,
    baseUrl,
    ...(provider.authMode === "oauth"
      ? { auth: "oauth" as const }
      : hasApiKey
        ? { auth: "api-key" as const }
        : {}),
    api: runtimePolicy?.apiKind,
    ...((provider.authMode === "apiKey" || provider.authMode === undefined) &&
    hasApiKey
      ? { apiKey: provider.apiKey as string }
      : {}),
    ...(provider.oauthRegion ? { oauthRegion: provider.oauthRegion } : {}),
    ...(provider.oauthCredential?.provider
      ? { oauthProfileRef: provider.oauthCredential.provider }
      : {}),
    models: provider.models.map((modelId) =>
      buildCanonicalModelEntry(providerKey, modelId),
    ),
    metadata,
  };

  return [providerKey, nextProvider];
}

export function migrateLegacyProvidersToCanonicalModelsConfig(
  providers: ReadonlyArray<ControllerProvider>,
): PersistedModelsConfig {
  const nextProviders: Record<string, ModelProviderConfig> = {};

  for (const provider of providers) {
    const migrated = migrateLegacyProviderToCanonicalConfig(provider);
    if (!migrated) {
      continue;
    }

    const [providerKey, nextProvider] = migrated;
    nextProviders[providerKey] = nextProvider;
  }

  return {
    mode: "merge",
    providers: nextProviders,
  };
}

function migrateCanonicalProviderToLegacyProvider(
  providerKey: string,
  provider: ModelProviderConfig,
): ControllerProvider | null {
  const metadata = getMetadataRecord(provider.metadata);
  const providerId = providerKey;
  const legacyId =
    typeof metadata?.legacyId === "string" && metadata.legacyId.length > 0
      ? metadata.legacyId
      : providerId;
  const createdAt =
    typeof metadata?.legacyCreatedAt === "string" &&
    metadata.legacyCreatedAt.length > 0
      ? metadata.legacyCreatedAt
      : LEGACY_PROVIDER_MIGRATION_CREATED_AT;
  const updatedAt =
    typeof metadata?.legacyUpdatedAt === "string" &&
    metadata.legacyUpdatedAt.length > 0
      ? metadata.legacyUpdatedAt
      : createdAt;
  const oauthCredential =
    typeof metadata?.legacyOauthCredential === "object" &&
    metadata.legacyOauthCredential !== null
      ? (metadata.legacyOauthCredential as ControllerProvider["oauthCredential"])
      : null;

  return {
    id: legacyId,
    providerId,
    displayName: provider.displayName ?? null,
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    authMode: provider.auth === "oauth" ? "oauth" : "apiKey",
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : null,
    oauthRegion: provider.oauthRegion ?? null,
    oauthCredential,
    models: provider.models.map((model) => model.id),
    createdAt,
    updatedAt,
  };
}

export function deriveLegacyProvidersFromCanonicalModelsConfig(
  modelsConfig: PersistedModelsConfig,
): ControllerProvider[] {
  return Object.entries(modelsConfig.providers)
    .map(([providerKey, provider]) =>
      migrateCanonicalProviderToLegacyProvider(providerKey, provider),
    )
    .filter((provider): provider is ControllerProvider => provider !== null);
}

function normalizeModelsConfigInput(
  candidateModels: unknown,
  legacyProviders: ReadonlyArray<ControllerProvider>,
): PersistedModelsConfig {
  const parsedModels = persistedModelsConfigSchema.safeParse(candidateModels);
  if (parsedModels.success) {
    return normalizeCanonicalModelsConfig(parsedModels.data);
  }

  return normalizeCanonicalModelsConfig(
    migrateLegacyProvidersToCanonicalModelsConfig(legacyProviders),
  );
}

function normalizeNexuConfigSchemaVersion(
  schemaVersion: unknown,
  input: Record<string, unknown>,
): number {
  const parsedSchemaVersion =
    typeof schemaVersion === "number" ? schemaVersion : 1;

  const hasCanonicalModels = input.models !== undefined;
  const hasLegacyProviders =
    Array.isArray(input.providers) && input.providers.length > 0;

  if (!hasCanonicalModels && !hasLegacyProviders) {
    return parsedSchemaVersion;
  }

  return Math.max(
    parsedSchemaVersion,
    CANONICAL_MODELS_PROVIDERS_CUTOVER_SCHEMA_VERSION,
  );
}

export const controllerRuntimeConfigSchema = z
  .object({
    gateway: z
      .object({
        port: z.number().int().positive().default(18789),
        bind: z.enum(["loopback", "lan", "auto"]).default("loopback"),
        authMode: z.enum(["none", "token"]).default("none"),
      })
      .default({ port: 18789, bind: "loopback", authMode: "none" }),
    defaultModelId: z.string().default("link/gemini-3-flash-preview"),
  })
  .passthrough();

export const controllerProviderSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  authMode: z.enum(["apiKey", "oauth"]).default("apiKey"),
  apiKey: z.string().nullable(),
  oauthRegion: z.enum(["global", "cn"]).nullable().default(null),
  oauthCredential: z
    .object({
      provider: z.string(),
      access: z.string(),
      refresh: z.string().optional(),
      expires: z.number().int().optional(),
      email: z.string().optional(),
    })
    .nullable()
    .default(null),
  models: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const controllerProviderInputSchema = z.object({
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  displayName: z.string().optional(),
  authMode: z.enum(["apiKey", "oauth"]).optional(),
  modelsJson: z.string().optional(),
});

export const storedProviderResponseSchema = providerResponseSchema.extend({
  apiKey: z.string().nullable().optional(),
  models: z.array(z.string()).optional(),
});

export const controllerTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  writeMode: z.enum(["seed", "inject"]).default("seed"),
  status: z.enum(["active", "inactive"]).default("active"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const controllerTemplateUpsertBodySchema = z.object({
  content: z.string().min(1),
  writeMode: z.enum(["seed", "inject"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const controllerArtifactSchema = z.object({
  id: z.string(),
  botId: z.string(),
  title: z.string(),
  sessionKey: z.string().nullable(),
  channelType: z.string().nullable(),
  channelId: z.string().nullable(),
  artifactType: z.string().nullable(),
  source: z.string().nullable(),
  contentType: z.string().nullable(),
  status: z.string(),
  previewUrl: z.string().nullable(),
  deployTarget: z.string().nullable(),
  linesOfCode: z.number().nullable(),
  fileCount: z.number().nullable(),
  durationMs: z.number().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const nexuConfigObjectSchema = z.object({
  $schema: z.string(),
  schemaVersion: z.number().int().positive(),
  app: z.record(z.unknown()).default({}),
  bots: z.array(botResponseSchema).default([]),
  runtime: controllerRuntimeConfigSchema,
  models: persistedModelsConfigSchema.default({ mode: "merge", providers: {} }),
  providers: z.array(controllerProviderSchema).optional(),
  integrations: z.array(integrationResponseSchema).default([]),
  channels: z.array(channelResponseSchema).default([]),
  templates: z.record(z.string(), controllerTemplateSchema).default({}),
  desktop: z
    .object({
      localProfile: z.unknown().optional(),
      cloud: z.unknown().optional(),
      locale: z.enum(["en", "zh-CN"]).optional(),
      analyticsEnabled: z.boolean().optional(),
    })
    .catchall(z.unknown())
    .default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

export const nexuConfigSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const candidate = input as Record<string, unknown>;
  const legacyProviders = Array.isArray(candidate.providers)
    ? candidate.providers
    : [];
  const models = normalizeModelsConfigInput(candidate.models, legacyProviders);
  const runtimeCandidate =
    typeof candidate.runtime === "object" && candidate.runtime !== null
      ? (candidate.runtime as Record<string, unknown>)
      : null;
  const desktopCandidate =
    typeof candidate.desktop === "object" && candidate.desktop !== null
      ? (candidate.desktop as Record<string, unknown>)
      : null;
  return {
    $schema:
      typeof candidate.$schema === "string"
        ? candidate.$schema
        : "https://nexu.io/config.json",
    schemaVersion: normalizeNexuConfigSchemaVersion(
      candidate.schemaVersion,
      candidate,
    ),
    app:
      typeof candidate.app === "object" && candidate.app !== null
        ? candidate.app
        : {},
    bots: Array.isArray(candidate.bots)
      ? candidate.bots.map((bot) =>
          typeof bot === "object" &&
          bot !== null &&
          typeof bot.modelId === "string"
            ? {
                ...bot,
                modelId: normalizePersistedModelRef(bot.modelId, models),
              }
            : bot,
        )
      : [],
    runtime: runtimeCandidate
      ? {
          ...runtimeCandidate,
          ...(typeof runtimeCandidate.defaultModelId === "string"
            ? {
                defaultModelId: normalizePersistedModelRef(
                  runtimeCandidate.defaultModelId,
                  models,
                ),
              }
            : {}),
        }
      : {},
    models,
    integrations: Array.isArray(candidate.integrations)
      ? candidate.integrations
      : [],
    channels: Array.isArray(candidate.channels) ? candidate.channels : [],
    templates:
      typeof candidate.templates === "object" && candidate.templates !== null
        ? candidate.templates
        : {},
    desktop: desktopCandidate
      ? {
          ...desktopCandidate,
          ...(typeof desktopCandidate.selectedModelId === "string"
            ? {
                selectedModelId: normalizePersistedModelRef(
                  desktopCandidate.selectedModelId,
                  models,
                ),
              }
            : {}),
        }
      : {},
    secrets:
      typeof candidate.secrets === "object" && candidate.secrets !== null
        ? candidate.secrets
        : {},
  };
}, nexuConfigObjectSchema);

export const artifactsIndexSchema = z.object({
  schemaVersion: z.number().int().positive(),
  artifacts: z.array(controllerArtifactSchema).default([]),
});

export const compiledOpenClawSnapshotSchema = z.object({
  updatedAt: z.string(),
  config: z.record(z.unknown()),
});

export const cloudProfileEntrySchema = z.object({
  name: z.string().min(1),
  cloudUrl: z.string().min(1),
  linkUrl: z.string().min(1),
});

export const cloudProfilesFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  profiles: z.array(cloudProfileEntrySchema).default([]),
});

export type NexuConfig = z.infer<typeof nexuConfigSchema>;
export type ControllerRuntimeConfig = z.infer<
  typeof controllerRuntimeConfigSchema
>;
export type ControllerProvider = z.infer<typeof controllerProviderSchema>;
export type ControllerArtifact = z.infer<typeof controllerArtifactSchema>;
export type ArtifactsIndex = z.infer<typeof artifactsIndexSchema>;
export type CloudProfileEntry = z.infer<typeof cloudProfileEntrySchema>;
export type CloudProfilesFile = z.infer<typeof cloudProfilesFileSchema>;
