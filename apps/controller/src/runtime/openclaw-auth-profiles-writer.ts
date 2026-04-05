import type { OpenClawConfig, PersistedModelsConfig } from "@nexu/shared";
import { logger } from "../lib/logger.js";
import { listModelProviderRuntimeDescriptorsFromProviders } from "../lib/model-provider-runtime.js";
import type { ControllerProvider } from "../store/schemas.js";
import type {
  AuthProfilesData,
  OpenClawAuthProfilesStore,
} from "./openclaw-auth-profiles-store.js";

type AuthProfileRecord =
  | {
      type: "api_key";
      provider: string;
      key: string;
    }
  | {
      type: "oauth";
      provider: string;
      access: string;
      refresh?: string;
      expires?: number;
      email?: string;
    };

type AuthProfileEntry = [string, AuthProfileRecord];

function isApiKeyProfile(profile: unknown): profile is { type: "api_key" } {
  return (
    typeof profile === "object" &&
    profile !== null &&
    "type" in profile &&
    (profile as Record<string, unknown>).type === "api_key"
  );
}

export class OpenClawAuthProfilesWriter {
  constructor(private readonly authProfilesStore: OpenClawAuthProfilesStore) {}

  async writeForAgents(
    config: OpenClawConfig,
    providerSource:
      | ControllerProvider[]
      | PersistedModelsConfig["providers"]
      | undefined = undefined,
  ): Promise<void> {
    const fallbackProviders = Object.entries(
      config.models?.providers ?? {},
    ).map(([providerId, provider]) => ({
      id: providerId,
      providerId,
      displayName: providerId,
      enabled: true,
      baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : null,
      authMode: "apiKey" as const,
      apiKey: typeof provider.apiKey === "string" ? provider.apiKey : null,
      oauthRegion: null,
      oauthCredential: null,
      models: (provider.models ?? []).map((model) => model.id),
      createdAt: "",
      updatedAt: "",
    }));

    const profileEntries = buildProfileEntries(providerSource);

    const effectiveEntries =
      profileEntries.length > 0
        ? profileEntries
        : fallbackProviders.flatMap((provider): AuthProfileEntry[] => {
            if (
              typeof provider.apiKey === "string" &&
              provider.apiKey.length > 0
            ) {
              return [
                [
                  `${provider.providerId}:default`,
                  {
                    type: "api_key",
                    provider: provider.providerId,
                    key: provider.apiKey,
                  },
                ],
              ];
            }

            return [];
          });

    const profiles = Object.fromEntries(effectiveEntries) as Record<
      string,
      AuthProfileRecord
    >;
    await Promise.all(
      (config.agents?.list ?? []).map(async (agent) => {
        if (
          typeof agent.workspace !== "string" ||
          agent.workspace.length === 0
        ) {
          return;
        }

        const authProfilesPath =
          this.authProfilesStore.authProfilesPathForWorkspace(agent.workspace);
        const preservedKeys: string[] = [];

        await this.authProfilesStore.updateAuthProfiles(
          authProfilesPath,
          async (existing) => {
            const preservedProfiles: Record<string, unknown> = {};
            for (const [key, profile] of Object.entries(existing.profiles)) {
              if (!isApiKeyProfile(profile)) {
                preservedProfiles[key] = profile;
                preservedKeys.push(key);
              }
            }

            return {
              ...existing,
              profiles: {
                ...preservedProfiles,
                ...profiles,
              },
            } satisfies AuthProfilesData;
          },
        );

        if (preservedKeys.length > 0) {
          logger.debug(
            {
              agent: agent.workspace,
              preservedKeys,
            },
            "Preserved non-api_key auth profiles during config sync",
          );
        }
      }),
    );
  }
}

function buildProfileEntries(
  providerSource:
    | ControllerProvider[]
    | PersistedModelsConfig["providers"]
    | undefined,
): AuthProfileEntry[] {
  if (!providerSource) {
    return [];
  }

  if (Array.isArray(providerSource)) {
    return providerSource.flatMap((provider): AuthProfileEntry[] => {
      if (!provider.enabled) {
        return [];
      }

      if (
        provider.authMode === "oauth" &&
        provider.oauthCredential !== null &&
        provider.oauthCredential.access.length > 0
      ) {
        return [
          [
            `${provider.oauthCredential.provider}:${provider.oauthCredential.email ?? "default"}`,
            {
              type: "oauth",
              provider: provider.oauthCredential.provider,
              access: provider.oauthCredential.access,
              ...(provider.oauthCredential.refresh
                ? { refresh: provider.oauthCredential.refresh }
                : {}),
              ...(typeof provider.oauthCredential.expires === "number"
                ? { expires: provider.oauthCredential.expires }
                : {}),
              ...(provider.oauthCredential.email
                ? { email: provider.oauthCredential.email }
                : {}),
            },
          ],
          [
            `${provider.providerId}:default`,
            {
              type: "api_key",
              provider: provider.providerId,
              key: provider.oauthCredential.access,
            },
          ],
        ];
      }

      if (typeof provider.apiKey === "string" && provider.apiKey.length > 0) {
        return [
          [
            `${provider.providerId}:default`,
            {
              type: "api_key",
              provider: provider.providerId,
              key: provider.apiKey,
            },
          ],
        ];
      }

      return [];
    });
  }

  const descriptors =
    listModelProviderRuntimeDescriptorsFromProviders(providerSource);
  return descriptors.flatMap((descriptor): AuthProfileEntry[] => {
    if (!descriptor.provider.enabled) {
      return [];
    }

    const accessToken = descriptor.legacyOauthCredential?.access;
    if (
      descriptor.provider.auth === "oauth" &&
      descriptor.legacyOauthCredential !== null &&
      accessToken
    ) {
      return [
        [
          `${descriptor.legacyOauthCredential.provider}:${descriptor.legacyOauthCredential.email ?? "default"}`,
          {
            type: "oauth",
            provider: descriptor.legacyOauthCredential.provider,
            access: accessToken,
            ...(descriptor.legacyOauthCredential.refresh
              ? { refresh: descriptor.legacyOauthCredential.refresh }
              : {}),
            ...(typeof descriptor.legacyOauthCredential.expires === "number"
              ? { expires: descriptor.legacyOauthCredential.expires }
              : {}),
            ...(descriptor.legacyOauthCredential.email
              ? { email: descriptor.legacyOauthCredential.email }
              : {}),
          },
        ],
        [
          `${descriptor.authProfileProviderId}:default`,
          {
            type: "api_key",
            provider: descriptor.authProfileProviderId,
            key: accessToken,
          },
        ],
      ];
    }

    if (
      typeof descriptor.provider.apiKey === "string" &&
      descriptor.provider.apiKey.length > 0
    ) {
      return [
        [
          `${descriptor.authProfileProviderId}:default`,
          {
            type: "api_key",
            provider: descriptor.authProfileProviderId,
            key: descriptor.provider.apiKey,
          },
        ],
      ];
    }

    return [];
  });
}
