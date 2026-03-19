export type SkillSource = "curated" | "managed";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
};

export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  meta: CatalogMeta | null;
};

export type MinimalSkill = {
  slug: string;
  name: string;
  description: string;
  downloads: number;
  stars: number;
  tags: string[];
  version: string;
  updatedAt: string;
};

export type CatalogMeta = {
  version: string;
  updatedAt: string;
  skillCount: number;
};

export type NexuDesktopBridge = {
  skillhub: {
    getCatalog: () => Promise<SkillhubCatalogData>;
    install: (slug: string) => Promise<{ ok: boolean; error?: string }>;
    uninstall: (slug: string) => Promise<{ ok: boolean; error?: string }>;
    refreshCatalog: () => Promise<{ ok: boolean; skillCount: number }>;
  };
};

declare global {
  interface Window {
    nexuDesktop?: NexuDesktopBridge;
  }
}
