import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import type { compileOpenClawConfig } from "../src/lib/openclaw-config-compiler.js";
import { OpenClawConfigWriter } from "../src/runtime/openclaw-config-writer.js";
import { OpenClawSkillsWriter } from "../src/runtime/openclaw-skills-writer.js";
import { OpenClawWatchTrigger } from "../src/runtime/openclaw-watch-trigger.js";
import { WorkspaceTemplateWriter } from "../src/runtime/workspace-template-writer.js";
import { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
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
      openclawWorkspaceTemplatesDir: path.join(
        rootDir,
        ".openclaw",
        "workspace-templates",
      ),
      openclawBin: "openclaw",
      openclawGatewayPort: 18789,
      openclawGatewayToken: undefined,
      manageOpenclawProcess: false,
      gatewayProbeEnabled: false,
      runtimeSyncIntervalMs: 2000,
      runtimeHealthIntervalMs: 5000,
      defaultModelId: "anthropic/claude-sonnet-4",
    };
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("writes compiled config, skills, and templates from controller state", async () => {
    const configStore = new NexuConfigStore(env);
    const compiledStore = new CompiledOpenClawStore(env);
    const syncService = new OpenClawSyncService(
      env,
      configStore,
      compiledStore,
      new OpenClawConfigWriter(env),
      new OpenClawSkillsWriter(env),
      new WorkspaceTemplateWriter(env),
      new OpenClawWatchTrigger(env),
    );

    await configStore.createBot({ name: "Assistant", slug: "assistant" });
    await configStore.connectSlack({
      botToken: "xoxb-test",
      signingSecret: "secret",
      teamId: "T123",
      appId: "A123",
      teamName: "Acme",
    });
    await configStore.upsertSkill({
      name: "daily-standup",
      content: "# Standup",
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

    const skillFile = await readFile(
      path.join(env.openclawSkillsDir, "daily-standup", "SKILL.md"),
      "utf8",
    );
    expect(skillFile).toContain("# Standup");

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
});
