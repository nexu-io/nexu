import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { CatalogManager } from "./skillhub/catalog-manager.js";
import { SkillDb } from "./skillhub/skill-db.js";
import type { CatalogMeta, SkillhubCatalogData } from "./skillhub/types.js";

export class SkillhubService {
  private catalogManager: CatalogManager | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private initVersion = 0;

  constructor(private readonly env: ControllerEnv) {}

  start(): void {
    this.disposed = false;
    const initVersion = ++this.initVersion;
    this.initPromise = this.init(initVersion);
    this.initPromise.catch((err) => {
      console.error("[skillhub] init failed:", err);
    });
  }

  private async init(initVersion: number): Promise<void> {
    const skillDb = await SkillDb.create(this.env.skillDbPath);
    if (this.shouldAbort(initVersion)) {
      skillDb.close();
      return;
    }

    const catalogManager = new CatalogManager(this.env.skillhubCacheDir, {
      skillsDir: this.env.openclawSkillsDir,
      curatedSkillsDir: this.env.openclawCuratedSkillsDir,
      staticSkillsDir: this.env.staticSkillsDir,
      skillDb,
      log: (level, message) => {
        console[level === "error" ? "error" : "log"](`[skillhub] ${message}`);
      },
    });
    if (this.shouldAbort(initVersion)) {
      catalogManager.dispose();
      return;
    }

    this.catalogManager = catalogManager;
    catalogManager.start();
    if (this.shouldAbort(initVersion)) {
      this.disposeCatalogManager(catalogManager);
      return;
    }

    if (!process.env.CI) {
      await catalogManager.installCuratedSkills();
      if (this.shouldAbort(initVersion)) {
        this.disposeCatalogManager(catalogManager);
        return;
      }

      catalogManager.reconcileDbWithDisk();
    }
  }

  getCatalog(): SkillhubCatalogData {
    return this.catalogManager?.getCatalog() ?? this.readCachedCatalog();
  }

  async installSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
    return (await this.requireCatalogManager()).installSkill(slug);
  }

  async uninstallSkill(slug: string): Promise<{ ok: boolean; error?: string }> {
    return (await this.requireCatalogManager()).uninstallSkill(slug);
  }

  async refreshCatalog(): Promise<{ ok: boolean; skillCount: number }> {
    return (await this.requireCatalogManager()).refreshCatalog();
  }

  async waitForReady(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.initVersion += 1;
    this.disposeCatalogManager(this.catalogManager);
    this.initPromise = null;
  }

  private shouldAbort(initVersion: number): boolean {
    return this.disposed || initVersion !== this.initVersion;
  }

  private async requireCatalogManager(): Promise<CatalogManager> {
    await this.waitForReady();
    if (!this.catalogManager) {
      throw new Error("SkillhubService unavailable");
    }
    return this.catalogManager;
  }

  private disposeCatalogManager(catalogManager: CatalogManager | null): void {
    if (!catalogManager) {
      return;
    }
    if (this.catalogManager === catalogManager) {
      this.catalogManager = null;
    }
    catalogManager.dispose();
  }

  private readCachedCatalog(): SkillhubCatalogData {
    const skills = this.readCachedJson<SkillhubCatalogData["skills"]>(
      "catalog.json",
      [],
    );
    const meta = this.readCachedJson<CatalogMeta | null>("meta.json", null);

    return {
      skills,
      installedSlugs: [],
      installedSkills: [],
      meta,
    };
  }

  private readCachedJson<T>(fileName: string, fallback: T): T {
    try {
      const raw = readFileSync(
        resolve(this.env.skillhubCacheDir, fileName),
        "utf8",
      );
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
}
