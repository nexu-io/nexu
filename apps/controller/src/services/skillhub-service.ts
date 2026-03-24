import { existsSync } from "node:fs";
import type { ControllerEnv } from "../app/env.js";
import { CatalogManager } from "./skillhub/catalog-manager.js";
import { copyStaticSkills } from "./skillhub/curated-skills.js";
import { InstallQueue } from "./skillhub/install-queue.js";
import { SkillDb } from "./skillhub/skill-db.js";
import { SkillDirWatcher } from "./skillhub/skill-dir-watcher.js";
import type { QueueItem } from "./skillhub/types.js";

export class SkillhubService {
  private readonly catalogManager: CatalogManager;
  private readonly installQueue: InstallQueue;
  private readonly dirWatcher: SkillDirWatcher;
  private readonly db: SkillDb;
  private readonly env: ControllerEnv;
  private readonly isFirstLaunch: boolean;

  private constructor(
    env: ControllerEnv,
    catalogManager: CatalogManager,
    installQueue: InstallQueue,
    dirWatcher: SkillDirWatcher,
    db: SkillDb,
    isFirstLaunch: boolean,
  ) {
    this.env = env;
    this.catalogManager = catalogManager;
    this.installQueue = installQueue;
    this.dirWatcher = dirWatcher;
    this.db = db;
    this.isFirstLaunch = isFirstLaunch;
  }

  static async create(env: ControllerEnv): Promise<SkillhubService> {
    // Check if ledger exists BEFORE SkillDb.create() (which creates it)
    const isFirstLaunch = !existsSync(env.skillDbPath);

    const skillDb = await SkillDb.create(env.skillDbPath);
    const log = (level: "info" | "error" | "warn", message: string) => {
      console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
    };

    const catalogManager = new CatalogManager(env.skillhubCacheDir, {
      skillsDir: env.openclawSkillsDir,
      staticSkillsDir: env.staticSkillsDir,
      skillDb,
      log,
    });

    const installQueue = new InstallQueue({
      executor: async (slug) => {
        await catalogManager.executeInstall(slug);
      },
      onComplete: (slug, source) => {
        skillDb.recordInstall(slug, source);
      },
      onCancelled: async (slug) => {
        await catalogManager.uninstallSkill(slug);
      },
      log,
    });

    const dirWatcher = new SkillDirWatcher({
      skillsDir: env.openclawSkillsDir,
      isSlugInFlight: (slug) => installQueue.isInFlight(slug),
      skillDb,
      log,
    });

    return new SkillhubService(
      env,
      catalogManager,
      installQueue,
      dirWatcher,
      skillDb,
      isFirstLaunch,
    );
  }

  start(): void {
    this.catalogManager.start();
    if (process.env.CI) return;

    // Always reconcile disk state with ledger FIRST on every startup.
    // This ensures on-disk skills are recorded before curated enqueue
    // checks the ledger, preventing unnecessary re-downloads.
    this.dirWatcher.syncNow();

    if (this.isFirstLaunch) {
      this.initialize();
    }

    // Always start watching for external skill changes (agent installs)
    this.dirWatcher.start();
  }

  /**
   * First-launch initialization: copy static skills, enqueue curated skills.
   * Only runs when the skill ledger did not exist (fresh install or reinstall).
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
    }

    // Step 2: Enqueue curated skills from ClawHub that aren't on disk yet
    const toEnqueue = this.catalogManager.getCuratedSlugsToEnqueue();
    for (const slug of toEnqueue) {
      const canonical = this.catalogManager.canonicalizeSlug(slug);
      this.installQueue.enqueue(canonical, "managed");
    }
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

  dispose(): void {
    this.dirWatcher.stop();
    this.installQueue.dispose();
    this.catalogManager.dispose();
  }
}
