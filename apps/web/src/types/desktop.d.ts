export type SkillSource = "curated" | "managed" | "custom" | "workspace" | "user";

export type InstalledSkill = {
  slug: string;
  source: SkillSource;
  name: string;
  description: string;
  installedAt: string | null;
  agentId: string | null;
  agentName: string | null;
};

export type QueueItemStatus =
  | "queued"
  | "downloading"
  | "installing-deps"
  | "done"
  | "failed";

export type QueueErrorCode = "skill_not_found" | "rate_limit" | "unknown";

export type QueueItem = {
  readonly slug: string;
  readonly source: SkillSource;
  readonly status: QueueItemStatus;
  readonly position: number;
  readonly error?: string;
  readonly errorCode?: QueueErrorCode | null;
  readonly enqueuedAt: string;
};

export type SkillhubCatalogData = {
  skills: MinimalSkill[];
  installedSlugs: string[];
  installedSkills: InstalledSkill[];
  queue: QueueItem[];
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
