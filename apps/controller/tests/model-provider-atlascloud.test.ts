import { describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { compileOpenClawConfig } from "../src/lib/openclaw-config-compiler.js";
import type { NexuConfig } from "../src/store/schemas.js";

function createEnv(): ControllerEnv {
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
    defaultModelId: "atlascloud/qwen/qwen3.5-flash",
  } as unknown as ControllerEnv;
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
        modelId: "atlascloud/qwen/qwen3.5-flash",
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
      defaultModelId: "atlascloud/qwen/qwen3.5-flash",
    },
    models: {
      mode: "merge",
      providers: {
        atlascloud: {
          enabled: true,
          displayName: "Atlas Cloud",
          baseUrl: "https://api.atlascloud.ai/v1",
          auth: "api-key",
          api: "openai-completions",
          apiKey: "atlas-test-key",
          models: [],
        },
      },
    },
    providers: [],
    integrations: [],
    channels: [],
    templates: {},
    skills: {
      version: 1,
      defaults: {
        enabled: true,
        source: "inline",
      },
      items: {},
    },
    desktop: {},
    secrets: {},
  } as unknown as NexuConfig;
}

describe("Atlas Cloud model provider", () => {
  it("compiles a BYOK provider with bundled OpenAI-compatible models", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());

    expect(result.agents.defaults?.model).toEqual({
      primary: "atlascloud/qwen/qwen3.5-flash",
    });
    expect(result.models?.providers.atlascloud).toMatchObject({
      baseUrl: "https://api.atlascloud.ai/v1",
      apiKey: "atlas-test-key",
      api: "openai-completions",
    });
    expect(result.models?.providers.atlascloud?.models).toEqual([
      expect.objectContaining({
        id: "qwen/qwen3.5-flash",
        name: "Qwen3.5 Flash",
      }),
      expect.objectContaining({
        id: "deepseek-ai/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
      }),
    ]);
  });
});
