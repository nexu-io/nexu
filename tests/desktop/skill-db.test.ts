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
    db.recordInstall("github", "managed");
    db.recordUninstall("github", "managed");
    db.recordInstall("github", "managed");
    const all = db.getAllInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("installed");
  });

  it("recordUninstall marks as uninstalled", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("github", "managed");
    db.recordUninstall("github", "managed");
    expect(db.getAllInstalled()).toHaveLength(0);
  });

  it("recordBulkInstall inserts multiple records", async () => {
    db = await SkillDb.create(dbPath);
    db.recordBulkInstall(["github", "weather", "calendar"], "managed");
    expect(db.getAllInstalled()).toHaveLength(3);
  });

  it("isInstalled checks slug + source", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    expect(db.isInstalled("weather", "managed")).toBe(true);
    expect(db.isInstalled("weather", "custom")).toBe(false);
    expect(db.isInstalled("unknown", "managed")).toBe(false);
  });

  it("getAllKnownSlugs returns both installed and uninstalled slugs", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    db.recordInstall("github", "managed");
    db.recordUninstall("github", "managed");
    const known = db.getAllKnownSlugs();
    expect(known.has("weather")).toBe(true);
    expect(known.has("github")).toBe(true);
    expect(known.has("unknown")).toBe(false);
  });

  it("markUninstalledBySlugs marks multiple installed records as uninstalled", async () => {
    db = await SkillDb.create(dbPath);
    db.recordBulkInstall(["a", "b", "c"], "managed");
    db.markUninstalledBySlugs(["a", "c"], "managed");
    const installed = db.getAllInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe("b");
  });

  it("persists data across close and reopen", async () => {
    db = await SkillDb.create(dbPath);
    db.recordInstall("weather", "managed");
    db.recordInstall("github", "managed");
    db.close();

    db = await SkillDb.create(dbPath);
    const all = db.getAllInstalled();
    expect(all).toHaveLength(2);
    const slugs = all.map((r) => r.slug).sort();
    expect(slugs).toEqual(["github", "weather"]);
  });

  describe("workspace skills with agentId", () => {
    it("records workspace install with agentId", async () => {
      db = await SkillDb.create(dbPath);
      db.recordInstall("my-tool", "workspace", undefined, "bot-abc");
      const installed = db.getAllInstalled();
      expect(installed).toHaveLength(1);
      expect(installed[0].slug).toBe("my-tool");
      expect(installed[0].source).toBe("workspace");
      expect(installed[0].agentId).toBe("bot-abc");
    });

    it("returns workspace skills filtered by agentId", async () => {
      db = await SkillDb.create(dbPath);
      db.recordInstall("tool-a", "workspace", undefined, "bot-1");
      db.recordInstall("tool-b", "workspace", undefined, "bot-2");
      db.recordInstall("shared-skill", "managed");
      const bot1Skills = db.getInstalledByAgent("bot-1");
      expect(bot1Skills).toHaveLength(1);
      expect(bot1Skills[0].slug).toBe("tool-a");
      const bot2Skills = db.getInstalledByAgent("bot-2");
      expect(bot2Skills).toHaveLength(1);
      expect(bot2Skills[0].slug).toBe("tool-b");
    });

    it("getAllInstalled includes workspace skills", async () => {
      db = await SkillDb.create(dbPath);
      db.recordInstall("shared", "managed");
      db.recordInstall("ws-tool", "workspace", undefined, "bot-1");
      const all = db.getAllInstalled();
      expect(all).toHaveLength(2);
    });

    it("persists agentId across close/reopen", async () => {
      db = await SkillDb.create(dbPath);
      db.recordInstall("tool", "workspace", undefined, "bot-x");
      db.close();
      const db2 = await SkillDb.create(dbPath);
      const installed = db2.getAllInstalled();
      expect(installed[0].agentId).toBe("bot-x");
      db2.close();
    });

    it("legacy ledger without agentId field loads with null default", async () => {
      const { writeFileSync } = await import("node:fs");
      const legacyData = JSON.stringify({
        skills: [
          {
            slug: "old-skill",
            source: "managed",
            status: "installed",
            version: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            uninstalledAt: null,
          },
        ],
      });
      writeFileSync(dbPath, legacyData);
      db = await SkillDb.create(dbPath);
      const installed = db.getAllInstalled();
      expect(installed[0].agentId).toBeNull();
    });

    it("recordUninstall scopes workspace records by agentId", async () => {
      db = await SkillDb.create(dbPath);
      db.recordInstall("shared-tool", "workspace", undefined, "bot-1");
      db.recordInstall("shared-tool", "workspace", undefined, "bot-2");

      db.recordUninstall("shared-tool", "workspace", "bot-1");

      expect(db.getInstalledByAgent("bot-1")).toHaveLength(0);
      const bot2Skills = db.getInstalledByAgent("bot-2");
      expect(bot2Skills).toHaveLength(1);
      expect(bot2Skills[0].slug).toBe("shared-tool");
    });

    it("markUninstalledBySlugs scopes workspace records by agentId when provided", async () => {
      db = await SkillDb.create(dbPath);
      db.recordInstall("shared-tool", "workspace", undefined, "bot-1");
      db.recordInstall("shared-tool", "workspace", undefined, "bot-2");

      db.markUninstalledBySlugs(["shared-tool"], "workspace", "bot-1");

      expect(db.getInstalledByAgent("bot-1")).toHaveLength(0);
      const bot2Skills = db.getInstalledByAgent("bot-2");
      expect(bot2Skills).toHaveLength(1);
      expect(bot2Skills[0].slug).toBe("shared-tool");
    });
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
      INSERT INTO skills VALUES ('github', 'managed', 'uninstalled', NULL, NULL, '2026-03-20T11:00:00.000Z');
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
        agentId: null,
      },
    ]);
    // isRemovedByUser is deprecated (always returns false)
  });
});
