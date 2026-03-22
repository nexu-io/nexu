import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { LowSync } from "lowdb";
import { z } from "zod";
import type { SkillSource } from "./types.js";

const skillRecordSchema = z.object({
  slug: z.string(),
  source: z.enum(["curated", "managed", "custom"]),
  status: z.enum(["installed", "uninstalled"]),
  version: z.string().nullable().default(null),
  installedAt: z.string().nullable().default(null),
  uninstalledAt: z.string().nullable().default(null),
});

const skillLedgerSchema = z.object({
  skills: z.array(skillRecordSchema).default([]),
});

export type SkillRecord = z.infer<typeof skillRecordSchema>;
type SkillLedger = z.infer<typeof skillLedgerSchema>;

const emptyLedger = (): SkillLedger => ({ skills: [] });

class AtomicJsonFileSync<T> {
  constructor(private readonly filePath: string) {}

  read(): T | null {
    if (!existsSync(this.filePath)) {
      return null;
    }

    return JSON.parse(readFileSync(this.filePath, "utf8")) as T;
  }

  write(data: T): void {
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }
}

export class SkillDb {
  private readonly db: LowSync<SkillLedger>;

  private constructor(dbPath: string, fallbackData: SkillLedger) {
    const adapter = new AtomicJsonFileSync<SkillLedger>(dbPath);
    this.db = new LowSync(adapter, fallbackData);
    this.db.read();
    const parsed = skillLedgerSchema.safeParse(this.db.data);
    this.db.data = parsed.success ? parsed.data : fallbackData;
    this.persist();
  }

  static async create(
    dbPath: string,
    legacyCuratedDir?: string,
  ): Promise<SkillDb> {
    mkdirSync(dirname(dbPath), { recursive: true });

    const fallbackData =
      SkillDb.loadLegacySqliteLedger(dbPath) ??
      SkillDb.loadLegacyCuratedState(legacyCuratedDir) ??
      emptyLedger();

    return new SkillDb(dbPath, fallbackData);
  }

  getAllInstalled(): readonly SkillRecord[] {
    return this.current().skills.filter(
      (skill) => skill.status === "installed",
    );
  }

  /**
   * Returns curated records marked as "uninstalled" — used by reconciliation
   * to clean up stale entries that block re-installation after a reinstall.
   */
  getUninstalledCurated(): readonly SkillRecord[] {
    return this.current().skills.filter(
      (skill) => skill.source === "curated" && skill.status === "uninstalled",
    );
  }

  recordInstall(slug: string, source: SkillSource, version?: string): void {
    const now = new Date().toISOString();
    const current = this.current();
    const existing = current.skills.find(
      (skill) => skill.slug === slug && skill.source === source,
    );
    const nextRecord: SkillRecord = {
      slug,
      source,
      status: "installed",
      version: version ?? existing?.version ?? null,
      installedAt: now,
      uninstalledAt: null,
    };

    this.db.data = {
      skills: this.upsertRecord(current.skills, nextRecord),
    };
    this.persist();
  }

  recordUninstall(slug: string, source: SkillSource): void {
    const now = new Date().toISOString();
    const current = this.current();
    const existing = current.skills.find(
      (skill) => skill.slug === slug && skill.source === source,
    );
    const nextRecord: SkillRecord = {
      slug,
      source,
      status: "uninstalled",
      version: existing?.version ?? null,
      installedAt: existing?.installedAt ?? null,
      uninstalledAt: now,
    };

    this.db.data = {
      skills: this.upsertRecord(current.skills, nextRecord),
    };
    this.persist();
  }

  isRemovedByUser(slug: string): boolean {
    return this.current().skills.some(
      (skill) =>
        skill.slug === slug &&
        skill.source === "curated" &&
        skill.status === "uninstalled",
    );
  }

  isInstalled(slug: string, source: SkillSource): boolean {
    return this.current().skills.some(
      (skill) =>
        skill.slug === slug &&
        skill.source === source &&
        skill.status === "installed",
    );
  }

  recordBulkInstall(slugs: readonly string[], source: SkillSource): void {
    const now = new Date().toISOString();
    const current = this.current();
    let skills = [...current.skills];

    for (const slug of slugs) {
      const existing = skills.find(
        (skill) => skill.slug === slug && skill.source === source,
      );
      const nextRecord: SkillRecord = {
        slug,
        source,
        status: "installed",
        version: existing?.version ?? null,
        installedAt: now,
        uninstalledAt: null,
      };
      skills = this.upsertRecord(skills, nextRecord);
    }

    this.db.data = { skills };
    this.persist();
  }

  markUninstalledBySlugs(slugs: readonly string[], source: SkillSource): void {
    if (slugs.length === 0) {
      return;
    }

    const slugSet = new Set(slugs);
    const now = new Date().toISOString();
    this.db.data = {
      skills: this.current().skills.map((skill) =>
        slugSet.has(skill.slug) &&
        skill.source === source &&
        skill.status === "installed"
          ? { ...skill, status: "uninstalled", uninstalledAt: now }
          : skill,
      ),
    };
    this.persist();
  }

  /**
   * Remove records entirely (not just mark uninstalled).
   * Used by reconciliation so curated skills can be re-installed on next startup.
   */
  removeRecords(
    entries: ReadonlyArray<{ slug: string; source: SkillSource }>,
  ): void {
    if (entries.length === 0) return;

    const keySet = new Set(entries.map((e) => `${e.slug}:${e.source}`));
    this.db.data = {
      skills: this.current().skills.filter(
        (skill) => !keySet.has(`${skill.slug}:${skill.source}`),
      ),
    };
    this.persist();
  }

  close(): void {
    this.persist();
  }

  private current(): SkillLedger {
    return this.db.data ?? emptyLedger();
  }

  private persist(): void {
    this.db.write();
  }

  private upsertRecord(
    records: readonly SkillRecord[],
    nextRecord: SkillRecord,
  ): SkillRecord[] {
    const index = records.findIndex(
      (record) =>
        record.slug === nextRecord.slug && record.source === nextRecord.source,
    );

    if (index === -1) {
      return [...records, nextRecord];
    }

    return records.map((record, recordIndex) =>
      recordIndex === index ? nextRecord : record,
    );
  }

  private static loadLegacyCuratedState(
    legacyCuratedDir?: string,
  ): SkillLedger | null {
    if (!legacyCuratedDir) {
      return null;
    }

    const statePath = resolve(legacyCuratedDir, ".curated-state.json");
    if (!existsSync(statePath)) {
      return null;
    }

    try {
      const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
        removedByUser?: string[];
      };
      const removed = raw.removedByUser ?? [];
      if (removed.length === 0) {
        return emptyLedger();
      }

      return {
        skills: removed.map((slug) => ({
          slug,
          source: "curated" as const,
          status: "uninstalled" as const,
          version: null,
          installedAt: null,
          uninstalledAt: new Date().toISOString(),
        })),
      };
    } catch {
      return null;
    }
  }

  private static loadLegacySqliteLedger(dbPath: string): SkillLedger | null {
    if (!dbPath.endsWith(".json")) {
      return null;
    }

    const legacyDbPath = dbPath.replace(/\.json$/, ".db");
    if (!existsSync(legacyDbPath) || existsSync(dbPath)) {
      return null;
    }

    try {
      const query =
        "SELECT slug, source, status, COALESCE(version, ''), COALESCE(installed_at, ''), COALESCE(uninstalled_at, '') FROM skills";
      const output = execFileSync(
        "sqlite3",
        ["-readonly", "-separator", "\t", legacyDbPath, query],
        { encoding: "utf8" },
      );

      const skills = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [slug, source, status, version, installedAt, uninstalledAt] =
            line.split("\t");

          return skillRecordSchema.parse({
            slug,
            source,
            status,
            version: version || null,
            installedAt: installedAt || null,
            uninstalledAt: uninstalledAt || null,
          });
        });

      return skillLedgerSchema.parse({ skills });
    } catch {
      return null;
    }
  }
}
