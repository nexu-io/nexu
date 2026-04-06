import { selectPreferredModel } from "@nexu/shared";
import { describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import {
  compileOpenClawConfig,
  resolveModelId,
} from "#controller/lib/openclaw-config-compiler";
import type { NexuConfig } from "#controller/store/schemas";

function createEnv(): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: "/tmp/nexu-home",
    nexuConfigPath: "/tmp/nexu-home/config.json",
    artifactsIndexPath: "/tmp/nexu-home/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/nexu-home/compiled-openclaw.json",
    openclawStateDir: "/tmp/nexu-home/runtime/openclaw/state",
    openclawConfigPath: "/tmp/nexu-home/runtime/openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/nexu-home/runtime/openclaw/state/skills",
    userSkillsDir: "/tmp/.agents/skills",
    openclawExtensionsDir: "/tmp/nexu-home/runtime/openclaw/state/extensions",
    runtimePluginTemplatesDir: "/tmp/nexu-home/runtime-plugins",
    openclawRuntimeModelStatePath:
      "/tmp/nexu-home/runtime/openclaw/state/nexu-runtime-model.json",
    skillhubCacheDir: "/tmp/nexu-home/skillhub-cache",
    skillDbPath: "/tmp/nexu-home/skill-ledger.json",
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir:
      "/tmp/nexu-home/runtime/openclaw/state/workspace-templates",
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: true,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
  };
}

function createBaseConfig(): NexuConfig {
  return {
    $schema: "https://nexu.io/config.json",
    schemaVersion: 1,
    app: {},
    bots: [
      {
        id: "bot_1",
        name: "Bot One",
        slug: "bot-one",
        systemPrompt: null,
        modelId: "anthropic/claude-sonnet-4",
        status: "active",
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ],
    runtime: {
      gateway: {
        port: 18789,
        bind: "loopback",
        authMode: "none",
      },
      defaultModelId: "anthropic/claude-sonnet-4",
    },
    models: {
      mode: "merge",
      providers: {},
    },
    providers: [],
    integrations: [],
    channels: [],
    templates: {},
    desktop: {},
    secrets: {},
  };
}

describe("compileOpenClawConfig", () => {
  it("prewarms Feishu plugin and a disabled internal account before first connect", () => {
    const compiled = compileOpenClawConfig(createBaseConfig(), createEnv());

    expect(compiled.plugins?.entries?.feishu).toEqual({ enabled: true });
    expect(compiled.plugins?.entries?.["openclaw-weixin"]).toEqual({
      enabled: true,
    });
    expect(compiled.channels?.feishu?.enabled).toBe(true);
    expect(compiled.channels?.feishu?.accounts).toEqual({
      __nexu_internal_feishu_prewarm__: {
        enabled: false,
        appId: "nexu-feishu-prewarm",
        appSecret: "nexu-feishu-prewarm",
        connectionMode: "websocket",
      },
    });
    expect(compiled.bindings).toEqual([]);
  });

  it("uses the real Feishu account once connected and does not keep the prewarm account", () => {
    const config = createBaseConfig();
    config.channels = [
      {
        id: "channel_1",
        botId: "bot_1",
        channelType: "feishu",
        accountId: "cli_real_account",
        status: "connected",
        teamName: null,
        appId: "cli_app_id",
        botUserId: null,
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ];
    config.secrets = {
      "channel:channel_1:appId": "cli_app_id",
      "channel:channel_1:appSecret": "cli_app_secret",
      "channel:channel_1:connectionMode": "websocket",
    };

    const compiled = compileOpenClawConfig(config, createEnv());

    expect(compiled.plugins?.entries?.feishu).toEqual({ enabled: true });
    expect(compiled.channels?.feishu?.accounts).toEqual({
      cli_real_account: {
        enabled: true,
        appId: "cli_app_id",
        appSecret: "cli_app_secret",
        connectionMode: "websocket",
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: ["*"],
      },
    });
    expect(compiled.bindings).toEqual([
      {
        agentId: "bot_1",
        match: {
          channel: "feishu",
          accountId: "cli_real_account",
        },
      },
    ]);
  });

  it("keeps the real Feishu account disabled after disconnect and clears bindings", () => {
    const config = createBaseConfig();
    config.channels = [
      {
        id: "channel_1",
        botId: "bot_1",
        channelType: "feishu",
        accountId: "cli_real_account",
        status: "disconnected",
        teamName: null,
        appId: "cli_app_id",
        botUserId: null,
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ];
    config.secrets = {
      "channel:channel_1:appId": "cli_app_id",
      "channel:channel_1:appSecret": "cli_app_secret",
      "channel:channel_1:connectionMode": "websocket",
    };

    const compiled = compileOpenClawConfig(config, createEnv());

    expect(compiled.channels?.feishu?.accounts).toEqual({
      cli_real_account: {
        enabled: false,
        appId: "cli_app_id",
        appSecret: "cli_app_secret",
        connectionMode: "websocket",
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: ["*"],
      },
    });
    expect(compiled.bindings).toEqual([]);
  });

  it("keeps openclaw-weixin plugin entry stable when a wechat channel exists", () => {
    const config = createBaseConfig();
    config.channels = [
      {
        id: "channel_1",
        botId: "bot_1",
        channelType: "wechat",
        accountId: "wx_account_1",
        status: "connected",
        teamName: null,
        appId: null,
        botUserId: null,
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ];

    const compiled = compileOpenClawConfig(config, createEnv());

    expect(compiled.plugins?.entries?.["openclaw-weixin"]).toEqual({
      enabled: true,
    });
    expect(compiled.channels?.["openclaw-weixin"]).toEqual({
      enabled: true,
      accounts: {
        wx_account_1: {
          enabled: true,
        },
      },
    });
    expect(compiled.bindings).toEqual([
      {
        agentId: "bot_1",
        match: {
          channel: "openclaw-weixin",
          accountId: "wx_account_1",
        },
      },
    ]);
  });

  it("does not silently rewrite the default model to the first Link model", () => {
    const config = createBaseConfig();
    config.desktop = {
      cloud: {
        connected: true,
        polling: false,
        userName: null,
        userEmail: null,
        connectedAt: null,
        linkUrl: "https://nexu-link.powerformer.net",
        apiKey: "test-key",
        models: [
          {
            id: "gemini-3.1-pro-preview",
            name: "Gemini 3.1 Pro Preview",
          },
        ],
      },
    };

    const compiled = compileOpenClawConfig(config, createEnv());

    expect(compiled.agents?.defaults?.model?.primary).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(compiled.models?.providers?.link?.models).toHaveLength(1);
    expect(compiled.models?.providers?.link?.models[0]?.id).toBe(
      "gemini-3.1-pro-preview",
    );
    expect(compiled.models?.providers?.link?.models[0]?.name).toBe(
      "Gemini 3.1 Pro Preview",
    );
  });

  it("maps runtime model refs onto available Link inventory", () => {
    const config = createBaseConfig();
    config.desktop = {
      cloud: {
        connected: true,
        polling: false,
        userName: null,
        userEmail: null,
        connectedAt: null,
        linkUrl: "https://nexu-link.powerformer.net",
        apiKey: "test-key",
        models: [
          {
            id: "claude-sonnet-4",
            name: "claude-sonnet-4",
          },
        ],
      },
    };

    expect(
      resolveModelId(config, createEnv(), "anthropic/claude-sonnet-4"),
    ).toBe("link/claude-sonnet-4");
  });

  it("prefers an actually available runtime model when the default is unavailable", () => {
    const availableModels = [
      { id: "link/claude-sonnet-4-6", name: "claude-sonnet-4-6" },
      { id: "link/gemini-3.1-pro-preview", name: "gemini-3.1-pro-preview" },
    ];

    expect(selectPreferredModel(availableModels)?.id).toBe(
      "link/gemini-3.1-pro-preview",
    );
  });

  it("compiles ollama providers with the native ollama API", () => {
    const config = createBaseConfig();
    config.models = {
      mode: "merge",
      providers: {
        ollama: {
          enabled: true,
          displayName: "Ollama",
          baseUrl: "http://127.0.0.1:11434",
          auth: "api-key",
          api: "ollama",
          apiKey: "ollama-local",
          models: [
            {
              id: "qwen2.5-coder:7b",
              name: "qwen2.5-coder:7b",
              api: "ollama",
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 0,
              maxTokens: 0,
            },
          ],
        },
      },
    };
    config.providers = [
      {
        id: "provider_ollama",
        providerId: "ollama",
        displayName: "Ollama",
        enabled: true,
        baseUrl: "http://127.0.0.1:11434",
        authMode: "apiKey",
        apiKey: "ollama-local",
        oauthRegion: null,
        oauthCredential: null,
        models: ["qwen2.5-coder:7b"],
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ];

    const compiled = compileOpenClawConfig(config, createEnv());

    expect(compiled.models?.providers?.ollama).toEqual({
      baseUrl: "http://127.0.0.1:11434",
      apiKey: "ollama-local",
      api: "ollama",
      models: [
        expect.objectContaining({
          id: "qwen2.5-coder:7b",
          name: "qwen2.5-coder:7b",
        }),
      ],
    });
  });
});
