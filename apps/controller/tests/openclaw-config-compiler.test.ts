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
    openclawWorkspaceTemplatesDir: "/tmp/openclaw/workspace-templates",
    openclawBin: "openclaw",
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    defaultModelId: "anthropic/claude-sonnet-4",
  };
}

function createConfig(): NexuConfig {
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
        modelId: "openai/gpt-4o",
        systemPrompt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
    providers: [],
    integrations: [],
    channels: [
      {
        id: "channel-1",
        botId: "bot-1",
        channelType: "slack",
        accountId: "team-1",
        status: "connected",
        teamName: "Acme",
        appId: "A123",
        botUserId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
    desktop: {},
    secrets: {},
  };
}

describe("compileOpenClawConfig", () => {
  it("builds OpenClaw config from controller config", () => {
    const result = compileOpenClawConfig(createConfig(), createEnv());

    expect(result.gateway.auth.mode).toBe("token");
    expect(result.gateway.auth.token).toBe("token-123");
    expect(result.agents.list).toHaveLength(1);
    expect(result.bindings).toEqual([
      {
        agentId: "bot-1",
        match: {
          channel: "slack",
          accountId: "team-1",
        },
      },
    ]);
  });
});
