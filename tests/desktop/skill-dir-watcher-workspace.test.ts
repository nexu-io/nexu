import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillDb } from "#controller/services/skillhub/skill-db";
import { SkillDirWatcher } from "#controller/services/skillhub/skill-dir-watcher";

describe("SkillDirWatcher workspace reconciliation", () => {
  let tmpDir: string;
  let skillsDir: string;
  let stateDir: string;
  let db: SkillDb;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "watcher-ws-"));
    skillsDir = path.join(tmpDir, "skills");
    stateDir = tmpDir;
    mkdirSync(skillsDir, { recursive: true });
    dbPath = path.join(tmpDir, "ledger.json");
    db = await SkillDb.create(dbPath);
  });

  afterEach(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createWorkspaceSkill(botId: string, slug: string): void {
    const dir = path.join(stateDir, "agents", botId, "skills", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\n---\nTest.`);
  }

  function removeWorkspaceSkill(botId: string, slug: string): void {
    rmSync(path.join(stateDir, "agents", botId, "skills", slug), {
      recursive: true,
      force: true,
    });
  }

  async function waitUntil(
    predicate: () => boolean,
    timeoutMs = 5_000,
    intervalMs = 50,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("Timed out waiting for watcher state");
  }

  it("records workspace skills with agentId on syncNow", () => {
    createWorkspaceSkill("bot-1", "agent-tool");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    const wsSkills = db.getInstalledByAgent("bot-1");
    expect(wsSkills).toHaveLength(1);
    expect(wsSkills[0].slug).toBe("agent-tool");
    expect(wsSkills[0].source).toBe("workspace");
    expect(wsSkills[0].agentId).toBe("bot-1");
  });

  it("marks workspace skill as uninstalled when removed from disk", () => {
    db.recordInstall("removed-tool", "workspace", undefined, "bot-1");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    const wsSkills = db.getInstalledByAgent("bot-1");
    expect(wsSkills).toHaveLength(0);
  });

  it("does not duplicate existing workspace records", () => {
    createWorkspaceSkill("bot-1", "my-tool");
    db.recordInstall("my-tool", "workspace", undefined, "bot-1");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    const all = db.getAllInstalled().filter((r) => r.source === "workspace");
    expect(all).toHaveLength(1);
  });

  it("reconciles multiple agents", () => {
    createWorkspaceSkill("bot-1", "tool-a");
    createWorkspaceSkill("bot-2", "tool-b");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1", "bot-2"],
    });

    watcher.syncNow();

    expect(db.getInstalledByAgent("bot-1")).toHaveLength(1);
    expect(db.getInstalledByAgent("bot-2")).toHaveLength(1);
  });

  it("skips workspace reconciliation when openclawStateDir not provided", () => {
    createWorkspaceSkill("bot-1", "tool-a");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
    });

    watcher.syncNow();

    const wsSkills = db.getInstalledByAgent("bot-1");
    expect(wsSkills).toHaveLength(0);
  });

  it("does not mark workspace skills as missing during shared-dir reconciliation", () => {
    // Workspace skill exists in ledger but NOT in shared skillsDir
    db.recordInstall("ws-only-tool", "workspace", undefined, "bot-1");
    createWorkspaceSkill("bot-1", "ws-only-tool");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1"],
    });

    watcher.syncNow();

    // Should still be installed — shared-dir reconciliation must skip workspace records
    const wsSkills = db.getInstalledByAgent("bot-1");
    expect(wsSkills).toHaveLength(1);
    expect(wsSkills[0].slug).toBe("ws-only-tool");
  });

  it("discovers workspace botIds from disk even before setBotIds", () => {
    createWorkspaceSkill("bot-3", "dynamic-tool");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: [],
    });

    watcher.syncNow();
    expect(db.getInstalledByAgent("bot-3")).toHaveLength(1);

    watcher.setBotIds(["bot-3"]);
    watcher.syncNow();
    expect(db.getInstalledByAgent("bot-3")).toHaveLength(1);
  });

  it("only marks workspace removals for the matching agent", () => {
    createWorkspaceSkill("bot-2", "shared-tool");
    db.recordInstall("shared-tool", "workspace", undefined, "bot-1");
    db.recordInstall("shared-tool", "workspace", undefined, "bot-2");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      openclawStateDir: stateDir,
      botIds: ["bot-1", "bot-2"],
    });

    watcher.syncNow();

    expect(db.getInstalledByAgent("bot-1")).toHaveLength(0);
    const bot2Skills = db.getInstalledByAgent("bot-2");
    expect(bot2Skills).toHaveLength(1);
    expect(bot2Skills[0].slug).toBe("shared-tool");
  });

  it(
    "watches workspace directories after start and reconciles removals",
    { timeout: 10_000 },
    async () => {
      createWorkspaceSkill("bot-1", "live-tool");

      const watcher = new SkillDirWatcher({
        skillsDir,
        skillDb: db,
        openclawStateDir: stateDir,
        botIds: ["bot-1"],
        debounceMs: 50,
      });

      watcher.syncNow();
      watcher.start();
      expect(db.getInstalledByAgent("bot-1")).toHaveLength(1);

      removeWorkspaceSkill("bot-1", "live-tool");

      await waitUntil(() => db.getInstalledByAgent("bot-1").length === 0);
      watcher.stop();
    },
  );
});
