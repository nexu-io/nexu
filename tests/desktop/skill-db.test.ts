import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillDb } from "#controller/services/skillhub/skill-db";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `skill-db-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function hasSqliteCli(): boolean {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("SkillDb", () => {
  let tempDir: string;
  let dbPath: string;
  let db: SkillDb;

  beforeEach(() => {
    tempDir = makeTempDir();
    dbPath = resolve(tempDir, "skill-ledger.json");
  });

  afterEach(() => {
    db?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates database file and skills table", async () => {
    db = await SkillDb.create(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("creates the parent directory before opening a nested database path", async () => {
    dbPath = resolve(tempDir, "runtime", "skill-ledger.json");

    db = await SkillDb.create(dbPath);

    expect(existsSync(resolve(tempDir, "runtime"))).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("recordInstall creates a new installed record", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    const all = db.getAllInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].slug).toBe("weather");
    expect(all[0].source).toBe("managed");
    expect(all[0].status).toBe("installed");
    expect(all[0].installedAt).toBeTruthy();
  });

  it("recordInstall upserts — re-installing sets status back to installed", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("github", "curated");
    db.recordUninstall("github", "curated");
    db.recordInstall("github", "curated");
    const all = db.getAllInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("installed");
  });

  it("recordUninstall marks as uninstalled", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("github", "curated");
    db.recordUninstall("github", "curated");
    expect(db.getAllInstalled()).toHaveLength(0);
    expect(db.isRemovedByUser("github")).toBe(true);
  });

  it("isRemovedByUser returns false for unknown slugs", async () => {
    db = await SkillDb.create(dbPath);
    expect(db.isRemovedByUser("nonexistent")).toBe(false);
  });

  it("isRemovedByUser only checks curated source", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    db.recordUninstall("weather", "managed");
    // managed uninstall does NOT count as "removed by user" for curated re-install prevention
    expect(db.isRemovedByUser("weather")).toBe(false);
  });

  it("recordBulkInstall inserts multiple records", async () => {
    db = await SkillDb.create(dbPath);
    db.recordBulkInstall(["github", "weather", "calendar"], "curated");
    expect(db.getAllInstalled()).toHaveLength(3);
  });

  it("isInstalled checks slug + source", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    expect(db.isInstalled("weather", "managed")).toBe(true);
    expect(db.isInstalled("weather", "curated")).toBe(false);
    expect(db.isInstalled("unknown", "managed")).toBe(false);
  });

  it("markUninstalledBySlugs marks multiple installed records as uninstalled", async () => {
    db = await SkillDb.create(dbPath);
    db.recordBulkInstall(["a", "b", "c"], "curated");
    db.markUninstalledBySlugs(["a", "c"], "curated");
    const installed = db.getAllInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe("b");
  });

  it("persists data across close and reopen", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    db.recordInstall("github", "curated");
    db.close();

    db = await SkillDb.create(dbPath);
    const all = db.getAllInstalled();
    expect(all).toHaveLength(2);
    const slugs = all.map((r) => r.slug).sort();
    expect(slugs).toEqual(["github", "weather"]);
  });

  it("supports custom source type", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("my-skill", "custom");
    expect(db.isInstalled("my-skill", "custom")).toBe(true);
    expect(db.isInstalled("my-skill", "managed")).toBe(false);
    const all = db.getAllInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].source).toBe("custom");
  });

  it("migrates a legacy sqlite ledger into the json ledger on first open", async () => {
    if (!hasSqliteCli()) {
      return;
    }

    const legacyDbPath = resolve(tempDir, "skill-ledger.db");
    execFileSync("sqlite3", [
      legacyDbPath,
      `
      CREATE TABLE skills (
        slug TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        version TEXT,
        installed_at TEXT,
        uninstalled_at TEXT,
        PRIMARY KEY (slug, source)
      );
      INSERT INTO skills VALUES ('weather', 'managed', 'installed', '1.2.3', '2026-03-20T10:00:00.000Z', NULL);
      INSERT INTO skills VALUES ('github', 'curated', 'uninstalled', NULL, NULL, '2026-03-20T11:00:00.000Z');
      `,
    ]);

    db = await SkillDb.create(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    expect(db.getAllInstalled()).toEqual([
      {
        slug: "weather",
        source: "managed",
        status: "installed",
        version: "1.2.3",
        installedAt: "2026-03-20T10:00:00.000Z",
        uninstalledAt: null,
      },
    ]);
    expect(db.isRemovedByUser("github")).toBe(true);
  });
});
