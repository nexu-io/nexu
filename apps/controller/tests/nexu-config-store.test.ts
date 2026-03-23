import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      nexuCloudUrl: "https://nexu.io",
      nexuLinkUrl: "https://link.nexu.io",
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
      openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
      runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
      openclawCuratedSkillsDir: path.join(
        rootDir,
        ".openclaw",
        "bundled-skills",
      ),
      openclawRuntimeModelStatePath: path.join(
        rootDir,
        ".openclaw",
        "nexu-runtime-model.json",
      ),
      skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
      skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
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
    };
  });

  afterEach(async () => {
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
});
