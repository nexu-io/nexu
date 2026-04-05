import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { compileOpenClawConfig } from "../src/lib/openclaw-config-compiler.js";
import { SkillDb } from "../src/services/skillhub/skill-db.js";
import type { NexuConfig } from "../src/store/schemas.js";

function createEnv(overrides: Record<string, unknown> = {}): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: "/tmp/nexu-test",
    nexuConfigPath: "/tmp/nexu-test/config.json",
    artifactsIndexPath: "/tmp/nexu-test/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/nexu-test/compiled-openclaw.json",
    openclawStateDir: "/tmp/openclaw",
    openclawConfigPath: "/tmp/openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/openclaw/skills",
    userSkillsDir: "/tmp/.agents/skills",
    openclawWorkspaceTemplatesDir: "/tmp/openclaw/workspace-templates",
    openclawBin: "openclaw",
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "link/gemini-3-flash-preview",
    ...overrides,
  } as unknown as ControllerEnv;
}

function createConfig(overrides: Partial<NexuConfig> = {}): NexuConfig {
  const now = new Date().toISOString();
  return {
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
        modelId: "anthropic/claude-sonnet-4",
        systemPrompt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    runtime: {
      gateway: {
        port: 18789,
        bind: "loopback",
        authMode: "token",
      },
      defaultModelId: "anthropic/claude-sonnet-4",
    },
    models: {
      mode: "merge",
      providers: {},
    },
    providers: [
      {
        id: "provider-1",
        providerId: "openai",
        displayName: "OpenAI",
        enabled: true,
        baseUrl: null,
        apiKey: "sk-test",
        models: ["gpt-4o"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "provider-2",
        providerId: "anthropic",
        displayName: "Anthropic Proxy",
        enabled: true,
        baseUrl: "https://proxy.example.com/v1",
        apiKey: "proxy-key",
        models: ["claude-sonnet-4"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    integrations: [],
    channels: [
      {
        id: "slack-channel-1",
        botId: "bot-1",
        channelType: "slack",
        accountId: "slack-A123-T123",
        status: "connected",
        teamName: "Acme",
        appId: "A123",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    templates: {},
    skills: {
      version: 1,
      defaults: {
        enabled: true,
        source: "inline",
      },
      items: {},
    },
    desktop: {
      selectedModelId: "gpt-4o",
      cloud: {
        linkUrl: "https://link.example.com",
        apiKey: "link-key",
        models: [
          {
            id: "gemini-2.5-flash",
            name: "Gemini 2.5 Flash",
            provider: "google",
          },
        ],
      },
    },
    secrets: {
      "channel:slack-channel-1:botToken": "xoxb-test",
      "channel:slack-channel-1:signingSecret": "signing-secret",
    },
    ...overrides,
  } as unknown as NexuConfig;
}

describe("skill install → config sync integration", () => {
  let tmpDir: string;
  let skillDb: SkillDb;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "skill-sync-"));
    const dbPath = path.join(tmpDir, "skill-ledger.json");
    skillDb = await SkillDb.create(dbPath);
  });

  afterEach(async () => {
    skillDb.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("new install adds skill to compiled agent config", () => {
    skillDb.recordInstall("taobao-native", "managed");

    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    expect(slugs).toEqual(["taobao-native"]);

    const compiled = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      slugs,
    );

    expect(compiled.agents.list[0].skills).toEqual(["taobao-native"]);
  });

  it("empty ledger omits skills field (legacy upgrade path)", () => {
    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    expect(slugs).toEqual([]);

    const compiled = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      slugs,
    );

    expect(compiled.agents.list[0]).not.toHaveProperty("skills");
  });

  it("uninstall removes skill from compiled agent config", () => {
    skillDb.recordInstall("taobao-native", "managed");
    skillDb.recordInstall("git-helper", "managed");
    skillDb.recordUninstall("git-helper", "managed");

    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    expect(slugs).toEqual(["taobao-native"]);

    const compiled = compileOpenClawConfig(
      createConfig(),
      createEnv(),
      undefined,
      slugs,
    );

    expect(compiled.agents.list[0].skills).toEqual(["taobao-native"]);
  });

  it("multiple agents all receive the same skills", () => {
    const now = new Date().toISOString();
    skillDb.recordInstall("calendar", "managed");

    const config = createConfig({
      bots: [
        {
          id: "bot-1",
          name: "Bot A",
          slug: "bot-a",
          poolId: null,
          status: "active",
          modelId: "anthropic/claude-sonnet-4",
          systemPrompt: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "bot-2",
          name: "Bot B",
          slug: "bot-b",
          poolId: null,
          status: "active",
          modelId: "anthropic/claude-sonnet-4",
          systemPrompt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const slugs = skillDb.getAllInstalled().map((r) => r.slug);
    const compiled = compileOpenClawConfig(
      config,
      createEnv(),
      undefined,
      slugs,
    );

    expect(compiled.agents.list).toHaveLength(2);
    for (const agent of compiled.agents.list) {
      expect(agent.skills).toEqual(["calendar"]);
    }
  });
});
