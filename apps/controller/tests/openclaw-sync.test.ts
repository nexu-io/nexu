import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { compileOpenClawConfig } from "../src/lib/openclaw-config-compiler.js";
import { OpenClawAuthProfilesStore } from "../src/runtime/openclaw-auth-profiles-store.js";
import { OpenClawAuthProfilesWriter } from "../src/runtime/openclaw-auth-profiles-writer.js";
import { OpenClawConfigWriter } from "../src/runtime/openclaw-config-writer.js";
import { OpenClawRuntimeModelWriter } from "../src/runtime/openclaw-runtime-model-writer.js";
import { OpenClawRuntimePluginWriter } from "../src/runtime/openclaw-runtime-plugin-writer.js";
import { OpenClawWatchTrigger } from "../src/runtime/openclaw-watch-trigger.js";
import { WorkspaceTemplateWriter } from "../src/runtime/workspace-template-writer.js";
import { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";
import { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import { SkillDb } from "../src/services/skillhub/skill-db.js";
import { CompiledOpenClawStore } from "../src/store/compiled-openclaw-store.js";
import { NexuConfigStore } from "../src/store/nexu-config-store.js";

describe("OpenClawSyncService", () => {
  let rootDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-controller-sync-"));
    env = {
      nodeEnv: "test",
      port: 3010,
      host: "127.0.0.1",
      webUrl: "http://localhost:5173",
      nexuHomeDir: path.join(rootDir, ".nexu"),
      nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
      artifactsIndexPath: path.join(
        rootDir,
        ".nexu",
        "artifacts",
        "index.json",
      ),
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
      openclawCuratedSkillsDir: path.join(
        rootDir,
        ".openclaw",
        "bundled-skills",
      ),
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
      amplitudeApiKey: undefined,
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("writes compiled config and templates from controller state", async () => {
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
      new WorkspaceTemplateWriter(env),
      new OpenClawWatchTrigger(env),
      new OpenClawGatewayService({
        isConnected: () => false,
        pushConfig: async () => false,
      } as never),
    );

    await configStore.createBot({ name: "Assistant", slug: "assistant" });
    await configStore.connectSlack({
      botToken: "xoxb-test",
      signingSecret: "secret",
      teamId: "T123",
      appId: "A123",
      teamName: "Acme",
    });
    const template = await configStore.upsertTemplate({
      name: "AGENTS.md",
      content: "hello",
    });

    await syncService.syncAll();

    const config = JSON.parse(
      await readFile(env.openclawConfigPath, "utf8"),
    ) as ReturnType<typeof compileOpenClawConfig>;
    expect(config.agents.list).toHaveLength(1);
    expect(config.channels.slack?.accounts["slack-A123-T123"]?.botToken).toBe(
      "xoxb-test",
    );

    const templateFile = await readFile(
      path.join(env.openclawWorkspaceTemplatesDir, `${template.id}.md`),
      "utf8",
    );
    expect(templateFile).toBe("hello");

    const snapshot = JSON.parse(
      await readFile(env.compiledOpenclawSnapshotPath, "utf8"),
    ) as { config: Record<string, unknown> };
    expect(snapshot.config).toBeTruthy();
  });

  it("includes installed skill slugs in compiled agent config", async () => {
    const configStore = new NexuConfigStore(env);
    const compiledStore = new CompiledOpenClawStore(env);
    const authProfilesStore = new OpenClawAuthProfilesStore(env);
    const skillDb = await SkillDb.create(env.skillDbPath);

    skillDb.recordInstall("web-search", "managed");
    skillDb.recordInstall("image-gen", "managed");

    const syncService = new OpenClawSyncService(
      env,
      configStore,
      compiledStore,
      new OpenClawConfigWriter(env),
      new OpenClawAuthProfilesWriter(authProfilesStore),
      authProfilesStore,
      new OpenClawRuntimePluginWriter(env),
      new OpenClawRuntimeModelWriter(env),
      new WorkspaceTemplateWriter(env),
      new OpenClawWatchTrigger(env),
      new OpenClawGatewayService({
        isConnected: () => false,
        pushConfig: async () => false,
      } as never),
      skillDb,
    );

    await configStore.createBot({ name: "Assistant", slug: "assistant" });
    await syncService.syncAllImmediate();

    const config = JSON.parse(
      await readFile(env.openclawConfigPath, "utf8"),
    ) as ReturnType<typeof compileOpenClawConfig>;

    expect(config.agents.list).toHaveLength(1);
    expect(config.agents.list[0].skills).toEqual(
      expect.arrayContaining(["web-search", "image-gen"]),
    );
    expect(config.agents.list[0].skills).toHaveLength(2);
  });
});
