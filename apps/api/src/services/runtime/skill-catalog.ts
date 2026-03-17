export interface CatalogSkill {
  description: string;
  longDescription?: string;
  tag: string;
  icon: string;
  source: string;
  examples?: string[];
  prompt: string;
  requires?: { tools?: string[]; plugins?: string[] };
  path: string;
}

export interface SkillCatalog {
  version: number;
  skills: Record<string, CatalogSkill>;
}

export interface SkillRepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

interface CatalogCacheEntry {
  readonly catalog: SkillCatalog;
  readonly fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

let cachedEntry: CatalogCacheEntry | null = null;

export function getSkillRepoConfig(): SkillRepoConfig {
  const repoSlug = process.env.NEXU_SKILL_REPO ?? "nexu-app/nexu-skills";
  const branch = process.env.NEXU_SKILL_REPO_BRANCH ?? "main";

  const parts = repoSlug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid NEXU_SKILL_REPO format: "${repoSlug}". Expected "owner/repo".`,
    );
  }

  return { owner: parts[0], repo: parts[1], branch };
}

function buildRawUrl(config: SkillRepoConfig): string {
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/skills.json`;
}

export async function fetchSkillCatalog(): Promise<SkillCatalog> {
  const now = Date.now();

  if (cachedEntry && now - cachedEntry.fetchedAt < CACHE_TTL_MS) {
    return cachedEntry.catalog;
  }

  const config = getSkillRepoConfig();
  const url = buildRawUrl(config);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `GitHub responded with ${response.status}: ${response.statusText}`,
      );
    }

    const catalog = (await response.json()) as SkillCatalog;

    cachedEntry = { catalog, fetchedAt: Date.now() };

    return catalog;
  } catch (error) {
    if (cachedEntry) {
      return cachedEntry.catalog;
    }
    throw error instanceof Error
      ? error
      : new Error("Failed to fetch skill catalog", { cause: error });
  }
}

export function invalidateCatalogCache(): void {
  cachedEntry = null;
}
