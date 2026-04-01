import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogManager } from "#controller/services/skillhub/catalog-manager";
import { SkillDb } from "#controller/services/skillhub/skill-db";

function makeTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "catalog-manager-test-"));
}

function writeSkill(dir: string, slug: string): string {
  const skillDir = resolve(dir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, "SKILL.md"), `---\nname: ${slug}\n---\n`);
  return skillDir;
}

describe("CatalogManager uninstallSkill", () => {
  let tempDir: string;
  let sharedSkillsDir: string;
  let stateDir: string;
  let cacheDir: string;
  let dbPath: string;
  let db: SkillDb;
  let catalog: CatalogManager;

  beforeEach(async () => {
    tempDir = makeTempDir();
    stateDir = tempDir;
    sharedSkillsDir = resolve(stateDir, "skills");
    cacheDir = resolve(tempDir, "cache");
    dbPath = resolve(tempDir, "skill-ledger.json");
    mkdirSync(sharedSkillsDir, { recursive: true });
    db = await SkillDb.create(dbPath);
    catalog = new CatalogManager(cacheDir, {
      skillsDir: sharedSkillsDir,
      skillDb: db,
    });
  });

  afterEach(() => {
    db?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects workspace uninstall without agentId", async () => {
    const workspaceRoot = resolve(stateDir, "agents", "bot-1", "skills");
    writeSkill(workspaceRoot, "agent-tool");
    db.recordInstall("agent-tool", "workspace", undefined, "bot-1");

    const result = await catalog.uninstallSkill({
      slug: "agent-tool",
      source: "workspace",
    });

    expect(result.ok).toBe(false);
    expect(existsSync(resolve(workspaceRoot, "agent-tool"))).toBe(true);
    expect(db.getInstalledByAgent("bot-1")).toHaveLength(1);
  });

  it("removes only the selected agent workspace skill", async () => {
    const bot1SkillsDir = resolve(stateDir, "agents", "bot-1", "skills");
    const bot2SkillsDir = resolve(stateDir, "agents", "bot-2", "skills");
    const bot1Path = writeSkill(bot1SkillsDir, "shared-tool");
    const bot2Path = writeSkill(bot2SkillsDir, "shared-tool");
    db.recordInstall("shared-tool", "workspace", undefined, "bot-1");
    db.recordInstall("shared-tool", "workspace", undefined, "bot-2");

    const result = await catalog.uninstallSkill({
      slug: "shared-tool",
      source: "workspace",
      agentId: "bot-1",
    });

    expect(result.ok).toBe(true);
    expect(existsSync(bot1Path)).toBe(false);
    expect(existsSync(bot2Path)).toBe(true);
    expect(db.getInstalledByAgent("bot-1")).toHaveLength(0);
    expect(db.getInstalledByAgent("bot-2")).toHaveLength(1);
  });
});
