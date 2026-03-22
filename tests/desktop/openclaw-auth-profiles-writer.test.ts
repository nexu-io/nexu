import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import { OpenClawAuthProfilesWriter } from "#controller/runtime/openclaw-auth-profiles-writer";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `auth-profiles-writer-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createEnv(homeDir: string): ControllerEnv {
  const openclawStateDir = resolve(homeDir, "runtime", "openclaw", "state");
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: homeDir,
    nexuConfigPath: resolve(homeDir, "config.json"),
    artifactsIndexPath: resolve(homeDir, "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: resolve(homeDir, "compiled-openclaw.json"),
    openclawStateDir,
    openclawConfigPath: resolve(openclawStateDir, "openclaw.json"),
    openclawSkillsDir: resolve(openclawStateDir, "skills"),
    openclawExtensionsDir: resolve(openclawStateDir, "extensions"),
    runtimePluginTemplatesDir: resolve(
      "/Users/elian/Documents/refly/nexu",
      "apps/controller/static/runtime-plugins",
    ),
    openclawCuratedSkillsDir: resolve(openclawStateDir, "bundled-skills"),
    openclawRuntimeModelStatePath: resolve(
      openclawStateDir,
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: resolve(homeDir, "skillhub-cache"),
    skillDbPath: resolve(homeDir, "skill-ledger.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: resolve(
      openclawStateDir,
      "workspace-templates",
    ),
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

describe("OpenClawAuthProfilesWriter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes provider api keys into each agent auth-profiles store", async () => {
    const env = createEnv(tempDir);
    const writer = new OpenClawAuthProfilesWriter(env);

    await writer.writeForAgents({
      agents: {
        list: [
          {
            id: "bot_1",
            name: "Bot One",
            workspace: resolve(env.openclawStateDir, "agents", "bot_1"),
          },
        ],
      },
      models: {
        mode: "merge",
        providers: {
          custom_abc: {
            baseUrl: "https://litellm.example.com",
            apiKey: "test-api-key",
            api: "openai-completions",
            models: [{ id: "openai/gpt-4.1", name: "openai/gpt-4.1" }],
          },
          anthropic: {
            baseUrl: "https://api.anthropic.com",
            apiKey: "anthropic-key",
            api: "anthropic-messages",
            models: [{ id: "claude-sonnet-4", name: "claude-sonnet-4" }],
          },
        },
      },
    } as never);

    const authProfilesPath = resolve(
      env.openclawStateDir,
      "agents",
      "bot_1",
      "agent",
      "auth-profiles.json",
    );
    const parsed = JSON.parse(readFileSync(authProfilesPath, "utf8")) as {
      version: number;
      profiles: Record<string, { type: string; provider: string; key: string }>;
    };

    expect(parsed.version).toBe(1);
    expect(parsed.profiles["custom_abc:default"]).toEqual({
      type: "api_key",
      provider: "custom_abc",
      key: "test-api-key",
    });
    expect(parsed.profiles["anthropic:default"]).toEqual({
      type: "api_key",
      provider: "anthropic",
      key: "anthropic-key",
    });
  });
});
