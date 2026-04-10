import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `nexu-config-analytics-test-${Date.now()}`);
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
    userSkillsDir: "/tmp/.agents/skills",
    openclawExtensionsDir: resolve(openclawStateDir, "extensions"),
    runtimePluginTemplatesDir: resolve(homeDir, "runtime-plugins"),
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
    analyticsStatePath: resolve(homeDir, "analytics-state.json"),
  };
}

describe("NexuConfigStore desktop analytics defaults", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists analytics enabled in the default config", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);

    const config = await store.getConfig();
    const rawConfig = JSON.parse(readFileSync(env.nexuConfigPath, "utf8")) as {
      desktop?: { analyticsEnabled?: boolean };
    };

    expect(config.desktop.analyticsEnabled).toBe(true);
    expect(rawConfig.desktop?.analyticsEnabled).toBe(true);
  });

  it("backfills analytics enabled when reading an older config without the key", async () => {
    const env = createEnv(tempDir);
    const legacyConfig = {
      $schema: "https://nexu.io/config.json",
      schemaVersion: 2,
      app: {},
      bots: [],
      runtime: {
        gateway: { port: 18789, bind: "loopback", authMode: "none" },
        defaultModelId: "anthropic/claude-sonnet-4",
      },
      models: {
        mode: "merge",
        providers: {},
      },
      integrations: [],
      channels: [],
      templates: {},
      desktop: {},
      secrets: {},
    };
    writeFileSync(
      env.nexuConfigPath,
      `${JSON.stringify(legacyConfig, null, 2)}\n`,
      "utf8",
    );

    const store = new NexuConfigStore(env);

    expect(await store.getDesktopAnalyticsEnabled()).toBe(true);

    const rawConfig = JSON.parse(readFileSync(env.nexuConfigPath, "utf8")) as {
      desktop?: { analyticsEnabled?: boolean };
    };
    expect(rawConfig.desktop?.analyticsEnabled).toBe(true);
  });
});
