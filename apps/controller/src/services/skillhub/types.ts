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

export type SkillSource = "managed" | "custom" | "workspace" | "user";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
  installedAt: string | null;
  agentId: string | null;
};

export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  meta: CatalogMeta | null;
};

export type QueueItemStatus =
  | "queued"
  | "downloading"
  | "installing-deps"
  | "done"
  | "failed";

export type QueueErrorCode =
  | "skill_not_found"
  | "rate_limit"
  | "npm_missing"
  | "deps_install_failed"
  | "unknown";

export type QueueItem = {
  readonly slug: string;
  readonly source: SkillSource;
  readonly status: QueueItemStatus;
  readonly position: number;
  readonly error: string | null;
  readonly errorCode: QueueErrorCode | null;
  readonly retries: number;
  readonly enqueuedAt: string;
};
