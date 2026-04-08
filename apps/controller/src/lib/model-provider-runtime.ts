import {
  type ModelProviderConfig,
  type PersistedModelsConfig,
  type ProviderSecretInput,
  getBundledProviderModels,
  getCustomProviderProtocolFamily,
  getDefaultProviderBaseUrls,
  getProviderAliasCandidates,
  getProviderRuntimePolicy,
  parseCustomProviderKey,
} from "@nexu/shared";
import type { NexuConfig } from "../store/schemas.js";
import { normalizeProviderBaseUrl } from "./provider-base-url.js";

type ProviderMetadataRecord = Record<string, unknown>;

export type ModelProviderRuntimeDescriptor = {
  persistedKey: string;
  runtimeKey: string;
  providerId: string;
  canonicalOpenClawId: string;
  runtimeModelNamespace: string;
  provider: ModelProviderConfig;
  aliasCandidates: string[];
  legacyRuntimePrefixes: string[];
  authProfileProviderId: string;
  authProfileRef: string | null;
  legacyOauthCredential: {
    provider: string;
    access: string;
    refresh?: string;
    expires?: number;
    email?: string;
  } | null;
  usesProxyRuntimeKey: boolean;
  isCustomProvider: boolean;
  apiKind: NonNullable<ReturnType<typeof getProviderRuntimePolicy>>["apiKind"];
  authHeader?: boolean;
  defaultHeaders?: Readonly<Record<string, string>>;
};

function getMetadataRecord(value: unknown): ProviderMetadataRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as ProviderMetadataRecord)
    : undefined;
}

function getCanonicalModelsConfig(config: NexuConfig): PersistedModelsConfig {
  return config.models;
}

function getProviderSecretValue(
  secret: ProviderSecretInput | undefined,
): ProviderSecretInput | null {
  if (typeof secret === "string") {
    return secret.length > 0 ? secret : null;
  }

  if (typeof secret === "object" && secret !== null) {
    return secret;
  }

  return null;
}

function getProviderHeaderValues(
  headers: ModelProviderConfig["headers"],
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const resolvedEntries = Object.entries(headers).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return resolvedEntries.length > 0
    ? Object.fromEntries(resolvedEntries)
    : undefined;
}

function resolveDefaultBaseUrls(
  providerId: string,
  oauthRegion: "global" | "cn" | null | undefined,
): string[] {
  if (providerId === "minimax" && oauthRegion === "cn") {
    return [
      "https://api.minimaxi.com/anthropic",
      ...getDefaultProviderBaseUrls(providerId).filter(
        (value) => value !== "https://api.minimaxi.com/anthropic",
      ),
    ];
  }

  return getDefaultProviderBaseUrls(providerId);
}

function isProviderProxied(input: {
  providerId: string;
  baseUrl: string;
  oauthRegion: "global" | "cn" | null | undefined;
}): boolean {
  const normalizedBaseUrl = normalizeProviderBaseUrl(input.baseUrl);
  if (normalizedBaseUrl === null) {
    return false;
  }

  const normalizedDefaultBaseUrls = new Set(
    resolveDefaultBaseUrls(input.providerId, input.oauthRegion)
      .map((value) => normalizeProviderBaseUrl(value))
      .filter((value): value is string => value !== null),
  );

  return (
    normalizedDefaultBaseUrls.size > 0 &&
    !normalizedDefaultBaseUrls.has(normalizedBaseUrl)
  );
}

export function encodeCustomProviderRuntimeKey(
  templateId: string,
  instanceId: string,
): string {
  return `${templateId}__${encodeURIComponent(instanceId)}`;
}

export function listModelProviderRuntimeDescriptors(
  config: NexuConfig,
): ModelProviderRuntimeDescriptor[] {
  return listModelProviderRuntimeDescriptorsFromProviders(
    getCanonicalModelsConfig(config).providers,
  );
}

export function listModelProviderRuntimeDescriptorsFromProviders(
  providers: PersistedModelsConfig["providers"],
): ModelProviderRuntimeDescriptor[] {
  return Object.entries(providers).flatMap(
    ([persistedKey, provider]): ModelProviderRuntimeDescriptor[] => {
      const customProvider = parseCustomProviderKey(persistedKey);
      const providerId = customProvider?.templateId ?? persistedKey;
      const runtimePolicy = getProviderRuntimePolicy(providerId);
      if (!runtimePolicy) {
        return [];
      }

      const defaultBaseUrls = resolveDefaultBaseUrls(
        providerId,
        provider.oauthRegion ?? null,
      );
      const fallbackBaseUrl = normalizeProviderBaseUrl(
        defaultBaseUrls[0] ?? null,
      );
      const normalizedProviderBaseUrl = normalizeProviderBaseUrl(
        provider.baseUrl,
      );
      const resolvedBaseUrl =
        normalizedProviderBaseUrl &&
        defaultBaseUrls.some(
          (value) =>
            normalizeProviderBaseUrl(value) === normalizedProviderBaseUrl,
        )
          ? (fallbackBaseUrl ?? normalizedProviderBaseUrl)
          : (normalizedProviderBaseUrl ?? fallbackBaseUrl);
      if (resolvedBaseUrl === null) {
        return [];
      }

      const resolvedModels =
        provider.models.length > 0
          ? provider.models
          : getBundledProviderModels(providerId).map((model) => ({
              id: model.id,
              name: model.name,
              reasoning: false,
              input: ["text"] as Array<"text" | "image">,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 0,
              maxTokens: 0,
              ...(runtimePolicy.apiKind ? { api: runtimePolicy.apiKind } : {}),
            }));

      const usesProxyRuntimeKey = customProvider
        ? false
        : isProviderProxied({
            providerId,
            baseUrl: resolvedBaseUrl,
            oauthRegion: provider.oauthRegion ?? null,
          });
      const runtimeKey = customProvider
        ? encodeCustomProviderRuntimeKey(
            customProvider.templateId,
            customProvider.instanceId,
          )
        : usesProxyRuntimeKey
          ? `byok_${runtimePolicy.canonicalOpenClawId}`
          : runtimePolicy.canonicalOpenClawId;
      const runtimeModelNamespace = customProvider
        ? (getCustomProviderProtocolFamily(customProvider.templateId) ??
          runtimePolicy.canonicalOpenClawId)
        : runtimePolicy.canonicalOpenClawId;
      const metadata = getMetadataRecord(provider.metadata);
      const legacyOauthCredential =
        typeof metadata?.legacyOauthCredential === "object" &&
        metadata.legacyOauthCredential !== null &&
        typeof (metadata.legacyOauthCredential as Record<string, unknown>)
          .provider === "string" &&
        typeof (metadata.legacyOauthCredential as Record<string, unknown>)
          .access === "string"
          ? (metadata.legacyOauthCredential as ModelProviderRuntimeDescriptor["legacyOauthCredential"])
          : null;
      const providerHeaderValues = getProviderHeaderValues(provider.headers);
      const defaultHeaders =
        providerHeaderValues || runtimePolicy.defaultHeaders
          ? {
              ...(runtimePolicy.defaultHeaders ?? {}),
              ...(providerHeaderValues ?? {}),
            }
          : undefined;

      return [
        {
          persistedKey,
          runtimeKey,
          providerId,
          canonicalOpenClawId: runtimePolicy.canonicalOpenClawId,
          runtimeModelNamespace,
          provider: {
            ...provider,
            baseUrl: resolvedBaseUrl,
            models: resolvedModels,
          },
          aliasCandidates: customProvider
            ? [persistedKey]
            : Array.from(
                new Set([
                  persistedKey,
                  ...getProviderAliasCandidates(providerId),
                ]),
              ),
          legacyRuntimePrefixes: customProvider
            ? []
            : Array.from(
                new Set([`byok_${runtimePolicy.canonicalOpenClawId}`]),
              ),
          authProfileProviderId: persistedKey,
          authProfileRef: provider.oauthProfileRef ?? null,
          legacyOauthCredential,
          usesProxyRuntimeKey,
          isCustomProvider: customProvider !== null,
          apiKind: provider.api ?? runtimePolicy.apiKind,
          authHeader: runtimePolicy.authHeader,
          defaultHeaders,
        },
      ];
    },
  );
}

export function resolveModelProviderApiKey(
  descriptor: ModelProviderRuntimeDescriptor,
): ProviderSecretInput | null {
  if (descriptor.provider.auth === "oauth") {
    return descriptor.legacyOauthCredential?.access ?? null;
  }

  return getProviderSecretValue(descriptor.provider.apiKey);
}

export function stripCanonicalModelPrefix(
  canonicalOpenClawId: string,
  modelId: string,
): string {
  return modelId.startsWith(`${canonicalOpenClawId}/`)
    ? modelId.slice(canonicalOpenClawId.length + 1)
    : modelId;
}

export function buildProviderRuntimeModelId(
  descriptor: ModelProviderRuntimeDescriptor,
  modelId: string,
): string {
  if (descriptor.isCustomProvider) {
    return modelId;
  }

  const normalizedModelId = stripCanonicalModelPrefix(
    descriptor.runtimeModelNamespace,
    modelId,
  );

  if (
    !descriptor.isCustomProvider &&
    !descriptor.usesProxyRuntimeKey &&
    descriptor.runtimeKey === descriptor.canonicalOpenClawId
  ) {
    return normalizedModelId;
  }

  return `${descriptor.runtimeModelNamespace}/${normalizedModelId}`;
}

export function buildProviderRuntimeModelRef(
  descriptor: ModelProviderRuntimeDescriptor,
  modelId: string,
): string {
  return `${descriptor.runtimeKey}/${buildProviderRuntimeModelId(descriptor, modelId)}`;
}

export function findProviderDescriptorForModelRef(
  descriptors: readonly ModelProviderRuntimeDescriptor[],
  rawModelId: string,
): {
  descriptor: ModelProviderRuntimeDescriptor;
  modelId: string;
} | null {
  const prefixes = descriptors.flatMap((descriptor) =>
    [
      ...descriptor.aliasCandidates,
      descriptor.runtimeKey,
      ...descriptor.legacyRuntimePrefixes,
    ].map((prefix) => ({ descriptor, prefix })),
  );

  prefixes.sort((left, right) => right.prefix.length - left.prefix.length);

  for (const { descriptor, prefix } of prefixes) {
    if (!rawModelId.startsWith(`${prefix}/`)) {
      continue;
    }

    const remainder = rawModelId.slice(prefix.length + 1);
    return {
      descriptor,
      modelId: descriptor.isCustomProvider
        ? remainder
        : stripCanonicalModelPrefix(
            descriptor.runtimeModelNamespace,
            remainder,
          ),
    };
  }

  return null;
}
