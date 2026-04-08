import path from "node:path";
import type { PersistedModelsConfig } from "@nexu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";
import type { ControllerEnv } from "../src/app/env.js";
import { createRuntimeState } from "../src/runtime/state.js";

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: path.join(rootDir, ".nexu"),
    nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
    artifactsIndexPath: path.join(rootDir, ".nexu", "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      rootDir,
      ".nexu",
      "compiled-openclaw.json",
    ),
    openclawStateDir: path.join(rootDir, ".openclaw"),
    openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
    openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
    openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
    runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
    openclawCuratedSkillsDir: path.join(rootDir, ".openclaw", "bundled-skills"),
    openclawRuntimeModelStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
    skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
    analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      rootDir,
      ".openclaw",
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
    posthogApiKey: undefined,
    posthogHost: undefined,
  };
}

function createTestContainer(rootDir: string): ControllerContainer {
  const env = createEnv(rootDir);
  let config: PersistedModelsConfig = {
    mode: "merge",
    providers: {
      openai: {
        enabled: true,
        displayName: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        auth: "api-key",
        api: "openai-responses",
        apiKey: "existing-api-key",
        models: [
          {
            id: "gpt-4.1",
            name: "gpt-4.1",
            api: "openai-responses",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 0,
            maxTokens: 0,
          },
        ],
      },
    },
  };
  const getModelProviderConfigDocument = vi.fn(async () => config);
  const setModelProviderConfigDocument = vi.fn(
    async (nextConfig: PersistedModelsConfig) => {
      config = nextConfig;
      return config;
    },
  );
  const syncAll = vi.fn(async () => {});

  return {
    env,
    configStore: {} as ControllerContainer["configStore"],
    gatewayClient: {} as ControllerContainer["gatewayClient"],
    runtimeHealth: {
      probe: vi.fn(async () => ({ ok: true })),
    } as unknown as ControllerContainer["runtimeHealth"],
    openclawProcess: {} as ControllerContainer["openclawProcess"],
    agentService: {} as ControllerContainer["agentService"],
    channelService: {} as ControllerContainer["channelService"],
    channelFallbackService: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["channelFallbackService"],
    sessionService: {} as ControllerContainer["sessionService"],
    runtimeConfigService: {} as ControllerContainer["runtimeConfigService"],
    runtimeModelStateService:
      {} as ControllerContainer["runtimeModelStateService"],
    modelProviderService: {
      getModelProviderConfigDocument,
      setModelProviderConfigDocument,
      ensureValidDefaultModel: vi.fn(async () => null),
    } as unknown as ControllerContainer["modelProviderService"],
    integrationService: {} as ControllerContainer["integrationService"],
    localUserService: {} as ControllerContainer["localUserService"],
    desktopLocalService: {} as ControllerContainer["desktopLocalService"],
    analyticsService: {} as ControllerContainer["analyticsService"],
    artifactService: {} as ControllerContainer["artifactService"],
    templateService: {} as ControllerContainer["templateService"],
    skillhubService: {
      catalog: {
        getCatalog: vi.fn(() => ({
          skills: [],
          installedSlugs: [],
          installedSkills: [],
          meta: null,
        })),
        installSkill: vi.fn(),
        uninstallSkill: vi.fn(),
        refreshCatalog: vi.fn(),
        importSkillZip: vi.fn(),
      },
      start: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["skillhubService"],
    openclawSyncService: {
      syncAll,
    } as unknown as ControllerContainer["openclawSyncService"],
    openclawAuthService: {
      startOAuthFlow: vi.fn(),
      getFlowStatus: vi.fn(() => ({ status: "completed" as const })),
      consumeCompleted: vi.fn(() => ({
        profile: {
          type: "oauth" as const,
          provider: "openai-codex",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          accountId: "acct_123",
        },
        models: [],
      })),
      getProviderOAuthStatus: vi.fn(),
      disconnectOAuth: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["openclawAuthService"],
    wsClient: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["wsClient"],
    gatewayService: {
      isConnected: vi.fn(() => false),
    } as unknown as ControllerContainer["gatewayService"],
    runtimeState: createRuntimeState(),
    startBackgroundLoops: () => () => {},
  };
}

describe("provider OAuth routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears an existing API key when OAuth completion is consumed", async () => {
    const container = createTestContainer("/tmp/nexu-provider-oauth-routes");
    const app = createApp(container);

    const response = await app.request(
      "/api/v1/model-providers/openai/oauth/status",
    );

    expect(response.status).toBe(200);
    expect(
      container.modelProviderService.setModelProviderConfigDocument,
    ).toHaveBeenCalledTimes(1);
    await expect(
      container.modelProviderService.getModelProviderConfigDocument(),
    ).resolves.toMatchObject({
      providers: {
        openai: {
          auth: "oauth",
          oauthProfileRef: "openai-codex",
          models: [{ id: "gpt-5.4" }],
        },
      },
    });
    await expect(
      container.modelProviderService.getModelProviderConfigDocument(),
    ).resolves.not.toMatchObject({
      providers: {
        openai: {
          apiKey: expect.anything(),
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      models: ["gpt-5.4"],
    });
  });

  it("disconnect removes provider models and syncs config", async () => {
    const container = createTestContainer("/tmp/nexu-provider-oauth-routes");
    (
      container.openclawAuthService.getProviderOAuthStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValueOnce({ connected: true });
    (
      container.openclawAuthService.disconnectOAuth as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(true);
    const app = createApp(container);

    const response = await app.request(
      "/api/v1/model-providers/openai/oauth/disconnect",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(
      container.modelProviderService.getModelProviderConfigDocument(),
    ).resolves.toMatchObject({ providers: {} });
    expect(
      container.modelProviderService.ensureValidDefaultModel,
    ).toHaveBeenCalledTimes(1);
  });

  it("disconnect does not delete provider when OAuth disconnect fails", async () => {
    const container = createTestContainer("/tmp/nexu-provider-oauth-routes");
    (
      container.openclawAuthService.getProviderOAuthStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValueOnce({ connected: true });
    (
      container.openclawAuthService.disconnectOAuth as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(false);
    const app = createApp(container);

    const response = await app.request(
      "/api/v1/model-providers/openai/oauth/disconnect",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(
      container.modelProviderService.setModelProviderConfigDocument,
    ).not.toHaveBeenCalled();
  });

  it("disconnect does not delete provider when no OAuth profile was connected", async () => {
    const container = createTestContainer("/tmp/nexu-provider-oauth-routes");
    (
      container.openclawAuthService.getProviderOAuthStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValueOnce({ connected: false });
    (
      container.openclawAuthService.disconnectOAuth as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(true);
    const app = createApp(container);

    const response = await app.request(
      "/api/v1/model-providers/openai/oauth/disconnect",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(
      container.modelProviderService.setModelProviderConfigDocument,
    ).not.toHaveBeenCalled();
    expect(
      container.modelProviderService.ensureValidDefaultModel,
    ).not.toHaveBeenCalled();
  });
});
