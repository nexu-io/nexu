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
      openclawLaunchdLabel: null,
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

    expect(config.schemaVersion).toBe(1);
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

        return new Response(JSON.stringify(statusResponse), { status: 200 });
      }),
    );

    try {
      const status = await store.setDesktopRewardBalance(4200);
      expect(fetchCalls).toBe(2);
      expect(JSON.parse(capturedBody ?? "{}")).toEqual({
        targetBalance: 4200,
        idempotencyKey: expect.stringContaining("desktop-set-balance-"),
      });
      expect(status.cloudBalance?.totalBalance).toBe(4200);
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
                  isClaimed: false,
                  claimCount: 0,
                  lastClaimedAt: null,
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
                claimedCount: 0,
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
      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0]?.id).toBe("daily_checkin");
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
