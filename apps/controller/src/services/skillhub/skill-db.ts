import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import type { SkillSource } from "./types.js";

export type SkillRecord = {
  readonly slug: string;
  readonly source: SkillSource;
  readonly status: "installed" | "uninstalled";
  readonly version: string | null;
  readonly installedAt: string | null;
  readonly uninstalledAt: string | null;
};

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS skills (
  slug           TEXT NOT NULL,
  source         TEXT NOT NULL CHECK(source IN ('curated', 'managed')),
  status         TEXT NOT NULL CHECK(status IN ('installed', 'uninstalled')),
  version        TEXT,
  installed_at   TEXT,
  uninstalled_at TEXT,
  PRIMARY KEY (slug, source)
)`;

export class SkillDb {
  private readonly db: Database;
  private readonly dbPath: string;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  static async create(
    dbPath: string,
    legacyCuratedDir?: string,
  ): Promise<SkillDb> {
    mkdirSync(dirname(dbPath), { recursive: true });

    const SQL = await initSqlJs();

    let db: Database;
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    db.run(CREATE_TABLE);

    const instance = new SkillDb(db, dbPath);
    instance.persist();

    if (legacyCuratedDir) {
      instance.migrateFromJson(legacyCuratedDir);
    }

    return instance;
  }

  getAllInstalled(): readonly SkillRecord[] {
    const results = this.db.exec(
      "SELECT slug, source, status, version, installed_at, uninstalled_at FROM skills WHERE status = 'installed'",
    );
    if (results.length === 0) return [];

    const rows = results[0]?.values ?? [];
    return rows.map((row) => ({
      slug: String(row[0]),
      source: String(row[1]) as SkillSource,
      status: "installed" as const,
      version: row[3] != null ? String(row[3]) : null,
      installedAt: row[4] != null ? String(row[4]) : null,
      uninstalledAt: row[5] != null ? String(row[5]) : null,
    }));
  }

  recordInstall(slug: string, source: SkillSource, version?: string): void {
    this.db.run(
      `INSERT INTO skills (slug, source, status, version, installed_at, uninstalled_at)
       VALUES (?, ?, 'installed', ?, datetime('now'), NULL)
       ON CONFLICT(slug, source) DO UPDATE SET
         status = 'installed',
         version = COALESCE(excluded.version, version),
         installed_at = datetime('now'),
         uninstalled_at = NULL`,
      [slug, source, version ?? null],
    );
    this.persist();
  }

  recordUninstall(slug: string, source: SkillSource): void {
    this.db.run(
      `INSERT INTO skills (slug, source, status, uninstalled_at)
       VALUES (?, ?, 'uninstalled', datetime('now'))
       ON CONFLICT(slug, source) DO UPDATE SET
         status = 'uninstalled',
         uninstalled_at = datetime('now')`,
      [slug, source],
    );
    this.persist();
  }

  isRemovedByUser(slug: string): boolean {
    const results = this.db.exec(
      "SELECT 1 FROM skills WHERE slug = ? AND source = 'curated' AND status = 'uninstalled'",
      [slug],
    );
    return (results[0]?.values.length ?? 0) > 0;
  }

  isInstalled(slug: string, source: SkillSource): boolean {
    const results = this.db.exec(
      "SELECT 1 FROM skills WHERE slug = ? AND source = ? AND status = 'installed'",
      [slug, source],
    );
    return (results[0]?.values.length ?? 0) > 0;
  }

  recordBulkInstall(slugs: readonly string[], source: SkillSource): void {
    this.db.run("BEGIN TRANSACTION");
    try {
      for (const slug of slugs) {
        this.db.run(
          `INSERT INTO skills (slug, source, status, installed_at)
           VALUES (?, ?, 'installed', datetime('now'))
           ON CONFLICT(slug, source) DO UPDATE SET
             status = 'installed',
             installed_at = datetime('now'),
             uninstalled_at = NULL`,
          [slug, source],
        );
      }
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
    this.persist();
  }

  markUninstalledBySlugs(slugs: readonly string[], source: SkillSource): void {
    if (slugs.length === 0) return;
    this.db.run("BEGIN TRANSACTION");
    try {
      for (const slug of slugs) {
        this.db.run(
          `UPDATE skills SET status = 'uninstalled', uninstalled_at = datetime('now')
           WHERE slug = ? AND source = ? AND status = 'installed'`,
          [slug, source],
        );
      }
      this.db.run("COMMIT");
    } catch (err) {
      this.db.run("ROLLBACK");
      throw err;
    }
    this.persist();
  }

  close(): void {
    this.persist();
    this.db.close();
  }

  private persist(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const tmpPath = `${this.dbPath}.tmp`;
    writeFileSync(tmpPath, buffer);
    renameSync(tmpPath, this.dbPath);
  }

  private migrateFromJson(curatedDir: string): void {
    const statePath = resolve(curatedDir, ".curated-state.json");
    if (!existsSync(statePath)) return;

    try {
      const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
        removedByUser?: string[];
      };
      const removed = raw.removedByUser ?? [];
      if (removed.length > 0) {
        this.db.run("BEGIN TRANSACTION");
        try {
          for (const slug of removed) {
            this.db.run(
              `INSERT INTO skills (slug, source, status, uninstalled_at)
               VALUES (?, 'curated', 'uninstalled', datetime('now'))
               ON CONFLICT(slug, source) DO NOTHING`,
              [slug],
            );
          }
          this.db.run("COMMIT");
        } catch (err) {
          this.db.run("ROLLBACK");
          throw err;
        }
        this.persist();
      }
      renameSync(
        statePath,
        resolve(curatedDir, ".curated-state.json.migrated"),
      );
    } catch {
      // Best-effort migration — don't block startup
    }
  }
}
