import type { ControllerEnv } from "../app/env.js";
import { CatalogManager } from "./skillhub/catalog-manager.js";
import { SkillDb } from "./skillhub/skill-db.js";

export class SkillhubService {
  private readonly catalogManager: CatalogManager;

  private constructor(catalogManager: CatalogManager) {
    this.catalogManager = catalogManager;
  }

  static async create(env: ControllerEnv): Promise<SkillhubService> {
    const skillDb = await SkillDb.create(env.skillDbPath);

    const catalogManager = new CatalogManager(env.skillhubCacheDir, {
      skillsDir: env.openclawSkillsDir,
      staticSkillsDir: env.staticSkillsDir,
      skillDb,
      log: (level, message) => {
        console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
      },
    });

    return new SkillhubService(catalogManager);
  }

  start(): void {
    this.catalogManager.start();
    if (process.env.CI) return;

    void this.catalogManager
      .installCuratedSkills()
      .then(() => {
        this.catalogManager.reconcileDbWithDisk();
        this.catalogManager.startSkillsWatcher();
      })
      .catch(() => {});
  }

  get catalog(): CatalogManager {
    return this.catalogManager;
  }

  dispose(): void {
    this.catalogManager.dispose();
  }
}
