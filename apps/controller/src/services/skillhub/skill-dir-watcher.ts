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
  private readonly isSlugInFlight: (slug: string) => boolean;
  private readonly userSkillsDir: string | null;
  private readonly openclawStateDir: string | null;
  private readonly onChange: () => void;
  private botIds: readonly string[];
  private sharedWatcher: FSWatcher | null = null;
  private userWatcher: FSWatcher | null = null;
  private workspaceWatcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    skillsDir: string;
    skillDb: SkillDb;
    log?: SkillDirWatcherLogFn;
    debounceMs?: number;
    /** Returns true if the slug is currently being installed by the queue. */
    isSlugInFlight?: (slug: string) => boolean;
    /** User-level skills directory (~/.agents/skills/). */
    userSkillsDir?: string;
    /** Root of the OpenClaw state directory (contains agents/<botId>/skills/). */
    openclawStateDir?: string;
    /** Bot IDs whose workspace skill directories should be reconciled. */
    botIds?: readonly string[];
    /** Called after a watcher-driven reconciliation changes ledger state. */
    onChange?: () => void;
  }) {
    this.skillsDir = opts.skillsDir;
    this.db = opts.skillDb;
    this.log = opts.log ?? defaultLog;
    this.debounceMs = opts.debounceMs ?? 500;
    this.isSlugInFlight = opts.isSlugInFlight ?? (() => false);
    this.userSkillsDir = opts.userSkillsDir ?? null;
    this.openclawStateDir = opts.openclawStateDir ?? null;
    this.botIds = opts.botIds ?? [];
    this.onChange = opts.onChange ?? (() => {});
  }

  setBotIds(botIds: readonly string[]): void {
    this.botIds = botIds;
  }

  syncNow(): boolean {
    const sharedChanged = this.syncSharedDir();
    const userChanged = this.syncUserDir();
    const workspaceChanged = this.syncWorkspaceDirs();
    return sharedChanged || userChanged || workspaceChanged;
  }

  private syncSharedDir(): boolean {
    if (!existsSync(this.skillsDir)) {
      return false;
    }

    const diskSlugs = this.scanDirSlugs(this.skillsDir);
    if (diskSlugs === null) {
      this.log("warn", "sync: directory scan failed, skipping reconciliation");
      return false;
    }
    const diskSet = new Set(diskSlugs);

    // Only consider non-workspace skills for shared-dir reconciliation
    const installed = this.db
      .getAllInstalled()
      .filter((r) => r.source !== "workspace");
    const installedSlugs = new Set(installed.map((r) => r.slug));

    // Disk has it, ledger doesn't -> record as managed
    // Skip slugs currently in the install queue — the queue will record with the correct source.
    const added = diskSlugs.filter(
      (slug) => !installedSlugs.has(slug) && !this.isSlugInFlight(slug),
    );
    let changed = false;
    if (added.length > 0) {
      this.db.recordBulkInstall(added, "managed");
      changed = true;
      this.log(
        "info",
        `Synced ${added.length} new skill(s) from disk: ${added.join(", ")}`,
      );
    }

    // Ledger has it, disk doesn't -> mark as uninstalled (preserves user's install history).
    const missing = installed.filter((r) => !diskSet.has(r.slug));
    const missingBySource = new Map<SkillSource, string[]>();

    for (const record of missing) {
      const list = missingBySource.get(record.source) ?? [];
      list.push(record.slug);
      missingBySource.set(record.source, list);
    }

    for (const [source, slugs] of missingBySource) {
      this.db.markUninstalledBySlugs(slugs, source);
      changed = true;
      this.log(
        "info",
        `Marked ${slugs.length} ${source} skill(s) as uninstalled: ${slugs.join(", ")}`,
      );
    }

    return changed;
  }

  private syncUserDir(): boolean {
    if (!this.userSkillsDir || !existsSync(this.userSkillsDir)) {
      return false;
    }

    const diskSlugs = this.scanDirSlugs(this.userSkillsDir);
    if (diskSlugs === null) {
      this.log(
        "warn",
        "sync: user directory scan failed, skipping reconciliation",
      );
      return false;
    }
    const diskSet = new Set(diskSlugs);

    const installed = this.db
      .getAllInstalled()
      .filter((r) => r.source === "user");
    const installedSlugs = new Set(installed.map((r) => r.slug));

    // Disk has it, ledger doesn't -> record as user
    const added = diskSlugs.filter((slug) => !installedSlugs.has(slug));
    let changed = false;
    if (added.length > 0) {
      this.db.recordBulkInstall(added, "user");
      changed = true;
      this.log(
        "info",
        `Synced ${added.length} user skill(s) from disk: ${added.join(", ")}`,
      );
    }

    // Ledger has it, disk doesn't -> mark as uninstalled
    const missingSlugs = installed
      .filter((r) => !diskSet.has(r.slug))
      .map((r) => r.slug);
    if (missingSlugs.length > 0) {
      this.db.markUninstalledBySlugs(missingSlugs, "user");
      changed = true;
      this.log(
        "info",
        `Marked ${missingSlugs.length} user skill(s) as uninstalled: ${missingSlugs.join(", ")}`,
      );
    }

    return changed;
  }

  private syncWorkspaceDirs(): boolean {
    if (!this.openclawStateDir) return false;

    let changed = false;
    for (const botId of this.getWorkspaceBotIds()) {
      const wsSkillsDir = resolve(
        this.openclawStateDir,
        "agents",
        botId,
        "skills",
      );

      const diskSlugs = existsSync(wsSkillsDir)
        ? this.scanDirSlugs(wsSkillsDir)
        : [];
      if (diskSlugs === null) continue;

      const diskSet = new Set(diskSlugs);
      const ledgerWs = this.db.getInstalledByAgent(botId);
      const ledgerSlugs = new Set(ledgerWs.map((r) => r.slug));

      // Disk has it, ledger doesn't → record as workspace
      const added = diskSlugs.filter((slug) => !ledgerSlugs.has(slug));
      for (const slug of added) {
        this.db.recordInstall(slug, "workspace", undefined, botId);
      }
      if (added.length > 0) {
        changed = true;
        this.log(
          "info",
          `Agent ${botId}: synced ${added.length} workspace skill(s): ${added.join(", ")}`,
        );
      }

      // Ledger has it, disk doesn't → mark uninstalled
      const missingSlugs = ledgerWs
        .filter((r) => !diskSet.has(r.slug))
        .map((r) => r.slug);
      if (missingSlugs.length > 0) {
        this.db.markUninstalledBySlugs(missingSlugs, "workspace", botId);
        changed = true;
        this.log(
          "info",
          `Agent ${botId}: marked ${missingSlugs.length} workspace skill(s) as uninstalled`,
        );
      }
    }

    return changed;
  }

  start(): void {
    if (this.sharedWatcher !== null || this.workspaceWatcher !== null) {
      return;
    }

    if (!existsSync(this.skillsDir)) {
      this.log(
        "warn",
        `Skills directory does not exist, skipping watch: ${this.skillsDir}`,
      );
      return;
    }

    this.sharedWatcher = watch(
      this.skillsDir,
      { recursive: true },
      (_event, filename) => {
        if (filename?.endsWith("SKILL.md")) {
          this.scheduleSync();
        }
      },
    );

    this.sharedWatcher.on("error", (err: unknown) => {
      this.log(
        "error",
        `Shared watcher error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.log("info", `Watching skills directory: ${this.skillsDir}`);

    if (this.userSkillsDir && existsSync(this.userSkillsDir)) {
      this.userWatcher = watch(
        this.userSkillsDir,
        { recursive: true },
        (_event, filename) => {
          if (filename?.endsWith("SKILL.md")) {
            this.scheduleSync();
          }
        },
      );

      this.userWatcher.on("error", (err: unknown) => {
        this.log(
          "error",
          `User watcher error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      this.log("info", `Watching user skills directory: ${this.userSkillsDir}`);
    }

    if (this.openclawStateDir && existsSync(this.openclawStateDir)) {
      this.workspaceWatcher = watch(
        this.openclawStateDir,
        { recursive: true },
        (_event, filename) => {
          const normalized = filename?.replaceAll("\\", "/");
          if (
            normalized &&
            /(^|\/)agents\/[^/]+\/skills\/[^/]+(?:\/SKILL\.md)?$/.test(
              normalized,
            )
          ) {
            this.scheduleSync();
          }
        },
      );

      this.workspaceWatcher.on("error", (err: unknown) => {
        this.log(
          "error",
          `Workspace watcher error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      this.log(
        "info",
        `Watching workspace skill directories under: ${this.openclawStateDir}`,
      );
    }
  }

  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.sharedWatcher !== null) {
      this.sharedWatcher.close();
      this.sharedWatcher = null;
    }

    if (this.userWatcher !== null) {
      this.userWatcher.close();
      this.userWatcher = null;
    }

    if (this.workspaceWatcher !== null) {
      this.workspaceWatcher.close();
      this.workspaceWatcher = null;
    }
  }

  private scheduleSync(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.syncNow()) {
        this.onChange();
      }
    }, this.debounceMs);
  }

  private getWorkspaceBotIds(): readonly string[] {
    if (!this.openclawStateDir) {
      return this.botIds;
    }

    const botIds = new Set(this.botIds);
    for (const record of this.db.getAllInstalled()) {
      if (record.source === "workspace" && record.agentId) {
        botIds.add(record.agentId);
      }
    }

    const agentsDir = resolve(this.openclawStateDir, "agents");
    if (existsSync(agentsDir)) {
      const diskBotIds = this.scanDirEntries(agentsDir);
      for (const botId of diskBotIds) {
        botIds.add(botId);
      }
    }

    return [...botIds];
  }

  private scanDirSlugs(dir: string): string[] | null {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => existsSync(resolve(dir, entry.name, "SKILL.md")))
        .map((entry) => entry.name);
    } catch {
      return null;
    }
  }

  private scanDirEntries(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
