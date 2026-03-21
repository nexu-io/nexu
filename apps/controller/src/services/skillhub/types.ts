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

export type SkillSource = "curated" | "managed" | "custom";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
  installedAt: string | null;
};

export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  meta: CatalogMeta | null;
};
