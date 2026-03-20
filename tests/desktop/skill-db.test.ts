import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillDb } from "#controller/services/skillhub/skill-db";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `skill-db-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SkillDb", () => {
  let tempDir: string;
  let dbPath: string;
  let db: SkillDb;

  beforeEach(() => {
    tempDir = makeTempDir();
    dbPath = resolve(tempDir, "skills.db");
  });

  afterEach(() => {
    db?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates database file and skills table", () => {
    db = new SkillDb(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("creates the parent directory before opening a nested database path", () => {
    dbPath = resolve(tempDir, "runtime", "skills.db");

    db = new SkillDb(dbPath);

    expect(existsSync(resolve(tempDir, "runtime"))).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(db.getAllInstalled()).toEqual([]);
  });

  it("recordInstall creates a new installed record", () => {
    db = new SkillDb(dbPath);
    db.recordInstall("weather", "managed");
    const all = db.getAllInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].slug).toBe("weather");
    expect(all[0].source).toBe("managed");
    expect(all[0].status).toBe("installed");
    expect(all[0].installedAt).toBeTruthy();
  });

  it("recordInstall upserts — re-installing sets status back to installed", () => {
    db = new SkillDb(dbPath);
    db.recordInstall("github", "curated");
    db.recordUninstall("github", "curated");
    db.recordInstall("github", "curated");
    const all = db.getAllInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("installed");
  });

  it("recordUninstall marks as uninstalled", () => {
    db = new SkillDb(dbPath);
    db.recordInstall("github", "curated");
    db.recordUninstall("github", "curated");
    expect(db.getAllInstalled()).toHaveLength(0);
    expect(db.isRemovedByUser("github")).toBe(true);
  });

  it("isRemovedByUser returns false for unknown slugs", () => {
    db = new SkillDb(dbPath);
    expect(db.isRemovedByUser("nonexistent")).toBe(false);
  });

  it("isRemovedByUser only checks curated source", () => {
    db = new SkillDb(dbPath);
    db.recordInstall("weather", "managed");
    db.recordUninstall("weather", "managed");
    // managed uninstall does NOT count as "removed by user" for curated re-install prevention
    expect(db.isRemovedByUser("weather")).toBe(false);
  });

  it("recordBulkInstall inserts multiple records in a transaction", () => {
    db = new SkillDb(dbPath);
    db.recordBulkInstall(["github", "weather", "calendar"], "curated");
    expect(db.getAllInstalled()).toHaveLength(3);
  });

  it("migrates .curated-state.json on first open", () => {
    const curatedDir = resolve(tempDir, "bundled-skills");
    mkdirSync(curatedDir, { recursive: true });
    const statePath = resolve(curatedDir, ".curated-state.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        removedByUser: ["github", "weather"],
        lastInstalledVersion: ["github", "weather", "calendar"],
      }),
    );

    db = new SkillDb(dbPath, curatedDir);
    expect(db.isRemovedByUser("github")).toBe(true);
    expect(db.isRemovedByUser("weather")).toBe(true);
    expect(db.isRemovedByUser("calendar")).toBe(false);
    // Legacy file renamed
    expect(existsSync(statePath)).toBe(false);
    expect(
      existsSync(resolve(curatedDir, ".curated-state.json.migrated")),
    ).toBe(true);
  });

  it("skips migration if no legacy file exists", () => {
    db = new SkillDb(dbPath, resolve(tempDir, "nonexistent-dir"));
    expect(db.getAllInstalled()).toEqual([]);
  });
});
