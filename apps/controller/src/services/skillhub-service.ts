import type { ControllerEnv } from "../app/env.js";
import { CatalogManager } from "./skillhub/catalog-manager.js";
import { SkillDb } from "./skillhub/skill-db.js";

export class SkillhubService {
  private readonly catalogManager: CatalogManager;

  constructor(env: ControllerEnv) {
    let skillDb: SkillDb | undefined;
    try {
      skillDb = new SkillDb(env.skillDbPath);
    } catch {
      // SQLite native addon may fail — degrade gracefully
    }

    this.catalogManager = new CatalogManager(env.skillhubCacheDir, {
      skillsDir: env.openclawSkillsDir,
      curatedSkillsDir: env.openclawCuratedSkillsDir,
      staticSkillsDir: env.staticSkillsDir,
      skillDb,
      log: (level, message) => {
        console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
      },
    });
  }

  start(): void {
    this.catalogManager.start();
    if (process.env.CI) return;
    void this.catalogManager.installCuratedSkills().catch(() => {});
  }

  get catalog(): CatalogManager {
    return this.catalogManager;
  }

  dispose(): void {
    this.catalogManager.dispose();
  }
}
