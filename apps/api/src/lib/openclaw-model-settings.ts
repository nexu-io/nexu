import type {
  Model,
  OpenClawConfig,
  UpdateOpenClawModelSettingsInput,
} from "@nexu/shared";
import type { OpenClawModelSettingsResponse } from "@nexu/shared";
import { z } from "zod";

const MODEL_SETTINGS_SECRET_NAME = "OPENCLAW_MODEL_SETTINGS_JSON";

const storedProviderModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean(),
});

const storedProviderSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().nullable().optional(),
  apiKey: z.string().nullable().optional(),
  models: z.array(storedProviderModelSchema),
});

const storedSettingsSchema = z.object({
  poolId: z.string().optional(),
  updatedAt: z.string().nullable(),
  providers: z.record(z.string(), storedProviderSchema),
});

type StoredProvider = {
  enabled: boolean;
  baseUrl?: string | null;
  apiKey?: string | null;
  models: Array<{
    id: string;
    name?: string;
    enabled: boolean;
  }>;
};

type StoredSettings = {
  updatedAt: string | null;
  providers: Record<string, StoredProvider>;
};

interface ProviderRuntimeDefaults {
  api: string;
  baseUrl: string;
}

const PROVIDER_RUNTIME_DEFAULTS: Record<string, ProviderRuntimeDefaults> = {
  anthropic: {
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
  },
  gemini: {
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  openai: {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
  },
  openrouter: {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
  },
};

export function getOpenclawModelSettingsSecretName(): string {
  return MODEL_SETTINGS_SECRET_NAME;
}

export function parseStoredOpenclawModelSettings(
  raw: string | null | undefined,
): StoredSettings | null {
  if (!raw) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = storedSettingsSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }

  const providers: Record<string, StoredProvider> = {};
  for (const [providerId, provider] of Object.entries(parsed.data.providers)) {
    providers[providerId] = {
      enabled: provider.enabled,
      baseUrl: provider.baseUrl ?? null,
      apiKey: provider.apiKey ?? null,
      models: provider.models.map((model) =>
        storedProviderModelSchema.parse(model),
      ),
    };
  }

  return {
    updatedAt: parsed.data.updatedAt,
    providers,
  };
}

export function toOpenclawModelSettingsResponse(
  poolId: string,
  stored: StoredSettings | null,
): OpenClawModelSettingsResponse {
  const providers: OpenClawModelSettingsResponse["providers"] = {};

  for (const [providerId, provider] of Object.entries(
    stored?.providers ?? {},
  )) {
    providers[providerId] = {
      enabled: provider.enabled,
      baseUrl: provider.baseUrl ?? null,
      apiKeyConfigured: Boolean(provider.apiKey),
      models: provider.models,
    };
  }

  return {
    poolId,
    updatedAt: stored?.updatedAt ?? null,
    providers,
  };
}

export function mergeOpenclawModelSettings(
  previous: StoredSettings | null,
  input: UpdateOpenClawModelSettingsInput,
  updatedAt: string,
): StoredSettings {
  const providers: Record<string, StoredProvider> = {};

  for (const [providerId, provider] of Object.entries(input.providers)) {
    const previousProvider = previous?.providers[providerId];
    const nextApiKey = provider.clearApiKey
      ? null
      : provider.apiKey?.trim() || previousProvider?.apiKey || null;

    providers[providerId] = {
      enabled: provider.enabled,
      baseUrl: provider.baseUrl?.trim() || null,
      apiKey: nextApiKey,
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name,
        enabled: model.enabled,
      })),
    };
  }

  return {
    updatedAt,
    providers,
  };
}

export function stringifyStoredOpenclawModelSettings(
  stored: StoredSettings,
): string {
  return JSON.stringify(stored);
}

export function buildConfiguredModelProviders(
  stored: StoredSettings | null,
): OpenClawConfig["models"] | undefined {
  if (!stored) {
    return undefined;
  }

  const providers: NonNullable<OpenClawConfig["models"]>["providers"] = {};

  for (const [providerId, provider] of Object.entries(stored.providers)) {
    if (!provider.enabled || !provider.apiKey) {
      continue;
    }

    const enabledModels = provider.models.filter((model) => model.enabled);
    if (enabledModels.length === 0) {
      continue;
    }

    const runtimeDefaults = PROVIDER_RUNTIME_DEFAULTS[providerId];
    if (!runtimeDefaults) {
      continue;
    }

    providers[providerId] = {
      baseUrl: provider.baseUrl || runtimeDefaults.baseUrl,
      apiKey: provider.apiKey,
      api: runtimeDefaults.api,
      models: enabledModels.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
      })),
    };
  }

  if (Object.keys(providers).length === 0) {
    return undefined;
  }

  return {
    mode: "merge",
    providers,
  };
}

export function buildConfiguredModels(stored: StoredSettings | null): Model[] {
  if (!stored) {
    return [];
  }

  const models: Model[] = [];
  for (const [providerId, provider] of Object.entries(stored.providers)) {
    if (!provider.enabled || !provider.apiKey) {
      continue;
    }

    for (const model of provider.models) {
      if (!model.enabled) {
        continue;
      }

      models.push({
        id: `${providerId}/${model.id}`,
        name: model.name ?? model.id,
        provider: providerId,
        description: "Configured in OpenClaw provider settings",
      });
    }
  }

  return models;
}
