import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import { compileOpenClawConfig } from "#controller/lib/openclaw-config-compiler";
import { CreditGuardStateWriter } from "#controller/runtime/credit-guard-state-writer";
import { OpenClawAuthProfilesStore } from "#controller/runtime/openclaw-auth-profiles-store";
import { OpenClawAuthProfilesWriter } from "#controller/runtime/openclaw-auth-profiles-writer";
import { OpenClawConfigWriter } from "#controller/runtime/openclaw-config-writer";
import { OpenClawRuntimeModelWriter } from "#controller/runtime/openclaw-runtime-model-writer";
import { OpenClawRuntimePluginWriter } from "#controller/runtime/openclaw-runtime-plugin-writer";
import { OpenClawWatchTrigger } from "#controller/runtime/openclaw-watch-trigger";
import { WorkspaceTemplateWriter } from "#controller/runtime/workspace-template-writer";
import { OpenClawGatewayService } from "#controller/services/openclaw-gateway-service";
import { OpenClawSyncService } from "#controller/services/openclaw-sync-service";
import { CompiledOpenClawStore } from "#controller/store/compiled-openclaw-store";
import { NexuConfigStore } from "#controller/store/nexu-config-store";
import type { NexuConfig } from "#controller/store/schemas";

function createEnv(rootDir = "/tmp/nexu-runtime-stability"): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
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
    userSkillsDir: path.join(rootDir, ".agents", "skills"),
    openclawBuiltinExtensionsDir: null,
    openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
    bundledRuntimePluginsDir: path.join(rootDir, "bundled-runtime-plugins"),
    runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
    openclawCuratedSkillsDir: path.join(rootDir, ".openclaw", "bundled-skills"),
    openclawRuntimeModelStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-runtime-model.json",
    ),
    creditGuardStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-credit-guard-state.json",
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

function createConfig(): NexuConfig {
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
      gateway: { port: 18789, bind: "loopback", authMode: "token" },
      defaultModelId: "anthropic/claude-sonnet-4",
    },
    models: { mode: "merge", providers: {} },
    providers: [
      {
        id: "provider-1",
        providerId: "anthropic",
        displayName: "Anthropic",
        enabled: true,
        baseUrl: null,
        apiKey: "anthropic-key",
        models: ["claude-sonnet-4"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "provider-2",
        providerId: "openai",
        displayName: "OpenAI",
        enabled: true,
        baseUrl: null,
        apiKey: "openai-key",
        models: ["gpt-4o"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    integrations: [],
    channels: [],
    templates: {},
    skills: {
      version: 1,
      defaults: { enabled: true, source: "inline" },
      items: {},
    },
    desktop: {},
    secrets: {},
  } as NexuConfig;
}

describe("runtime stability regressions", () => {
  it("keeps plugins.allow deterministic across channel reorderings", () => {
    const now = new Date().toISOString();
    const channels = [
      {
        id: "wecom-channel-1",
        botId: "bot-1",
        channelType: "wecom",
        accountId: "default",
        status: "connected",
        teamName: null,
        appId: "wecom-bot-123",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "dingtalk-channel-1",
        botId: "bot-1",
        channelType: "dingtalk",
        accountId: "default",
        status: "connected",
        teamName: null,
        appId: "ding-app-123",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "qq-channel-1",
        botId: "bot-1",
        channelType: "qqbot",
        accountId: "default",
        status: "connected",
        teamName: null,
        appId: "qq-app-123",
        botUserId: null,
        createdAt: now,
        updatedAt: now,
      },
    ] satisfies NexuConfig["channels"];

    const secrets = {
      "channel:wecom-channel-1:botId": "wecom-bot-123",
      "channel:wecom-channel-1:secret": "wecom-secret",
      "channel:dingtalk-channel-1:clientId": "ding-app-123",
      "channel:dingtalk-channel-1:clientSecret": "ding-secret",
      "channel:qq-channel-1:appId": "qq-app-123",
      "channel:qq-channel-1:clientSecret": "qq-secret",
    };

    const first = compileOpenClawConfig(
      { ...createConfig(), channels, secrets },
      createEnv(),
    );
    const second = compileOpenClawConfig(
      { ...createConfig(), channels: [...channels].reverse(), secrets },
      createEnv(),
    );

    expect(first.plugins?.allow).toEqual(second.plugins?.allow);
    expect(first.plugins?.allow).toEqual([
      ...[...(first.plugins?.allow ?? [])].sort(),
    ]);
    expect(first.plugins?.allow).toEqual(
      expect.arrayContaining([
        "dingtalk-connector",
        "nexu-credit-guard",
        "nexu-platform-bootstrap",
        "nexu-runtime-model",
        "openclaw-qqbot",
        "wecom",
      ]),
    );
  });

  it("preserves explicit BYOK model selections when the provider has no allowlist", async () => {
    const rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-runtime-stability-"),
    );
    const env = createEnv(rootDir);

    try {
      const config = createConfig();
      config.desktop = {
        ...config.desktop,
        selectedModelId: "anthropic/claude-opus-4-6",
      };
      config.runtime.defaultModelId = "anthropic/claude-opus-4-6";
      config.bots[0] = {
        ...config.bots[0],
        modelId: "anthropic/claude-opus-4-6",
      };
      config.providers = config.providers.map((provider) =>
        provider.providerId === "anthropic"
          ? { ...provider, models: [] }
          : provider,
      );

      await mkdir(path.dirname(env.nexuConfigPath), { recursive: true });
      await writeFile(env.nexuConfigPath, JSON.stringify(config, null, 2));

      const configStore = new NexuConfigStore(env);
      const compiledStore = new CompiledOpenClawStore(env);
      const authProfilesStore = new OpenClawAuthProfilesStore(env);
      const syncService = new OpenClawSyncService(
        env,
        configStore,
        compiledStore,
        new OpenClawConfigWriter(env),
        new OpenClawAuthProfilesWriter(authProfilesStore),
        authProfilesStore,
        new OpenClawRuntimePluginWriter(env),
        new OpenClawRuntimeModelWriter(env),
        new CreditGuardStateWriter(env),
        new WorkspaceTemplateWriter(env),
        new OpenClawWatchTrigger(env),
        new OpenClawGatewayService(
          {
            isConnected: () => false,
          } as never,
          {} as never,
        ),
      );

      await syncService.syncAllImmediate();

      const runtimeModel = JSON.parse(
        await readFile(env.openclawRuntimeModelStatePath, "utf8"),
      ) as { selectedModelRef: string };

      expect(runtimeModel.selectedModelRef).toBe("anthropic/claude-opus-4-6");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
