import type {
  CustomProviderProtocolFamily,
  ProviderRegistryEntry,
  ProviderUiMetadata,
} from "./provider-types.js";

const providerRegistryEntries = [
  {
    id: "anthropic",
    canonicalOpenClawId: "anthropic",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Anthropic",
    descriptionKey: "models.provider.anthropic.description",
    apiDocsUrl: "https://console.anthropic.com/settings/keys",
    apiKeyPlaceholder: "sk-ant-api03-...",
    defaultProxyUrl: "https://api.anthropic.com",
    authModes: ["api-key"],
    apiKind: "anthropic-messages",
    defaultBaseUrls: ["https://api.anthropic.com/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "openai",
    canonicalOpenClawId: "openai",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "OpenAI",
    descriptionKey: "models.provider.openai.description",
    apiDocsUrl: "https://platform.openai.com/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.openai.com/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.openai.com/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "google",
    canonicalOpenClawId: "gemini",
    aliases: ["gemini"],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Google AI",
    descriptionKey: "models.provider.google.description",
    apiDocsUrl: "https://aistudio.google.com/app/apikey",
    apiKeyPlaceholder: "AIza...",
    defaultProxyUrl: "https://generativelanguage.googleapis.com/v1beta",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: [
      "https://generativelanguage.googleapis.com/v1beta/openai",
    ],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "ollama",
    canonicalOpenClawId: "ollama",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Ollama",
    descriptionKey: "models.provider.ollama.description",
    apiDocsUrl: "https://ollama.com/download",
    apiKeyPlaceholder: "ollama-local",
    defaultProxyUrl: "http://127.0.0.1:11434",
    authModes: ["api-key"],
    apiKind: "ollama",
    defaultBaseUrls: ["http://127.0.0.1:11434"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
  },
  {
    id: "siliconflow",
    canonicalOpenClawId: "siliconflow",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "SiliconFlow",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://cloud.siliconflow.cn/account/ak",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.siliconflow.cn/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: [
      "https://api.siliconflow.cn/v1",
      "https://api.siliconflow.com/v1",
    ],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "ppio",
    canonicalOpenClawId: "ppio",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "PPIO",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://www.ppinfra.com/",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.ppinfra.com/v3/openai",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.ppinfra.com/v3/openai"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "openrouter",
    canonicalOpenClawId: "openrouter",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "OpenRouter",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://openrouter.ai/settings/keys",
    apiKeyPlaceholder: "sk-or-...",
    defaultProxyUrl: "https://openrouter.ai/api/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://openrouter.ai/api/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "minimax",
    canonicalOpenClawId: "minimax",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "MiniMax",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.minimax.io/anthropic",
    authModes: ["api-key", "oauth"],
    apiKind: "anthropic-messages",
    defaultBaseUrls: [
      "https://api.minimax.io/anthropic",
      "https://api.minimaxi.com/anthropic",
    ],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
    requiresOauthRegion: true,
    authHeader: true,
    managedByAuthProfiles: true,
  },
  {
    id: "kimi",
    canonicalOpenClawId: "moonshot",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "Kimi",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://platform.moonshot.cn/console/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.moonshot.cn/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.moonshot.cn/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "glm",
    canonicalOpenClawId: "zai",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: true,
    displayName: "GLM",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    apiKeyPlaceholder: "eyJ...",
    defaultProxyUrl: "https://open.bigmodel.cn/api/paas/v4",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://open.bigmodel.cn/api/paas/v4"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "moonshot",
    canonicalOpenClawId: "moonshot",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "Moonshot AI",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://platform.moonshot.cn/console/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.moonshot.cn/v1",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://api.moonshot.cn/v1"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "zai",
    canonicalOpenClawId: "zai",
    aliases: [],
    controllerConfigurable: true,
    modelsPageVisible: false,
    displayName: "Z.ai",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    apiKeyPlaceholder: "eyJ...",
    defaultProxyUrl: "https://open.bigmodel.cn/api/paas/v4",
    authModes: ["api-key"],
    apiKind: "openai-completions",
    defaultBaseUrls: ["https://open.bigmodel.cn/api/paas/v4"],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
  },
  {
    id: "custom-openai",
    canonicalOpenClawId: "custom-openai",
    aliases: [],
    controllerConfigurable: false,
    modelsPageVisible: false,
    displayName: "Custom OpenAI-compatible",
    descriptionKey: "models.provider.openaiCompatible.description",
    authModes: ["api-key", "token"],
    apiKind: "openai-completions",
    defaultBaseUrls: [],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
    hidden: true,
  },
  {
    id: "custom-anthropic",
    canonicalOpenClawId: "custom-anthropic",
    aliases: [],
    controllerConfigurable: false,
    modelsPageVisible: false,
    displayName: "Custom Anthropic-compatible",
    descriptionKey: "models.provider.anthropic.description",
    authModes: ["api-key", "token"],
    apiKind: "anthropic-messages",
    defaultBaseUrls: [],
    supportsCustomBaseUrl: true,
    supportsModelDiscovery: true,
    supportsProxyMode: true,
    hidden: true,
  },
] as const satisfies readonly ProviderRegistryEntry[];

type ProviderRegistryEntryId = (typeof providerRegistryEntries)[number]["id"];
type ProviderRegistryEntryConfigurableId = Extract<
  (typeof providerRegistryEntries)[number],
  { controllerConfigurable: true }
>["id"];
type ProviderRegistryEntryModelsPageId = Extract<
  (typeof providerRegistryEntries)[number],
  { modelsPageVisible: true }
>["id"];

function cloneProviderRegistryEntry(
  entry: ProviderRegistryEntry,
): ProviderRegistryEntry {
  return {
    ...entry,
    aliases: [...entry.aliases],
    authModes: [...entry.authModes],
    defaultBaseUrls: [...entry.defaultBaseUrls],
    defaultHeaders: entry.defaultHeaders
      ? { ...entry.defaultHeaders }
      : undefined,
  };
}

export const supportedByokProviderIds = providerRegistryEntries
  .filter((entry) => entry.controllerConfigurable)
  .map((entry) => entry.id) as [
  ProviderRegistryEntryConfigurableId,
  ...ProviderRegistryEntryConfigurableId[],
];

export type SupportedByokProviderId = (typeof supportedByokProviderIds)[number];

export const modelsPageProviderIds = providerRegistryEntries
  .filter((entry) => entry.modelsPageVisible)
  .map((entry) => entry.id) as [
  ProviderRegistryEntryModelsPageId,
  ...ProviderRegistryEntryModelsPageId[],
];

export type ModelsPageProviderId = (typeof modelsPageProviderIds)[number];

const providerRegistryEntryMap = new Map<string, ProviderRegistryEntry>(
  providerRegistryEntries.map((entry) => [entry.id, entry]),
);

const normalizedProviderIdMap = new Map<string, string>();

for (const entry of providerRegistryEntries) {
  normalizedProviderIdMap.set(entry.id.toLowerCase(), entry.id);
  for (const alias of entry.aliases) {
    normalizedProviderIdMap.set(alias.toLowerCase(), entry.id);
  }
}

const supportedByokProviderIdSet = new Set<string>(supportedByokProviderIds);

export function listProviderRegistryEntries(): ProviderRegistryEntry[] {
  return providerRegistryEntries.map((entry) =>
    cloneProviderRegistryEntry(entry),
  );
}

export function getProviderRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | null {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!normalizedProviderId) {
    return null;
  }

  const entry = providerRegistryEntryMap.get(normalizedProviderId);
  return entry ? cloneProviderRegistryEntry(entry) : null;
}

export function normalizeProviderId(providerId: string): string | null {
  const normalizedInput = providerId.trim().toLowerCase();
  if (normalizedInput.length === 0) {
    return null;
  }

  return normalizedProviderIdMap.get(normalizedInput) ?? null;
}

export function getProviderAliasCandidates(providerId: string): string[] {
  const entry = getProviderRegistryEntry(providerId);
  if (!entry) {
    return [];
  }

  return Array.from(
    new Set([entry.id, entry.canonicalOpenClawId, ...entry.aliases]),
  );
}

export function isKnownProviderId(providerId: string): boolean {
  return normalizeProviderId(providerId) !== null;
}

export function isSupportedByokProviderId(
  providerId: string,
): providerId is SupportedByokProviderId {
  return supportedByokProviderIdSet.has(providerId as ProviderRegistryEntryId);
}

export function getDefaultProviderBaseUrls(providerId: string): string[] {
  return getProviderRegistryEntry(providerId)?.defaultBaseUrls.slice() ?? [];
}

export function getProviderUiMetadata(
  providerId: string,
): ProviderUiMetadata | null {
  const entry = getProviderRegistryEntry(providerId);
  if (!entry) {
    return null;
  }

  return {
    displayName: entry.displayName,
    descriptionKey: entry.descriptionKey,
    apiDocsUrl: entry.apiDocsUrl,
    apiKeyPlaceholder: entry.apiKeyPlaceholder,
    defaultProxyUrl: entry.defaultProxyUrl,
    logo: entry.logo,
  };
}

export function getProviderRuntimePolicy(providerId: string): {
  canonicalOpenClawId: string;
  apiKind: ProviderRegistryEntry["apiKind"];
  authModes: ProviderRegistryEntry["authModes"];
  authHeader?: boolean;
  defaultHeaders?: Readonly<Record<string, string>>;
  managedByAuthProfiles?: boolean;
  requiresOauthRegion?: boolean;
  supportsCustomBaseUrl?: boolean;
  supportsModelDiscovery?: boolean;
  supportsProxyMode?: boolean;
} | null {
  const entry = getProviderRegistryEntry(providerId);
  if (!entry) {
    return null;
  }

  return {
    canonicalOpenClawId: entry.canonicalOpenClawId,
    apiKind: entry.apiKind,
    authModes: entry.authModes,
    authHeader: entry.authHeader,
    defaultHeaders: entry.defaultHeaders,
    managedByAuthProfiles: entry.managedByAuthProfiles,
    requiresOauthRegion: entry.requiresOauthRegion,
    supportsCustomBaseUrl: entry.supportsCustomBaseUrl,
    supportsModelDiscovery: entry.supportsModelDiscovery,
    supportsProxyMode: entry.supportsProxyMode,
  };
}

export function getCustomProviderProtocolFamily(
  providerId: string,
): CustomProviderProtocolFamily | null {
  const normalizedProviderId = normalizeProviderId(providerId);
  switch (normalizedProviderId) {
    case "custom-openai":
      return "openai";
    case "custom-anthropic":
      return "anthropic";
    default:
      return null;
  }
}
