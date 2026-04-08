import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import {
  type AuthProfilesData,
  OpenClawAuthProfilesStore,
} from "../src/runtime/openclaw-auth-profiles-store.js";

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
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
    openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
    runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
    openclawCuratedSkillsDir: path.join(rootDir, ".openclaw", "bundled-skills"),
    openclawRuntimeModelStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-runtime-model.json",
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

async function writeAgentAuthProfiles(
  env: ControllerEnv,
  agentId: string,
  content: string,
): Promise<string> {
  const filePath = path.join(
    env.openclawStateDir,
    "agents",
    agentId,
    "agent",
    "auth-profiles.json",
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function readAuthProfiles(filePath: string): Promise<AuthProfilesData> {
  return JSON.parse(await readFile(filePath, "utf8")) as AuthProfilesData;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("OpenClawAuthProfilesStore", () => {
  let rootDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-auth-profiles-store-"));
    env = createEnv(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("serializes overlapping updates for the same file", async () => {
    const store = new OpenClawAuthProfilesStore(env);
    const filePath = await writeAgentAuthProfiles(
      env,
      "bot-a",
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
    );
    const gate = deferred();

    const firstUpdate = store.updateAuthProfiles(filePath, async (current) => {
      await gate.promise;
      return {
        ...current,
        profiles: {
          ...current.profiles,
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "access",
            refresh: "refresh",
            expires: Date.now() + 60_000,
            accountId: "acct-1",
          },
        },
      };
    });
    const secondUpdate = store.updateAuthProfiles(filePath, async (current) => {
      return {
        ...current,
        profiles: {
          ...current.profiles,
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-ant",
          },
        },
      };
    });

    gate.resolve();
    await Promise.all([firstUpdate, secondUpdate]);

    await expect(readAuthProfiles(filePath)).resolves.toMatchObject({
      profiles: {
        "openai-codex:default": {
          provider: "openai-codex",
          type: "oauth",
        },
        "anthropic:default": {
          provider: "anthropic",
          type: "api_key",
          key: "sk-ant",
        },
      },
    });
  });

  it("initializes a missing file from an empty base state", async () => {
    const store = new OpenClawAuthProfilesStore(env);
    const filePath = path.join(
      env.openclawStateDir,
      "agents",
      "bot-a",
      "agent",
      "auth-profiles.json",
    );

    await store.updateAuthProfiles(filePath, async (current) => ({
      ...current,
      profiles: {
        ...current.profiles,
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-ant",
        },
      },
    }));

    await expect(readAuthProfiles(filePath)).resolves.toMatchObject({
      version: 1,
      profiles: {
        "anthropic:default": {
          provider: "anthropic",
          type: "api_key",
        },
      },
    });
  });

  it("rejects updates when an existing file cannot be parsed", async () => {
    const store = new OpenClawAuthProfilesStore(env);
    const filePath = await writeAgentAuthProfiles(env, "bot-a", "{not-json");

    await expect(
      store.updateAuthProfiles(filePath, async (current) => current),
    ).rejects.toThrow(/Failed to parse auth profiles/);
  });
});
