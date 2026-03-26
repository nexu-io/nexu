import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "#controller/app/env";
import { ModelProviderService } from "#controller/services/model-provider-service";
import { NexuConfigStore } from "#controller/store/nexu-config-store";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `model-provider-test-${Date.now()}`);
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

function createService(store: NexuConfigStore, env: ControllerEnv) {
  return new ModelProviderService(
    store,
    env,
    {
      syncAll: async () => ({ configPushed: false }),
    } as never,
    {
      stop: async () => {},
      enableAutoRestart: () => {},
      start: () => {},
    } as never,
  );
}

describe("ModelProviderService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not auto-switch when model inventory is unknown", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);
    const service = createService(store, env);

    const result = await service.ensureValidDefaultModel();
    const config = await store.getConfig();

    expect(result.changed).toBe(false);
    expect(config.runtime.defaultModelId).toBe("anthropic/claude-sonnet-4");
  });

  it("reads cached cloud models without mutating config on read", async () => {
    const env = createEnv(tempDir);
    writeFileSync(
      env.nexuConfigPath,
      `${JSON.stringify(
        {
          $schema: "https://nexu.io/config.json",
          schemaVersion: 1,
          app: {},
          bots: [],
          runtime: {
            gateway: { port: 18789, bind: "loopback", authMode: "none" },
            defaultModelId: "anthropic/claude-sonnet-4",
          },
          providers: [],
          integrations: [],
          channels: [],
          templates: {},
          desktop: {
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
                  name: "gemini-3.1-pro-preview",
                },
              ],
            },
          },
          secrets: {},
        },
        null,
        2,
      )}\n`,
    );

    const store = new NexuConfigStore(env);
    const before = readFileSync(env.nexuConfigPath, "utf8");
    const service = createService(store, env);

    const models = await service.listModels();
    const cloudStatus = await store.getDesktopCloudStatus();
    const after = readFileSync(env.nexuConfigPath, "utf8");

    expect(
      models.models.some((model) => model.id === "gemini-3.1-pro-preview"),
    ).toBe(true);
    expect(cloudStatus.models).toHaveLength(1);
    expect(after).toBe(before);
  });

  it("clears minimax oauth in-progress status once credentials are persisted", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);
    const service = createService(store, env);

    await store.setProviderOauthCredentials("minimax", {
      displayName: "MiniMax",
      enabled: true,
      baseUrl: "https://api.minimax.io/anthropic",
      models: ["MiniMax-M2.7"],
      oauthRegion: "global",
      oauthCredential: {
        provider: "minimax-portal",
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      },
    });

    (
      service as unknown as {
        miniMaxOauthState: {
          connected: boolean;
          inProgress: boolean;
          region: "global" | "cn" | null;
          error: string | null;
        };
      }
    ).miniMaxOauthState = {
      connected: false,
      inProgress: true,
      region: "global",
      error: null,
    };

    const status = await service.getMiniMaxOauthStatus();

    expect(status.connected).toBe(true);
    expect(status.inProgress).toBe(false);
  });

  it("normalizes minimax poll interval without over-scaling millisecond values", async () => {
    const env = createEnv(tempDir);
    const store = new NexuConfigStore(env);
    const service = createService(store, env);

    let capturedIntervalMs = 0;
    (
      service as unknown as {
        pollMiniMaxOAuthToken: (
          input: {
            region: "global" | "cn";
            userCode: string;
            verifier: string;
            expiresAt: number;
            intervalMs: number;
          },
          signal: AbortSignal,
        ) => Promise<{
          access: string;
          refresh?: string;
          expires?: number;
          resourceUrl?: string;
        }>;
      }
    ).pollMiniMaxOAuthToken = async (input) => {
      capturedIntervalMs = input.intervalMs;
      return {
        access: "access-token",
        refresh: "refresh-token",
        expires: 3600,
        resourceUrl: "https://api.minimax.io/anthropic",
      };
    };

    await (
      service as unknown as {
        finishMiniMaxOauthLogin: (
          auth: {
            user_code: string;
            verification_uri: string;
            expired_in: number;
            interval?: number;
            verifier: string;
          },
          region: "global" | "cn",
          abortController: AbortController,
        ) => Promise<void>;
      }
    ).finishMiniMaxOauthLogin(
      {
        user_code: "user-code",
        verification_uri: "https://example.com/verify",
        expired_in: 1800,
        interval: 2000,
        verifier: "verifier",
      },
      "global",
      new AbortController(),
    );

    expect(capturedIntervalMs).toBe(2000);
  });
});
