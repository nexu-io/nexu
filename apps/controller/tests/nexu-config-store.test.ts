import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { NexuConfigStore } from "../src/store/nexu-config-store.js";

describe("NexuConfigStore", () => {
  let rootDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-controller-"));
    env = {
      nodeEnv: "test",
      port: 3010,
      host: "127.0.0.1",
      webUrl: "http://localhost:5173",
      nexuHomeDir: path.join(rootDir, ".nexu"),
      nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
      artifactsIndexPath: path.join(
        rootDir,
        ".nexu",
        "artifacts",
        "index.json",
      ),
      compiledOpenclawSnapshotPath: path.join(
        rootDir,
        ".nexu",
        "compiled-openclaw.json",
      ),
      openclawStateDir: path.join(rootDir, ".openclaw"),
      openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
      openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
      userSkillsDir: path.join(rootDir, ".agents", "skills"),
      openclawBuiltinExtensionsDir: null,
      openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
      bundledRuntimePluginsDir: path.join(rootDir, "bundled-runtime-plugins"),
      runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
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
      openclawOwnershipMode: "external",
      openclawBaseUrl: "http://127.0.0.1:18789",
      openclawBin: "openclaw",
      openclawLogDir: path.join(rootDir, ".nexu", "logs", "openclaw"),
      openclawLaunchdLabel: null,
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
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("persists bot, channel, provider, and template state", async () => {
    const store = new NexuConfigStore(env);

    const bot = await store.createBot({ name: "Assistant", slug: "assistant" });
    const channel = await store.connectSlack({
      botToken: "xoxb-test",
      signingSecret: "secret",
      teamId: "T123",
      teamName: "Acme",
      appId: "A123",
    });
    const provider = await store.upsertProvider("openai", {
      apiKey: "sk-test",
      displayName: "OpenAI",
      modelsJson: JSON.stringify(["gpt-4o"]),
    });
    await store.upsertTemplate({ name: "AGENTS.md", content: "hello" });

    expect(bot.slug).toBe("assistant");
    expect(channel.accountId).toBe("slack-A123-T123");
    expect(provider.provider.hasApiKey).toBe(true);
    expect(await store.listTemplates()).toHaveLength(1);
    expect(await store.listProviders()).toHaveLength(1);
    expect(await store.listChannels()).toHaveLength(1);
  });

  it("persists qqbot channels with app secrets in the secret store", async () => {
    const store = new NexuConfigStore(env);

    const channel = await store.connectQqbot({
      appId: "123456",
      appSecret: "qq-secret",
    });

    expect(channel.channelType).toBe("qqbot");
    expect(channel.accountId).toBe("default");
    expect(channel.appId).toBe("123456");
    expect(await store.getSecret(`channel:${channel.id}:appId`)).toBe("123456");
    expect(await store.getSecret(`channel:${channel.id}:clientSecret`)).toBe(
      "qq-secret",
    );
  });

  it("persists wecom channels with bot secrets in the secret store", async () => {
    const store = new NexuConfigStore(env);

    const channel = await store.connectWecom({
      botId: "wecom-bot-123",
      secret: "wecom-secret",
    });

    expect(channel.channelType).toBe("wecom");
    expect(channel.accountId).toBe("default");
    expect(channel.appId).toBe("wecom-bot-123");
    expect(await store.getSecret(`channel:${channel.id}:botId`)).toBe(
      "wecom-bot-123",
    );
    expect(await store.getSecret(`channel:${channel.id}:secret`)).toBe(
      "wecom-secret",
    );
  });

  it("clears an existing provider API key when null is explicitly provided", async () => {
    const store = new NexuConfigStore(env);

    await store.upsertProvider("openai", {
      apiKey: "sk-test",
      displayName: "OpenAI",
      modelsJson: JSON.stringify(["gpt-5.4"]),
    });

    const result = await store.upsertProvider("openai", {
      apiKey: null,
      modelsJson: JSON.stringify(["gpt-5.4"]),
    });

    expect(result.provider.hasApiKey).toBe(false);
    expect(result.provider.apiKey).toBeNull();
  });

  it("writes provider changes into canonical config.models.providers only", async () => {
    const store = new NexuConfigStore(env);

    await store.upsertProvider("openai", {
      apiKey: "sk-test",
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      modelsJson: JSON.stringify(["gpt-5.4"]),
    });

    const config = await store.getConfig();

    expect(config.models.providers.openai).toMatchObject({
      enabled: true,
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      auth: "api-key",
      api: "openai-completions",
      apiKey: "sk-test",
    });
    expect(config.models.providers.openai?.models).toEqual([
      expect.objectContaining({
        id: "gpt-5.4",
        name: "gpt-5.4",
        api: "openai-completions",
      }),
    ]);
    expect(config).not.toHaveProperty("providers");
    expect(config.schemaVersion).toBe(2);
  });

  it("migrates legacy config.providers into canonical config.models.providers on read", async () => {
    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {},
          providers: [
            {
              id: "provider-openai",
              providerId: "openai",
              displayName: "OpenAI",
              enabled: true,
              baseUrl: "https://api.openai.com/v1",
              authMode: "apiKey",
              apiKey: "sk-test",
              oauthRegion: null,
              oauthCredential: null,
              models: ["gpt-4o"],
              createdAt: "2026-04-04T00:00:00.000Z",
              updatedAt: "2026-04-04T00:00:00.000Z",
            },
          ],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {},
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const config = await store.getConfig();

    expect(config.models.providers.openai).toMatchObject({
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      auth: "api-key",
      apiKey: "sk-test",
    });
    expect(config.models.providers.openai?.models).toEqual([
      expect.objectContaining({ id: "gpt-4o", name: "gpt-4o" }),
    ]);
    expect(config).not.toHaveProperty("providers");
    expect(config.schemaVersion).toBe(2);
  });

  it("derives legacy provider compatibility state from canonical config.models.providers", async () => {
    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {},
          models: {
            mode: "merge",
            providers: {
              openai: {
                enabled: true,
                displayName: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                auth: "api-key",
                api: "openai-completions",
                apiKey: "sk-test",
                models: [
                  {
                    id: "gpt-4o-mini",
                    name: "gpt-4o-mini",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    contextWindow: 128000,
                    maxTokens: 16384,
                  },
                ],
              },
            },
          },
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {},
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const providers = await store.listProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      providerId: "openai",
      displayName: "OpenAI",
      hasApiKey: true,
      modelsJson: JSON.stringify(["gpt-4o-mini"]),
    });
  });

  it("normalizes persisted saved model refs on read", async () => {
    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [
            {
              id: "bot-1",
              name: "Assistant",
              slug: "assistant",
              poolId: null,
              status: "active",
              modelId: "custom-openai__team%20gateway/openai/gpt-4.1",
              systemPrompt: null,
              createdAt: "2026-04-05T00:00:00.000Z",
              updatedAt: "2026-04-05T00:00:00.000Z",
            },
          ],
          runtime: {
            defaultModelId: "byok_openai/openai/gpt-4.1",
          },
          models: {
            mode: "merge",
            providers: {
              openai: {
                enabled: true,
                displayName: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                auth: "api-key",
                api: "openai-completions",
                apiKey: "sk-test",
                models: [
                  {
                    id: "openai/gpt-4.1",
                    name: "gpt-4.1",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    contextWindow: 128000,
                    maxTokens: 16384,
                  },
                ],
              },
              "custom-openai/team gateway": {
                providerTemplateId: "custom-openai",
                instanceId: "team gateway",
                enabled: true,
                displayName: "Team Gateway",
                baseUrl: "https://gateway.example.com/v1",
                auth: "api-key",
                api: "openai-completions",
                apiKey: "sk-custom",
                models: [
                  {
                    id: "openai/gpt-4.1",
                    name: "gpt-4.1",
                    api: "openai-completions",
                    reasoning: false,
                    input: ["text"],
                    cost: {
                      input: 0,
                      output: 0,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    contextWindow: 128000,
                    maxTokens: 16384,
                  },
                ],
              },
            },
          },
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {
            selectedModelId: "google/gemini-2.5-flash",
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const config = await store.getConfig();

    expect(config.runtime.defaultModelId).toBe("openai/gpt-4.1");
    expect(config.bots[0]?.modelId).toBe(
      "custom-openai/team gateway/openai/gpt-4.1",
    );
    expect(config.desktop.selectedModelId).toBe("google/gemini-2.5-flash");
    expect(config.models.providers.openai?.models[0]?.id).toBe("gpt-4.1");
    expect(
      config.models.providers["custom-openai/team gateway"]?.models[0]?.id,
    ).toBe("openai/gpt-4.1");
  });

  it("rewrites saved model refs to canonical form on save", async () => {
    const store = new NexuConfigStore(env);

    await store.setModelProviderConfigDocument({
      mode: "merge",
      providers: {
        google: {
          enabled: true,
          displayName: "Gemini",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          auth: "api-key",
          api: "openai-completions",
          apiKey: "gemini-key",
          models: [
            {
              id: "google/gemini-2.5-flash",
              name: "gemini-2.5-flash",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
        "custom-openai/team gateway": {
          providerTemplateId: "custom-openai",
          instanceId: "team gateway",
          enabled: true,
          displayName: "Team Gateway",
          baseUrl: "https://gateway.example.com/v1",
          auth: "api-key",
          api: "openai-completions",
          apiKey: "sk-custom",
          models: [
            {
              id: "custom-openai/team gateway/gpt-4.1",
              name: "gpt-4.1",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      },
    });
    await store.setDefaultModel("google/gemini-2.5-flash");
    const bot = await store.createBot({
      name: "Assistant",
      slug: "assistant",
      modelId: "custom-openai__team%20gateway/openai/gpt-4.1",
    });
    await store.updateBot(bot.id, {
      modelId: "byok_gemini/gemini/gemini-2.5-pro",
    });

    const config = await store.getConfig();

    expect(config.models.providers.google?.models[0]?.id).toBe(
      "gemini-2.5-flash",
    );
    expect(
      config.models.providers["custom-openai/team gateway"]?.models[0]?.id,
    ).toBe("gpt-4.1");
    expect(config.runtime.defaultModelId).toBe("google/gemini-2.5-flash");
    expect(config.bots[0]?.modelId).toBe("google/gemini-2.5-pro");
    expect(config).not.toHaveProperty("providers");
    expect(config.schemaVersion).toBe(2);
  });

  it("preserves slash-qualified model ids for custom anthropic providers", async () => {
    const store = new NexuConfigStore(env);

    await store.setModelProviderConfigDocument({
      mode: "merge",
      providers: {
        "custom-anthropic/team gateway": {
          providerTemplateId: "custom-anthropic",
          instanceId: "team gateway",
          enabled: true,
          displayName: "Team Gateway",
          baseUrl: "https://gateway.example.com/v1",
          auth: "api-key",
          api: "anthropic-messages",
          apiKey: "sk-custom",
          models: [
            {
              id: "anthropic/claude-haiku-4.5",
              name: "claude-haiku-4.5",
              api: "anthropic-messages",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
        },
      },
    });
    const bot = await store.createBot({
      name: "Assistant",
      slug: "assistant",
      modelId: "custom-anthropic__team%20gateway/anthropic/claude-haiku-4.5",
    });

    const config = await store.getConfig();

    expect(
      config.models.providers["custom-anthropic/team gateway"]?.models[0]?.id,
    ).toBe("anthropic/claude-haiku-4.5");
    expect(config.bots.find((item) => item.id === bot.id)?.modelId).toBe(
      "custom-anthropic/team gateway/anthropic/claude-haiku-4.5",
    );
  });

  it("recovers from a broken primary config using backup-compatible data", async () => {
    const brokenConfigPath = env.nexuConfigPath;
    const backupPath = `${brokenConfigPath}.bak`;

    await mkdir(path.dirname(brokenConfigPath), { recursive: true });
    await writeFile(brokenConfigPath, "{not-json", "utf8");
    await writeFile(
      backupPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          bots: [],
          runtime: {},
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {},
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);
    const config = await store.getConfig();

    expect(config.schemaVersion).toBe(2);
    expect(config.$schema).toBe("https://nexu.io/config.json");
  });

  it("imports cloud profiles and switches active profile while clearing cloud auth", async () => {
    const store = new NexuConfigStore(env);

    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {},
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {
            localProfile: {
              id: "user-1",
              email: "user@nexu.io",
              name: "Cloud User",
              image: null,
              plan: "pro",
              inviteAccepted: true,
              onboardingCompleted: true,
              authSource: "cloud",
            },
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-03-23T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "secret",
              models: [{ id: "m1", name: "Model 1" }],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    await store.setDesktopCloudProfiles([
      {
        name: "Local Dev",
        cloudUrl: "http://localhost:5173",
        linkUrl: "http://localhost:8080",
      },
    ]);

    const status = await store.switchDesktopCloudProfile("Local Dev");
    const config = await store.getConfig();

    expect(status.activeProfileName).toBe("Local Dev");
    expect(status.cloudUrl).toBe("http://localhost:5173");
    expect(status.linkUrl).toBe("http://localhost:8080");
    expect(status.connected).toBe(false);
    expect(status.models).toEqual([]);
    expect(status.profiles.map((profile) => profile.name)).toEqual([
      "Default",
      "Local Dev",
    ]);
    expect(
      (config.desktop as { localProfile?: { authSource?: string } })
        .localProfile?.authSource,
    ).toBe("desktop-local");
    expect(
      (config.desktop as { activeCloudProfileName?: string })
        .activeCloudProfileName,
    ).toBe("Local Dev");
  });

  it("updates and deletes custom cloud profiles", async () => {
    const store = new NexuConfigStore(env);

    await store.setDesktopCloudProfiles([
      {
        name: "Local Dev",
        cloudUrl: "http://localhost:5173",
        linkUrl: "http://localhost:8080",
      },
    ]);

    const updated = await store.updateDesktopCloudProfile("Local Dev", {
      name: "Local QA",
      cloudUrl: "http://127.0.0.1:5173",
      linkUrl: "http://127.0.0.1:8080",
    });

    expect(updated.profiles.map((profile) => profile.name)).toEqual([
      "Default",
      "Local QA",
    ]);

    const deleted = await store.deleteDesktopCloudProfile("Local QA");
    expect(deleted.profiles.map((profile) => profile.name)).toEqual([
      "Default",
    ]);
    expect(deleted.activeProfileName).toBe("Default");
  });

  it("creates a custom cloud profile", async () => {
    const store = new NexuConfigStore(env);

    const created = await store.createDesktopCloudProfile({
      name: "Staging",
      cloudUrl: "https://nexu.powerformer.net",
      linkUrl: "https://nexu.powerformer.net",
    });

    expect(created.profiles.map((profile) => profile.name)).toEqual([
      "Default",
      "Staging",
    ]);
  });

  it("claimDesktopReward returns ok:false when cloud is not connected", async () => {
    const store = new NexuConfigStore(env);

    const result = await store.claimDesktopReward("daily_checkin");
    expect(result.ok).toBe(false);
    expect(result.alreadyClaimed).toBe(false);
  });

  it("setDesktopRewardBalance posts the requested balance and refreshes rewards status", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "valid-key",
              models: [],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    const statusResponse = {
      tasks: [],
      progress: { claimedCount: 0, totalCount: 0, earnedCredits: 0 },
      cloudBalance: {
        totalBalance: 4200,
        totalRecharged: 4200,
        totalConsumed: 0,
        syncedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    };

    const creditRecordsResponse = {
      appUserId: "user-1",
      grants: [
        {
          id: "grant-1",
          appUserId: "user-1",
          amount: 120,
          balance: 120,
          source: "signup_bonus",
          sourceId: null,
          description: null,
          expiresAt: "2099-04-01T00:00:00.000Z",
          enabled: true,
          idempotencyKey: "signup-1",
          metadata: {},
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      usageSummary: {
        totalEntries: 0,
        totalDueCredits: 0,
        totalChargedCredits: 0,
        totalCostUsd: "0",
      },
    };

    let fetchCalls = 0;
    let capturedBody: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          capturedBody = init?.body as string;
          return new Response(null, { status: 204 });
        }

        if (fetchCalls === 2) {
          return new Response(JSON.stringify(statusResponse), { status: 200 });
        }

        return new Response(JSON.stringify(creditRecordsResponse), {
          status: 200,
        });
      }),
    );

    try {
      const status = await store.setDesktopRewardBalance(4200);
      expect(fetchCalls).toBe(3);
      expect(JSON.parse(capturedBody ?? "{}")).toEqual({
        targetBalance: 4200,
        idempotencyKey: expect.stringContaining("desktop-set-balance-"),
      });
      expect(status.cloudBalance?.totalBalance).toBe(4200);
      expect(status.cloudBalance?.giftedBalance).toBe(120);
      expect(status.cloudBalance?.planBalance).toBe(4080);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("getDesktopRewardsStatus derives gifted balance from active credit grants", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "valid-key",
              models: [],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return new Response(
            JSON.stringify({
              tasks: [],
              progress: { claimedCount: 0, totalCount: 0, earnedCredits: 0 },
              cloudBalance: {
                totalBalance: 300,
                totalRecharged: 300,
                totalConsumed: 0,
                syncedAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-01T00:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            appUserId: "user-1",
            grants: [
              {
                id: "signup-grant",
                appUserId: "user-1",
                amount: 300,
                balance: 300,
                source: "signup_bonus",
                sourceId: null,
                description: "signup",
                expiresAt: "2099-04-01T00:00:00.000Z",
                enabled: true,
                idempotencyKey: "signup-1",
                metadata: {},
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-01T00:00:00.000Z",
              },
            ],
            usageSummary: {
              totalEntries: 0,
              totalDueCredits: 0,
              totalChargedCredits: 0,
              totalCostUsd: "0",
            },
          }),
          { status: 200 },
        );
      }),
    );

    try {
      const status = await store.getDesktopRewardsStatus();
      expect(status.cloudBalance?.totalBalance).toBe(300);
      expect(status.cloudBalance?.giftedBalance).toBe(300);
      expect(status.cloudBalance?.planBalance).toBe(0);
      expect(status.progress.earnedCredits).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to plan-only balance when credit records cannot be loaded", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "valid-key",
              models: [],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return new Response(
            JSON.stringify({
              tasks: [],
              progress: { claimedCount: 0, totalCount: 0, earnedCredits: 0 },
              cloudBalance: {
                totalBalance: 300,
                totalRecharged: 300,
                totalConsumed: 0,
                syncedAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-01T00:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ message: "Server Error" }), {
          status: 500,
        });
      }),
    );

    try {
      const status = await store.getDesktopRewardsStatus();
      expect(status.cloudBalance?.giftedBalance).toBe(0);
      expect(status.cloudBalance?.planBalance).toBe(300);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("getDesktopRewardsStatus preserves cloud balance when cloud returns unknown task ids", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          runtime: {
            defaultModelId: "gemini-3-flash-preview",
          },
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "http://localhost:8080",
              apiKey: "valid-key",
              models: [],
            },
            activeCloudProfileName: "Local",
            cloudSessions: {
              Local: {
                connected: true,
                polling: false,
                userName: "Cloud User",
                userEmail: "user@nexu.io",
                connectedAt: "2026-04-01T00:00:00.000Z",
                linkUrl: "http://localhost:8080",
                apiKey: "valid-key",
                models: [],
              },
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, ".nexu", "cloud-profiles.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          profiles: [
            {
              name: "Local",
              cloudUrl: "http://localhost:5173",
              linkUrl: "http://localhost:8080",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: "daily_checkin",
                  displayName: "Daily Check-in",
                  groupId: "daily",
                  rewardPoints: 100,
                  repeatMode: "daily",
                  shareMode: "link",
                  icon: "calendar",
                  url: null,
                  isClaimed: true,
                  claimCount: 1,
                  lastClaimedAt: "2026-04-08T00:00:00.000Z",
                },
                {
                  id: "xiaohongshu",
                  displayName: "Share on Xiaohongshu",
                  groupId: "social",
                  rewardPoints: 200,
                  repeatMode: "weekly",
                  shareMode: "image",
                  icon: "xiaohongshu",
                  url: null,
                  isClaimed: false,
                  claimCount: 0,
                  lastClaimedAt: null,
                },
              ],
              progress: {
                claimedCount: 1,
                totalCount: 2,
                earnedCredits: 0,
              },
              cloudBalance: {
                totalBalance: 1,
                totalRecharged: 1210,
                totalConsumed: 1209,
                syncedAt: "2026-04-07T09:36:51.342Z",
                updatedAt: "2026-04-07T09:36:51.342Z",
              },
            }),
            { status: 200 },
          ),
      ),
    );

    try {
      const status = await store.getDesktopRewardsStatus();
      expect(status.cloudBalance?.totalBalance).toBe(1);
      expect(status.cloudBalance?.giftedBalance).toBe(0);
      expect(status.cloudBalance?.planBalance).toBe(1);
      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0]?.id).toBe("daily_checkin");
      expect(status.progress.claimedCount).toBe(1);
      expect(status.progress.totalCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("getDesktopRewardsStatus returns empty fallback when cloud is not connected", async () => {
    const store = new NexuConfigStore(env);

    const status = await store.getDesktopRewardsStatus();
    expect(status.viewer.cloudConnected).toBe(false);
    expect(status.tasks).toHaveLength(0);
    expect(status.progress.earnedCredits).toBe(0);
    expect(status.cloudBalance).toBeNull();
  });

  it("treats link-prefixed default models as managed even before cloud inventory hydrates", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          runtime: {
            defaultModelId: "link/gemini-3-flash-preview",
          },
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              models: [],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    const status = await store.getDesktopRewardsStatus();
    expect(status.viewer.cloudConnected).toBe(true);
    expect(status.viewer.activeModelId).toBe("link/gemini-3-flash-preview");
    expect(status.viewer.usingManagedModel).toBe(true);
  });

  it("backfills missing desktop cloud userId from /api/v1/me during bootstrap", async () => {
    const store = new NexuConfigStore(env);

    await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
    await writeFile(
      env.nexuConfigPath,
      JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {},
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-03-23T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "secret-api-key",
              models: [{ id: "m1", name: "Model 1" }],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://nexu.io/api/v1/me");
      expect(init?.headers).toEqual({ Authorization: "Bearer secret-api-key" });
      return new Response(JSON.stringify({ id: "user-backfilled" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await store.prepareDesktopCloudModelsForBootstrap();

    const config = await store.getConfig();
    const desktop = config.desktop as {
      cloud?: {
        userId?: string | null;
        models?: Array<{ id: string; name: string }>;
      };
    };
    expect(desktop.cloud?.userId).toBe("user-backfilled");
    expect(desktop.cloud?.models).toEqual([{ id: "m1", name: "Model 1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("getDesktopRewardsStatus preserves connected state when cloud returns 401 auth_failed", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "expired-key",
              models: [],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
          }),
      ),
    );

    try {
      const status = await store.getDesktopRewardsStatus();
      expect(status.viewer.cloudConnected).toBe(true);
      expect(status.tasks).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("claimDesktopReward uses status from claim response without extra fetch", async () => {
    await mkdir(path.join(rootDir, ".nexu"), { recursive: true });

    const mockTask = {
      id: "daily_checkin",
      displayName: "Daily Check-in",
      groupId: "daily",
      rewardPoints: 100,
      repeatMode: "daily",
      shareMode: "link",
      icon: "calendar",
      url: null,
      isClaimed: true,
      claimCount: 1,
      lastClaimedAt: "2026-04-01T00:00:00.000Z",
    };

    const claimResponse = {
      ok: true,
      alreadyClaimed: false,
      status: {
        tasks: [mockTask],
        progress: { claimedCount: 1, totalCount: 1, earnedCredits: 100 },
        cloudBalance: null,
      },
    };

    await writeFile(
      path.join(rootDir, ".nexu", "config.json"),
      JSON.stringify(
        {
          version: 1,
          desktop: {
            cloud: {
              connected: true,
              polling: false,
              userName: "Cloud User",
              userEmail: "user@nexu.io",
              connectedAt: "2026-04-01T00:00:00.000Z",
              linkUrl: "https://link.nexu.io",
              apiKey: "valid-key",
              models: [],
            },
          },
          secrets: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    const store = new NexuConfigStore(env);

    let fetchCallCount = 0;
    let claimBody: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        fetchCallCount += 1;
        claimBody = init?.body ?? null;
        return new Response(JSON.stringify(claimResponse), { status: 200 });
      }),
    );

    try {
      const result = await store.claimDesktopReward("daily_checkin", {
        url: "https://x.com/nexu_io/status/1900000000000000000",
      });
      expect(result.ok).toBe(true);
      expect(result.alreadyClaimed).toBe(false);
      expect(result.status.tasks).toHaveLength(1);
      expect(result.status.tasks[0]?.isClaimed).toBe(true);
      expect(result.status.progress.claimedCount).toBe(1);
      // Only one fetch call for claim — no extra status fetch
      expect(fetchCallCount).toBe(1);
      expect(claimBody).toBe(
        JSON.stringify({
          taskId: "daily_checkin",
          proofUrl: "https://x.com/nexu_io/status/1900000000000000000",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
