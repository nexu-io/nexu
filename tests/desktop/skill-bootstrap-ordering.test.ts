import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STATIC_SKILL_SLUGS,
  copyStaticSkills,
} from "#controller/services/skillhub/curated-skills";
import { SkillDb } from "#controller/services/skillhub/skill-db";
import { SkillDirWatcher } from "#controller/services/skillhub/skill-dir-watcher";

function makeTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "skill-bootstrap-order-"));
}

function writeSkill(dir: string, slug: string): void {
  const skillDir = resolve(dir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    resolve(skillDir, "SKILL.md"),
    `---\nname: ${slug}\n---\nTest skill.`,
  );
}

/** Use the first STATIC_SKILL_SLUGS entry so copyStaticSkills recognises it. */
const STATIC_TEST_SLUG = STATIC_SKILL_SLUGS[0];

describe("skill bootstrap ordering", () => {
  let tempDir: string;
  let skillsDir: string;
  let staticDir: string;
  let userSkillsDir: string;
  let dbPath: string;
  let db: SkillDb;

  beforeEach(async () => {
    tempDir = makeTempDir();
    skillsDir = resolve(tempDir, "skills");
    staticDir = resolve(tempDir, "static");
    userSkillsDir = resolve(tempDir, "user-skills");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(staticDir, { recursive: true });
    mkdirSync(userSkillsDir, { recursive: true });
    dbPath = resolve(tempDir, "skill-ledger.json");
    db = await SkillDb.create(dbPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("static skills are in ledger after bootstrap (before first config compile)", () => {
    expect(db.getAllInstalled()).toHaveLength(0);

    // Place a static skill in the bundled-skills directory
    writeSkill(staticDir, STATIC_TEST_SLUG);

    // copyStaticSkills + recordBulkInstall (what initialize() does)
    const { copied } = copyStaticSkills({
      staticDir,
      targetDir: skillsDir,
      skillDb: db,
    });
    if (copied.length > 0) {
      db.recordBulkInstall(copied, "managed");
    }

    // Skill is now on disk AND in ledger
    expect(existsSync(resolve(skillsDir, STATIC_TEST_SLUG, "SKILL.md"))).toBe(
      true,
    );
    const slugs = db.getAllInstalled().map((r) => r.slug);
    expect(slugs).toContain(STATIC_TEST_SLUG);
  });

  it("bootstrap then start does not duplicate ledger entries", () => {
    writeSkill(staticDir, STATIC_TEST_SLUG);

    // First run: bootstrap()
    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      userSkillsDir,
    });
    watcher.syncNow();

    const { copied: copied1 } = copyStaticSkills({
      staticDir,
      targetDir: skillsDir,
      skillDb: db,
    });
    if (copied1.length > 0) {
      db.recordBulkInstall(copied1, "managed");
    }
    expect(db.getAllInstalled()).toHaveLength(1);

    // Second run: start() calls syncNow + initialize again (idempotent)
    watcher.syncNow();
    const { copied: copied2 } = copyStaticSkills({
      staticDir,
      targetDir: skillsDir,
      skillDb: db,
    });
    if (copied2.length > 0) {
      db.recordBulkInstall(copied2, "managed");
    }

    // Still exactly 1 entry
    expect(db.getAllInstalled()).toHaveLength(1);
    expect(db.getAllInstalled()[0].slug).toBe(STATIC_TEST_SLUG);
  });

  it("bootstrap picks up user-installed skills from user skills dir", () => {
    writeSkill(userSkillsDir, "user-custom-skill");

    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      userSkillsDir,
    });

    // syncNow discovers user skill
    watcher.syncNow();

    const installed = db.getAllInstalled();
    expect(installed.map((r) => r.slug)).toContain("user-custom-skill");
    expect(installed.find((r) => r.slug === "user-custom-skill")?.source).toBe(
      "user",
    );
  });

  it("first compile after bootstrap includes both static and user skills", () => {
    // Static skill from app bundle
    writeSkill(staticDir, STATIC_TEST_SLUG);
    // User-installed skill
    writeSkill(userSkillsDir, "manual-skill");

    // bootstrap sequence: syncNow then copyStaticSkills
    const watcher = new SkillDirWatcher({
      skillsDir,
      skillDb: db,
      userSkillsDir,
    });
    watcher.syncNow();

    const { copied } = copyStaticSkills({
      staticDir,
      targetDir: skillsDir,
      skillDb: db,
    });
    if (copied.length > 0) {
      db.recordBulkInstall(copied, "managed");
    }

    // Simulate compileCurrentConfig: get all non-workspace installed slugs
    const installedSlugs = db
      .getAllInstalled()
      .filter((r) => r.source !== "workspace")
      .map((r) => r.slug);

    expect(installedSlugs).toContain(STATIC_TEST_SLUG);
    expect(installedSlugs).toContain("manual-skill");
  });
});
