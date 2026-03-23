import { existsSync, readdirSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { resolve } from "node:path";
import type { SkillDb } from "./skill-db.js";
import type { SkillSource } from "./types.js";

export type SkillDirWatcherLogFn = (
  level: "info" | "warn" | "error",
  message: string,
) => void;

const defaultLog: SkillDirWatcherLogFn = () => {};

export class SkillDirWatcher {
  private readonly skillsDir: string;
  private readonly db: SkillDb;
  private readonly log: SkillDirWatcherLogFn;
  private readonly debounceMs: number;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    skillsDir: string;
    skillDb: SkillDb;
    log?: SkillDirWatcherLogFn;
    debounceMs?: number;
  }) {
    this.skillsDir = opts.skillsDir;
    this.db = opts.skillDb;
    this.log = opts.log ?? defaultLog;
    this.debounceMs = opts.debounceMs ?? 500;
  }

  syncNow(): void {
    if (!existsSync(this.skillsDir)) {
      return;
    }

    const diskSlugs = this.scanDiskSlugs();
    const diskSet = new Set(diskSlugs);

    const installed = this.db.getAllInstalled();
    const installedSlugs = new Set(installed.map((r) => r.slug));

    // Disk has it, ledger doesn't -> record as managed
    const added = diskSlugs.filter((slug) => !installedSlugs.has(slug));
    if (added.length > 0) {
      this.db.recordBulkInstall(added, "managed");
      this.log(
        "info",
        `Synced ${added.length} new skill(s) from disk: ${added.join(", ")}`,
      );
    }

    // Ledger has it, disk doesn't -> handle per source:
    // - Curated: REMOVE record entirely so getCuratedSlugsToEnqueue re-enqueues them.
    //   (markUninstalledBySlugs would make isRemovedByUser return true, blocking re-install.)
    // - Non-curated: mark as uninstalled (preserves user's install history).
    const missing = installed.filter((r) => !diskSet.has(r.slug));
    const curatedMissing: Array<{ slug: string; source: SkillSource }> = [];
    const otherBySource = new Map<SkillSource, string[]>();

    for (const record of missing) {
      if (record.source === "curated") {
        curatedMissing.push({ slug: record.slug, source: record.source });
      } else {
        const list = otherBySource.get(record.source) ?? [];
        list.push(record.slug);
        otherBySource.set(record.source, list);
      }
    }

    if (curatedMissing.length > 0) {
      this.db.removeRecords(curatedMissing);
      this.log(
        "info",
        `Removed ${curatedMissing.length} curated record(s) missing from disk (eligible for re-install): ${curatedMissing.map((r) => r.slug).join(", ")}`,
      );
    }

    for (const [source, slugs] of otherBySource) {
      this.db.markUninstalledBySlugs(slugs, source);
      this.log(
        "info",
        `Marked ${slugs.length} ${source} skill(s) as uninstalled: ${slugs.join(", ")}`,
      );
    }
  }

  start(): void {
    if (this.watcher !== null) {
      return;
    }

    if (!existsSync(this.skillsDir)) {
      this.log(
        "warn",
        `Skills directory does not exist, skipping watch: ${this.skillsDir}`,
      );
      return;
    }

    this.watcher = watch(
      this.skillsDir,
      { recursive: true },
      (_event, filename) => {
        if (filename?.endsWith("SKILL.md")) {
          this.scheduleSync();
        }
      },
    );

    this.watcher.on("error", (err: unknown) => {
      this.log(
        "error",
        `Watcher error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.log("info", `Watching skills directory: ${this.skillsDir}`);
  }

  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleSync(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.syncNow();
    }, this.debounceMs);
  }

  private scanDiskSlugs(): string[] {
    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(resolve(this.skillsDir, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name);
  }
}
