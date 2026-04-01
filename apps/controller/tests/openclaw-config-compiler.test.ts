import { describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import {
  type OAuthConnectionState,
  compileOpenClawConfig,
} from "../src/lib/openclaw-config-compiler.js";
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
      {
        id: "feishu-channel-1",
        botId: "bot-1",
        channelType: "feishu",
        accountId: "cli_a1b2c3",
        status: "connected",
        teamName: null,
        appId: "cli_a1b2c3",
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
      "channel:feishu-channel-1:appId": "cli_a1b2c3",
      "channel:feishu-channel-1:appSecret": "feishu-secret",
      "channel:feishu-channel-1:connectionMode": "webhook",
      "channel:feishu-channel-1:verificationToken": "verify-token",
    },
    ...overrides,
  } as unknown as NexuConfig;
}

describe("compileOpenClawConfig", () => {
  it("builds OpenClaw config with provider and channel parity defaults", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());

    expect(result.gateway.auth.mode).toBe("token");
    expect(result.gateway.auth.token).toBe("token-123");
    expect(result.agents.defaults?.model).toEqual({
      primary: "byok_anthropic/anthropic/claude-sonnet-4",
    });
    expect(result.agents.list[0]).toMatchObject({
      id: "bot-1",
      workspace: "/tmp/openclaw/agents/bot-1",
      model: { primary: "byok_anthropic/anthropic/claude-sonnet-4" },
    });
    expect(result.models?.providers.openai?.models[0]?.id).toBe("gpt-4o");
    expect(result.models?.providers.byok_anthropic?.models[0]?.id).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(result.models?.providers.link?.baseUrl).toBe(
      "https://link.example.com/v1",
    );
    expect(result.channels.slack?.accounts["slack-A123-T123"]).toMatchObject({
      mode: "http",
      webhookPath: "/slack/events/slack-A123-T123",
      botToken: "xoxb-test",
    });
    expect(result.channels.feishu?.accounts.cli_a1b2c3).toMatchObject({
      connectionMode: "webhook",
      webhookPath: "/feishu/events/cli_a1b2c3",
      verificationToken: "verify-token",
    });
    expect(result.plugins?.entries?.feishu?.enabled).toBe(true);
    expect(result.skills?.load?.extraDirs).toEqual([
      "/tmp/openclaw/skills",
      "/tmp/.agents/skills",
    ]);
  });

  it("injects env-backed litellm routing for bare local model ids", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [],
        desktop: {},
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "anthropic/claude-sonnet-4",
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
      }),
      createEnv({
        litellmBaseUrl: "https://litellm.powerformer.net",
        litellmApiKey: "litellm-key",
      }),
    );

    expect(result.models?.providers.litellm?.baseUrl).toBe(
      "https://litellm.powerformer.net",
    );
    expect(result.models?.providers.litellm?.models[0]?.id).toBe(
      "anthropic/claude-sonnet-4",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "litellm/anthropic/claude-sonnet-4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "litellm/anthropic/claude-sonnet-4",
    });
  });

  it("does not remap openai models to OAuth providers without persisted OAuth state", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "openai/gpt-5.4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "openai/gpt-5.4",
        },
        providers: [
          {
            ...createConfig().providers[0],
            apiKey: null,
            models: ["gpt-5.4"],
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai/gpt-5.4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "openai/gpt-5.4",
    });
  });

  it("uses SiliconFlow's cn API base URL by default", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow",
            providerId: "siliconflow",
            displayName: "SiliconFlow",
            enabled: true,
            authMode: "apiKey",
            baseUrl: null,
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats the explicit SiliconFlow .cn URL as a direct official endpoint", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow-cn",
            providerId: "siliconflow",
            displayName: "SiliconFlow",
            enabled: true,
            authMode: "apiKey",
            baseUrl: "https://api.siliconflow.cn/v1",
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.cn/v1",
    );
    expect(result.models?.providers.byok_siliconflow).toBeUndefined();
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats the legacy SiliconFlow .com URL as a direct default endpoint", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow-legacy",
            providerId: "siliconflow",
            displayName: "SiliconFlow",
            enabled: true,
            authMode: "apiKey",
            baseUrl: "https://api.siliconflow.com/v1",
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.siliconflow?.baseUrl).toBe(
      "https://api.siliconflow.com/v1",
    );
    expect(result.models?.providers.byok_siliconflow).toBeUndefined();
    expect(result.models?.providers.siliconflow?.models[0]?.id).toBe(
      "Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("treats custom SiliconFlow gateway URLs as proxied endpoints", () => {
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "byok_siliconflow/siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId:
            "byok_siliconflow/siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
        },
        providers: [
          {
            id: "provider-siliconflow-proxy",
            providerId: "siliconflow",
            displayName: "SiliconFlow Proxy",
            enabled: true,
            authMode: "apiKey",
            baseUrl: "https://models.example.com/v1",
            apiKey: "sk-test",
            oauthRegion: null,
            oauthCredential: null,
            models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.byok_siliconflow?.baseUrl).toBe(
      "https://models.example.com/v1",
    );
    expect(result.models?.providers.siliconflow).toBeUndefined();
    expect(result.models?.providers.byok_siliconflow?.models[0]?.id).toBe(
      "siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    );
    expect(result.agents.defaults?.model).toEqual({
      primary: "byok_siliconflow/siliconflow/Pro/MiniMaxAI/MiniMax-M2.5",
    });
  });

  it("ignores unsupported custom providers in compiled model config", () => {
    const result = compileOpenClawConfig(
      createConfig({
        providers: [
          ...createConfig().providers,
          {
            ...createConfig().providers[0],
            id: "provider-3",
            providerId: "custom",
            displayName: "Custom",
            baseUrl: "https://models.example.com/v1",
            apiKey: "custom-key",
            models: ["anthropic/claude-sonnet-4"],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      createEnv(),
    );

    expect(Object.keys(result.models?.providers ?? {})).not.toContain("custom");
    expect(
      Object.keys(result.models?.providers ?? {}).some((key) =>
        key.startsWith("custom_"),
      ),
    ).toBe(false);
  });

  it("uses the CN MiniMax endpoint for CN OAuth providers", () => {
    const now = new Date().toISOString();
    const result = compileOpenClawConfig(
      createConfig({
        providers: [
          {
            id: "provider-minimax-cn",
            providerId: "minimax",
            displayName: "MiniMax",
            enabled: true,
            baseUrl: null,
            authMode: "oauth",
            apiKey: null,
            oauthRegion: "cn",
            oauthCredential: {
              provider: "minimax-portal",
              access: "access-token",
              refresh: "refresh-token",
              expires: Date.now() + 60_000,
            },
            models: ["MiniMax-M2.7"],
            createdAt: now,
            updatedAt: now,
          },
        ],
        desktop: {},
      }),
      createEnv(),
    );

    expect(result.models?.providers.minimax?.baseUrl).toBe(
      "https://api.minimaxi.com/anthropic",
    );
  });

  describe("agent skill assignment", () => {
    it("includes skills on agents when installedSlugs is provided", () => {
      const config = createConfig();
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env, undefined, [
        "git",
        "npm",
      ]);
      expect(compiled.agents.list[0].skills).toEqual(["git", "npm"]);
    });

    it("omits skills field when installedSlugs is empty (legacy fallback)", () => {
      const config = createConfig();
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env, undefined, []);
      expect(compiled.agents.list[0]).not.toHaveProperty("skills");
    });

    it("omits skills field when installedSlugs is undefined", () => {
      const config = createConfig();
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env);
      expect(compiled.agents.list[0]).not.toHaveProperty("skills");
    });

    it("assigns same skills to all active agents", () => {
      const now = new Date().toISOString();
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
      const env = createEnv();
      const compiled = compileOpenClawConfig(config, env, undefined, [
        "calendar",
      ]);
      expect(compiled.agents.list).toHaveLength(2);
      expect(compiled.agents.list[0].skills).toEqual(["calendar"]);
      expect(compiled.agents.list[1].skills).toEqual(["calendar"]);
    });
  });

  describe("per-agent workspace skill merge", () => {
    it("merges shared and workspace skills for each agent", () => {
      const now = new Date().toISOString();
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
      const wsMap = new Map<string, readonly string[]>([
        ["bot-1", ["agent-tool"]],
      ]);
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        ["shared-skill"],
        wsMap,
      );

      const botA = compiled.agents.list.find((a) => a.id === "bot-1");
      expect(botA?.skills).toEqual(
        expect.arrayContaining(["shared-skill", "agent-tool"]),
      );
      expect(botA?.skills).toHaveLength(2);

      const botB = compiled.agents.list.find((a) => a.id === "bot-2");
      expect(botB?.skills).toEqual(["shared-skill"]);
    });

    it("deduplicates when same slug in shared and workspace", () => {
      const config = createConfig();
      const wsMap = new Map<string, readonly string[]>([
        ["bot-1", ["shared-skill"]],
      ]);
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        ["shared-skill"],
        wsMap,
      );
      const agent = compiled.agents.list[0];
      expect(agent.skills).toEqual(["shared-skill"]);
    });

    it("workspace-only skills still activate allowlist", () => {
      const config = createConfig();
      const wsMap = new Map<string, readonly string[]>([
        ["bot-1", ["ws-only"]],
      ]);
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        [],
        wsMap,
      );
      expect(compiled.agents.list[0].skills).toEqual(["ws-only"]);
    });

    it("omits skills when both shared and workspace are empty", () => {
      const config = createConfig();
      const wsMap = new Map<string, readonly string[]>();
      const compiled = compileOpenClawConfig(
        config,
        createEnv(),
        undefined,
        [],
        wsMap,
      );
      expect(compiled.agents.list[0]).not.toHaveProperty("skills");
    });
  });

  it("remaps openai models to OAuth provider ids when persisted OAuth state is connected", () => {
    const oauthState: OAuthConnectionState = {
      connectedProviderIds: ["openai"],
    };
    const result = compileOpenClawConfig(
      createConfig({
        bots: [
          {
            ...createConfig().bots[0],
            modelId: "openai/gpt-5.4",
          },
        ],
        runtime: {
          gateway: {
            port: 18789,
            bind: "loopback",
            authMode: "token",
          },
          defaultModelId: "openai/gpt-5.4",
        },
        providers: [
          {
            ...createConfig().providers[0],
            apiKey: null,
            models: ["gpt-5.4"],
          },
        ],
        desktop: {},
      }),
      createEnv(),
      oauthState,
    );

    expect(result.agents.defaults?.model).toEqual({
      primary: "openai-codex/gpt-5.4",
    });
    expect(result.agents.list[0]?.model).toEqual({
      primary: "openai-codex/gpt-5.4",
    });
  });
});
