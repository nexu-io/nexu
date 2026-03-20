import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
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
  private readonly db: Database.Database;

  constructor(dbPath: string, legacyCuratedDir?: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(CREATE_TABLE);
    if (legacyCuratedDir) {
      this.migrateFromJson(legacyCuratedDir);
    }
  }

  getAllInstalled(): readonly SkillRecord[] {
    const rows = this.db
      .prepare(
        "SELECT slug, source, status, version, installed_at, uninstalled_at FROM skills WHERE status = 'installed'",
      )
      .all() as Array<{
      slug: string;
      source: SkillSource;
      status: "installed";
      version: string | null;
      installed_at: string | null;
      uninstalled_at: string | null;
    }>;
    return rows.map((r) => ({
      slug: r.slug,
      source: r.source,
      status: r.status,
      version: r.version,
      installedAt: r.installed_at,
      uninstalledAt: r.uninstalled_at,
    }));
  }

  recordInstall(slug: string, source: SkillSource, version?: string): void {
    this.db
      .prepare(
        `INSERT INTO skills (slug, source, status, version, installed_at, uninstalled_at)
         VALUES (?, ?, 'installed', ?, datetime('now'), NULL)
         ON CONFLICT(slug, source) DO UPDATE SET
           status = 'installed',
           version = COALESCE(excluded.version, version),
           installed_at = datetime('now'),
           uninstalled_at = NULL`,
      )
      .run(slug, source, version ?? null);
  }

  recordUninstall(slug: string, source: SkillSource): void {
    this.db
      .prepare(
        `INSERT INTO skills (slug, source, status, uninstalled_at)
         VALUES (?, ?, 'uninstalled', datetime('now'))
         ON CONFLICT(slug, source) DO UPDATE SET
           status = 'uninstalled',
           uninstalled_at = datetime('now')`,
      )
      .run(slug, source);
  }

  isRemovedByUser(slug: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM skills WHERE slug = ? AND source = 'curated' AND status = 'uninstalled'",
      )
      .get(slug);
    return row !== undefined;
  }

  recordBulkInstall(slugs: readonly string[], source: SkillSource): void {
    const insert = this.db.prepare(
      `INSERT INTO skills (slug, source, status, installed_at)
       VALUES (?, ?, 'installed', datetime('now'))
       ON CONFLICT(slug, source) DO UPDATE SET
         status = 'installed',
         installed_at = datetime('now'),
         uninstalled_at = NULL`,
    );
    const tx = this.db.transaction((items: readonly string[]) => {
      for (const slug of items) {
        insert.run(slug, source);
      }
    });
    tx(slugs);
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
        const insert = this.db.prepare(
          `INSERT INTO skills (slug, source, status, uninstalled_at)
           VALUES (?, 'curated', 'uninstalled', datetime('now'))
           ON CONFLICT(slug, source) DO NOTHING`,
        );
        const tx = this.db.transaction((slugs: string[]) => {
          for (const slug of slugs) {
            insert.run(slug);
          }
        });
        tx(removed);
      }
      renameSync(
        statePath,
        resolve(curatedDir, ".curated-state.json.migrated"),
      );
    } catch {
      // Best-effort migration — don't block startup
    }
  }

  close(): void {
    this.db.close();
  }
}
