import { existsSync } from "node:fs";
import type { ControllerEnv } from "../app/env.js";
import { CatalogManager } from "./skillhub/catalog-manager.js";
import {
  alignSkillName,
  copyStaticSkills,
  replaceLibtvVideoFromBundle,
  stripRequiresBins,
} from "./skillhub/curated-skills.js";
import { InstallQueue } from "./skillhub/install-queue.js";
import { SkillDb } from "./skillhub/skill-db.js";
import { SkillDirWatcher } from "./skillhub/skill-dir-watcher.js";
import type { QueueItem, SkillSource } from "./skillhub/types.js";
import { WorkspaceSkillScanner } from "./skillhub/workspace-skill-scanner.js";

export interface SkillhubServiceOptions {
  onSyncNeeded?: () => void;
  getBotIds?: () => Promise<readonly string[]>;
}

export type SkillUninstallRequest = {
  slug: string;
  source?: SkillSource;
  agentId?: string | null;
};

export class SkillhubService {
  private readonly catalogManager: CatalogManager;
  private readonly installQueue: InstallQueue;
  private readonly dirWatcher: SkillDirWatcher;
  private readonly db: SkillDb;
  private readonly env: ControllerEnv;
  private readonly scanner: WorkspaceSkillScanner;
  private readonly getBotIds: (() => Promise<readonly string[]>) | null;
  private readonly onSyncNeeded: (() => void) | null;

  private constructor(
    env: ControllerEnv,
    catalogManager: CatalogManager,
    installQueue: InstallQueue,
    dirWatcher: SkillDirWatcher,
    db: SkillDb,
    scanner: WorkspaceSkillScanner,
    getBotIds: (() => Promise<readonly string[]>) | null,
    onSyncNeeded: (() => void) | null,
  ) {
    this.env = env;
    this.catalogManager = catalogManager;
    this.installQueue = installQueue;
    this.dirWatcher = dirWatcher;
    this.db = db;
    this.scanner = scanner;
    this.getBotIds = getBotIds;
    this.onSyncNeeded = onSyncNeeded;
  }

  static async create(
    env: ControllerEnv,
    options?: SkillhubServiceOptions,
  ): Promise<SkillhubService> {
    const skillDb = await SkillDb.create(env.skillDbPath);
    const log = (level: "info" | "error" | "warn", message: string) => {
      console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
    };

    const catalogManager = new CatalogManager(env.skillhubCacheDir, {
      skillsDir: env.openclawSkillsDir,
      userSkillsDir: env.userSkillsDir,
      staticSkillsDir: env.staticSkillsDir,
      skillDb,
      log,
    });

    const installQueue = new InstallQueue({
      executor: async (slug) => {
        await catalogManager.executeInstall(slug);
        alignSkillName(env.openclawSkillsDir, slug);
        stripRequiresBins(env.openclawSkillsDir, slug);
      },
      onComplete: (slug, source) => {
        skillDb.recordInstall(slug, source);
      },
      onIdle: () => {
        options?.onSyncNeeded?.();
      },
      onCancelled: async (slug) => {
        const result = await catalogManager.uninstallSkill(slug);
        if (!result.ok) {
          throw new Error(result.error ?? `Cancel cleanup failed for ${slug}`);
        }
        options?.onSyncNeeded?.();
      },
      log,
    });

    const dirWatcher = new SkillDirWatcher({
      skillsDir: env.openclawSkillsDir,
      userSkillsDir: env.userSkillsDir,
      isSlugInFlight: (slug) => installQueue.isInFlight(slug),
      skillDb,
      log,
      openclawStateDir: env.openclawStateDir,
      onChange: () => {
        options?.onSyncNeeded?.();
      },
    });

    const workspaceScanner = new WorkspaceSkillScanner(env.openclawStateDir);

    return new SkillhubService(
      env,
      catalogManager,
      installQueue,
      dirWatcher,
      skillDb,
      workspaceScanner,
      options?.getBotIds ?? null,
      options?.onSyncNeeded ?? null,
    );
  }

  /**
   * Synchronise disk state with the ledger and copy bundled skills into the
   * skills directory.  Must run BEFORE the first OpenClaw config push so that
   * the compiled agent allowlist already contains every installed skill.
   *
   * Safe to call multiple times — every operation is idempotent.
   */
  bootstrap(): void {
    if (process.env.CI) return;
    this.dirWatcher.syncNow();
    this.initialize();
  }

  start(): void {
    this.catalogManager.start();
    if (process.env.CI) return;

    // Resolve bot IDs asynchronously and feed them to the dir watcher
    // so it can reconcile workspace skill directories on startup.
    if (this.getBotIds) {
      void this.getBotIds().then((ids) => {
        this.dirWatcher.setBotIds(ids);
        this.dirWatcher.syncNow();
      });
    }

    // bootstrap() already ran syncNow + initialize before the first config
    // push, but re-running here is harmless (idempotent) and catches any
    // skills that appeared between bootstrap() and start().
    this.dirWatcher.syncNow();
    this.initialize();

    // Always start watching for external skill changes (agent installs)
    this.dirWatcher.start();
  }

  /**
   * Copy static skills and enqueue missing curated skills.
   * Runs on every non-CI startup. Both operations are idempotent:
   * - copyStaticSkills skips when SKILL.md exists on disk OR slug is known in ledger
   * - getCuratedSlugsToEnqueue filters against all known slugs in ledger
   */
  private initialize(): void {
    // Step 1: Copy static bundled skills to skills dir + record in DB
    if (this.env.staticSkillsDir && existsSync(this.env.staticSkillsDir)) {
      const { copied } = copyStaticSkills({
        staticDir: this.env.staticSkillsDir,
        targetDir: this.env.openclawSkillsDir,
        skillDb: this.db,
      });
      if (copied.length > 0) {
        this.db.recordBulkInstall(copied, "managed");
      }

      // Step 1b: Force-refresh libtv-video on every boot so bundled
      // libtv-video updates (detached background waiter + direct
      // Feishu delivery) reach existing users on their next app boot.
      // copyStaticSkills' first-install-only semantics would otherwise
      // never refresh it. See replaceLibtvVideoFromBundle for rationale.
      replaceLibtvVideoFromBundle({
        staticDir: this.env.staticSkillsDir,
        targetDir: this.env.openclawSkillsDir,
        skillDb: this.db,
      });
    }

    // Step 2: Enqueue curated skills from ClawHub that aren't on disk yet
    const toEnqueue = this.catalogManager.getCuratedSlugsToEnqueue();
    for (const slug of toEnqueue) {
      const canonical = this.catalogManager.canonicalizeSlug(slug);
      this.installQueue.enqueue(canonical, "managed");
    }
  }

  get skillDb(): SkillDb {
    return this.db;
  }

  get workspaceSkillScanner(): WorkspaceSkillScanner {
    return this.scanner;
  }

  get catalog(): CatalogManager {
    return this.catalogManager;
  }

  get queue(): InstallQueue {
    return this.installQueue;
  }

  enqueueInstall(slug: string): QueueItem {
    const canonical = this.catalogManager.canonicalizeSlug(slug);
    return this.installQueue.enqueue(canonical, "managed");
  }

  cancelInstall(slug: string): boolean {
    const canonical = this.catalogManager.canonicalizeSlug(slug);
    return this.installQueue.cancel(canonical);
  }

  async uninstallSkill(
    request: SkillUninstallRequest,
  ): Promise<{ ok: boolean; error?: string }> {
    const canonical = this.catalogManager.canonicalizeSlug(request.slug);
    this.cancelInstall(canonical);
    const result = await this.catalogManager.uninstallSkill({
      ...request,
      slug: canonical,
    });
    if (result.ok) {
      this.dirWatcher.syncNow();
      if (this.getBotIds) {
        void this.getBotIds()
          .then((ids) => {
            this.dirWatcher.setBotIds(ids);
          })
          .catch(() => {});
      }
      this.onSyncNeeded?.();
    }

    return result;
  }

  dispose(): void {
    this.dirWatcher.stop();
    this.installQueue.dispose();
    this.catalogManager.dispose();
  }
}
