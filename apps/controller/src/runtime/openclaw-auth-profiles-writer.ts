import type { OpenClawConfig } from "@nexu/shared";
import { logger } from "../lib/logger.js";
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
    controllerProviders: ControllerProvider[] = [],
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

    const profileEntries: AuthProfileEntry[] = controllerProviders.flatMap(
      (provider): AuthProfileEntry[] => {
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
      },
    );

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
