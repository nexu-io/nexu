import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillDb } from "#controller/services/skillhub/skill-db";
import { SkillDirWatcher } from "#controller/services/skillhub/skill-dir-watcher";

function makeTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "skill-dir-watcher-test-"));
}

function writeSkill(skillsDir: string, slug: string): void {
  const dir = resolve(skillsDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), `---\nname: ${slug}\n---\n`);
}

function removeSkill(skillsDir: string, slug: string): void {
  rmSync(resolve(skillsDir, slug), { recursive: true, force: true });
}

function touchWatchTrigger(skillsDir: string): void {
  writeFileSync(resolve(skillsDir, ".watch-trigger"), String(Date.now()));
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(
  fn: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await wait(intervalMs);
  }

  throw new Error("Timed out waiting for watcher state");
}

describe("SkillDirWatcher", () => {
  let tempDir: string;
  let skillsDir: string;
  let dbPath: string;
  let db: SkillDb;
  let watcher: SkillDirWatcher;

  beforeEach(async () => {
    tempDir = makeTempDir();
    skillsDir = resolve(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
    dbPath = resolve(tempDir, "skill-ledger.json");
    db = await SkillDb.create(dbPath);
  });

  afterEach(() => {
    watcher?.stop();
    db?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("syncNow", () => {
    it("records untracked on-disk skills as managed", () => {
      writeSkill(skillsDir, "weather");
      writeSkill(skillsDir, "github");

      watcher = new SkillDirWatcher({
        skillsDir,
        skillDb: db,
      });
      watcher.syncNow();

      expect(db.isInstalled("weather", "managed")).toBe(true);
      expect(db.isInstalled("github", "managed")).toBe(true);
      expect(db.getAllInstalled()).toHaveLength(2);
    });

    it("skips skills already in ledger", () => {
      writeSkill(skillsDir, "github");
      db.recordInstall("github", "managed");

      watcher = new SkillDirWatcher({ skillsDir, skillDb: db });
      watcher.syncNow();

      expect(db.isInstalled("github", "managed")).toBe(true);
      expect(db.getAllInstalled()).toHaveLength(1);
    });

    it("marks missing skills as uninstalled", () => {
      db.recordInstall("weather", "managed");

      watcher = new SkillDirWatcher({ skillsDir, skillDb: db });
      watcher.syncNow();

      expect(db.isInstalled("weather", "managed")).toBe(false);
    });

    it("no-ops when skillsDir does not exist", () => {
      const missingDir = resolve(tempDir, "nonexistent");

      watcher = new SkillDirWatcher({
        skillsDir: missingDir,
        skillDb: db,
      });

      // Should not throw
      watcher.syncNow();
      expect(db.getAllInstalled()).toHaveLength(0);
    });

    it("ignores directories without SKILL.md", () => {
      // Create a directory without SKILL.md
      mkdirSync(resolve(skillsDir, "no-skill-md"), { recursive: true });
      writeFileSync(resolve(skillsDir, "no-skill-md", "README.md"), "# Hello");

      // Create a valid skill directory
      writeSkill(skillsDir, "valid-skill");

      watcher = new SkillDirWatcher({
        skillsDir,
        skillDb: db,
      });
      watcher.syncNow();

      expect(db.isInstalled("valid-skill", "managed")).toBe(true);
      expect(db.isInstalled("no-skill-md", "managed")).toBe(false);
      expect(db.getAllInstalled()).toHaveLength(1);
    });
  });

  describe("start/stop", () => {
    it("start and stop do not throw", () => {
      watcher = new SkillDirWatcher({
        skillsDir,
        skillDb: db,
      });

      expect(() => watcher.start()).not.toThrow();
      expect(() => watcher.stop()).not.toThrow();
    });

    it("start is idempotent — calling twice does not create duplicate watchers", () => {
      watcher = new SkillDirWatcher({
        skillsDir,
        skillDb: db,
      });

      expect(() => {
        watcher.start();
        watcher.start();
      }).not.toThrow();

      // Cleanup handled by afterEach
    });
  });

  describe("file-system triggered sync", () => {
    it(
      "detects new SKILL.md and syncs ledger after debounce",
      { timeout: 10000 },
      async () => {
        watcher = new SkillDirWatcher({
          skillsDir,
          skillDb: db,
          debounceMs: 50,
        });
        watcher.start();

        writeSkill(skillsDir, "new-skill");
        touchWatchTrigger(skillsDir);

        await waitUntil(() => db.isInstalled("new-skill", "managed"));

        expect(db.isInstalled("new-skill", "managed")).toBe(true);
      },
    );

    it(
      "detects SKILL.md removal and marks skill as uninstalled",
      { timeout: 10000 },
      async () => {
        writeSkill(skillsDir, "doomed-skill");

        watcher = new SkillDirWatcher({
          skillsDir,
          skillDb: db,
          debounceMs: 50,
        });
        watcher.syncNow();
        expect(db.isInstalled("doomed-skill", "managed")).toBe(true);

        watcher.start();

        removeSkill(skillsDir, "doomed-skill");
        touchWatchTrigger(skillsDir);

        await waitUntil(() => !db.isInstalled("doomed-skill", "managed"));

        expect(db.isInstalled("doomed-skill", "managed")).toBe(false);
      },
    );
  });
});
