import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { logger } from "../lib/logger.js";
import { scanInstalledSkills } from "../lib/skill-scanner.js";
import type { AppBindings } from "../types.js";
import {
  resolveSkillhubPath,
  skillhubSlugSchema,
} from "./skillhub-route-helpers.js";

const execFileAsync = promisify(execFile);

const require = createRequire(import.meta.url);

function resolveClawHubBin(): string {
  const pkgPath = require.resolve("clawhub/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin?: Record<string, string>;
  };
  const binRel = pkg.bin?.clawhub ?? pkg.bin?.clawdhub ?? "bin/clawdhub.js";
  return resolve(dirname(pkgPath), binRel);
}

const VERSION_CHECK_URL =
  "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json";
const CATALOG_DOWNLOAD_URL =
  "https://skillhub-1251783334.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz";

const minimalSkillSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  downloads: z.number(),
  stars: z.number(),
  tags: z.array(z.string()),
  version: z.string(),
  updatedAt: z.string(),
});

const installedSkillSchema = z.object({
  slug: z.string(),
  source: z.enum(["curated", "managed"]),
  name: z.string(),
  description: z.string(),
});

const catalogMetaSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  skillCount: z.number(),
});

const skillhubCatalogResponseSchema = z.object({
  skills: z.array(minimalSkillSchema),
  installedSlugs: z.array(z.string()),
  installedSkills: z.array(installedSkillSchema),
  meta: catalogMetaSchema.nullable(),
});

const skillhubMutationResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const skillhubRefreshResultSchema = z.object({
  ok: z.boolean(),
  skillCount: z.number(),
  error: z.string().optional(),
});

const skillhubDetailResponseSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  downloads: z.number(),
  stars: z.number(),
  tags: z.array(z.string()),
  version: z.string(),
  updatedAt: z.string(),
  homepage: z.string(),
  installed: z.boolean(),
  skillContent: z.string().nullable(),
  files: z.array(z.string()),
});

const skillhubCatalogRoute = createRoute({
  method: "get",
  path: "/api/v1/skillhub/catalog",
  tags: ["SkillHub"],
  responses: {
    200: {
      content: {
        "application/json": { schema: skillhubCatalogResponseSchema },
      },
      description: "SkillHub community skill catalog",
    },
  },
});

const skillhubInstallRoute = createRoute({
  method: "post",
  path: "/api/v1/skillhub/install",
  tags: ["SkillHub"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ slug: skillhubSlugSchema }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: skillhubMutationResultSchema },
      },
      description: "Install result",
    },
  },
});

const skillhubUninstallRoute = createRoute({
  method: "post",
  path: "/api/v1/skillhub/uninstall",
  tags: ["SkillHub"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ slug: skillhubSlugSchema }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: skillhubMutationResultSchema },
      },
      description: "Uninstall result",
    },
  },
});

const skillhubRefreshRoute = createRoute({
  method: "post",
  path: "/api/v1/skillhub/refresh",
  tags: ["SkillHub"],
  responses: {
    200: {
      content: {
        "application/json": { schema: skillhubRefreshResultSchema },
      },
      description: "Refresh result",
    },
  },
});

const skillhubDetailRoute = createRoute({
  method: "get",
  path: "/api/v1/skillhub/skills/{slug}",
  tags: ["SkillHub"],
  request: {
    params: z.object({ slug: skillhubSlugSchema }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: skillhubDetailResponseSchema },
      },
      description: "Skill detail with SKILL.md content",
    },
    404: {
      content: {
        "application/json": { schema: z.object({ message: z.string() }) },
      },
      description: "Skill not found",
    },
  },
});

function getSkillsDir(): string | undefined {
  return process.env.OPENCLAW_SKILLS_DIR;
}

function getCacheDir(): string | undefined {
  return process.env.SKILLHUB_CACHE_DIR;
}

function getCuratedSkillsDir(): string | undefined {
  return process.env.OPENCLAW_CURATED_SKILLS_DIR;
}

type CuratedState = {
  removedByUser: string[];
  lastInstalledVersion: string[];
};

function getCuratedStatePath(curatedDir: string): string {
  return resolve(curatedDir, ".curated-state.json");
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readCatalog(cacheDir: string): z.infer<typeof minimalSkillSchema>[] {
  return (
    readJsonFile<z.infer<typeof minimalSkillSchema>[]>(
      resolve(cacheDir, "catalog.json"),
    ) ?? []
  );
}

function readMeta(cacheDir: string): z.infer<typeof catalogMetaSchema> | null {
  return readJsonFile<z.infer<typeof catalogMetaSchema>>(
    resolve(cacheDir, "meta.json"),
  );
}

function readCuratedState(curatedDir: string): CuratedState {
  return (
    readJsonFile<CuratedState>(getCuratedStatePath(curatedDir)) ?? {
      removedByUser: [],
      lastInstalledVersion: [],
    }
  );
}

function writeCuratedState(curatedDir: string, state: CuratedState): void {
  writeFileSync(
    getCuratedStatePath(curatedDir),
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

function recordCuratedRemoval(curatedDir: string, slug: string): void {
  const state = readCuratedState(curatedDir);
  if (state.removedByUser.includes(slug)) {
    return;
  }
  writeCuratedState(curatedDir, {
    ...state,
    removedByUser: [...state.removedByUser, slug],
  });
}

function findIndexFile(dir: string): string | null {
  const candidates = [
    "skills_index.local.json",
    "skills_index.json",
    "index.json",
    "catalog.json",
    "skills.json",
  ];

  try {
    const dirs = [dir];
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(resolve(dir, entry.name));
      }
    }

    for (const name of candidates) {
      for (const searchDir of dirs) {
        const path = resolve(searchDir, name);
        if (existsSync(path)) {
          return path;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildMinimalCatalog(extractDir: string) {
  const indexPath = findIndexFile(extractDir);

  if (!indexPath) {
    throw new Error("No index JSON found in extracted catalog archive");
  }

  const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;
  const raw: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        "skills" in parsed &&
        Array.isArray((parsed as { skills: unknown }).skills)
      ? (parsed as { skills: unknown[] }).skills
      : [];

  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => {
      const stats =
        typeof entry.stats === "object" && entry.stats !== null
          ? (entry.stats as Record<string, unknown>)
          : {};

      const updatedAtRaw = entry.updated_at ?? entry.updatedAt ?? "";
      const updatedAt =
        typeof updatedAtRaw === "number"
          ? new Date(updatedAtRaw).toISOString()
          : String(updatedAtRaw);

      return {
        slug: String(entry.slug ?? ""),
        name: String(entry.name ?? entry.slug ?? ""),
        description: String(entry.description ?? "").slice(0, 150),
        downloads: Number(stats.downloads ?? entry.downloads ?? 0),
        stars: Number(stats.stars ?? entry.stars ?? 0),
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        version: String(entry.version ?? "0.0.0"),
        updatedAt,
      };
    });
}

async function fetchRemoteVersion(): Promise<string> {
  const response = await fetch(VERSION_CHECK_URL);

  if (!response.ok) {
    throw new Error(`Version check failed: ${response.status}`);
  }

  const data = (await response.json()) as { version?: unknown };

  if (typeof data.version !== "string" || data.version.length === 0) {
    throw new Error("Version response missing version");
  }

  return data.version;
}

async function refreshCatalogCache(cacheDir: string) {
  mkdirSync(cacheDir, { recursive: true });

  const currentMeta = readMeta(cacheDir);
  const remoteVersion = await fetchRemoteVersion();
  if (currentMeta && currentMeta.version === remoteVersion) {
    return { ok: true as const, skillCount: currentMeta.skillCount };
  }

  const archivePath = resolve(cacheDir, "latest.tar.gz");
  const extractDir = resolve(cacheDir, ".extract-staging");
  const tempCatalogPath = resolve(cacheDir, ".catalog-next.json");

  try {
    const response = await fetch(CATALOG_DOWNLOAD_URL);

    if (!response.ok || !response.body) {
      throw new Error(`Catalog download failed: ${response.status}`);
    }

    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }

    writeFileSync(archivePath, Buffer.concat(chunks));

    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);

    const skills = buildMinimalCatalog(extractDir);
    writeFileSync(tempCatalogPath, JSON.stringify(skills), "utf8");
    renameSync(tempCatalogPath, resolve(cacheDir, "catalog.json"));
    writeFileSync(
      resolve(cacheDir, "meta.json"),
      JSON.stringify(
        {
          version: remoteVersion,
          updatedAt: new Date().toISOString(),
          skillCount: skills.length,
        } satisfies z.infer<typeof catalogMetaSchema>,
        null,
        2,
      ),
      "utf8",
    );

    return { ok: true as const, skillCount: skills.length };
  } finally {
    rmSync(archivePath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
    rmSync(tempCatalogPath, { force: true });
  }
}

export function registerSkillhubRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(skillhubCatalogRoute, async (c) => {
    const cacheDir = getCacheDir();

    if (!cacheDir) {
      return c.json(
        { skills: [], installedSlugs: [], installedSkills: [], meta: null },
        200,
      );
    }

    const skills = readCatalog(cacheDir);
    const meta = readMeta(cacheDir);
    const installedSkills = scanInstalledSkills({
      curatedDir: getCuratedSkillsDir(),
      managedDir: getSkillsDir(),
    });
    const installedSlugs = installedSkills.map((s) => s.slug);

    return c.json({ skills, installedSlugs, installedSkills, meta }, 200);
  });

  app.openapi(skillhubInstallRoute, async (c) => {
    const { slug } = c.req.valid("json");
    const skillsDir = getSkillsDir();

    logger.info({ slug, skillsDir }, "skillhub install requested");

    if (!skillsDir) {
      logger.error(
        { slug },
        "skillhub install failed: OPENCLAW_SKILLS_DIR not set",
      );
      return c.json(
        { ok: false, error: "Skills directory not configured" },
        200,
      );
    }

    try {
      const clawHubBin = resolveClawHubBin();
      logger.info({ slug, clawHubBin }, "skillhub install resolving clawhub");
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        clawHubBin,
        "--workdir",
        skillsDir,
        "--dir",
        ".",
        "install",
        slug,
        "--force",
      ]);
      if (stdout)
        logger.info({ slug, stdout: stdout.trim() }, "skillhub install stdout");
      if (stderr)
        logger.warn({ slug, stderr: stderr.trim() }, "skillhub install stderr");
      logger.info({ slug }, "skillhub install ok");
      return c.json({ ok: true }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ slug, error: message }, "skillhub install failed");
      return c.json({ ok: false, error: message }, 200);
    }
  });

  app.openapi(skillhubRefreshRoute, async (c) => {
    const cacheDir = getCacheDir();

    if (!cacheDir) {
      return c.json(
        { ok: false, skillCount: 0, error: "SkillHub cache not configured" },
        200,
      );
    }

    try {
      const result = await refreshCatalogCache(cacheDir);
      return c.json(result, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, skillCount: 0, error: message }, 200);
    }
  });

  app.openapi(skillhubUninstallRoute, async (c) => {
    const { slug } = c.req.valid("json");
    const skillsDir = getSkillsDir();
    const curatedDir = getCuratedSkillsDir();

    logger.info({ slug }, "skillhub uninstall requested");

    if (!skillsDir && !curatedDir) {
      logger.error(
        { slug },
        "skillhub uninstall failed: no skills dirs configured",
      );
      return c.json(
        { ok: false, error: "Skills directory not configured" },
        200,
      );
    }

    try {
      const managedPath = skillsDir
        ? resolveSkillhubPath(skillsDir, slug)
        : null;
      if (managedPath && existsSync(managedPath)) {
        rmSync(managedPath, { recursive: true, force: true });
        logger.info({ slug }, "skillhub uninstall ok (managed)");
        return c.json({ ok: true }, 200);
      }

      const curatedPath = curatedDir
        ? resolveSkillhubPath(curatedDir, slug)
        : null;
      if (curatedDir && curatedPath && existsSync(curatedPath)) {
        rmSync(curatedPath, { recursive: true, force: true });
        recordCuratedRemoval(curatedDir, slug);
        logger.info({ slug }, "skillhub uninstall ok (curated)");
        return c.json({ ok: true }, 200);
      }

      logger.warn({ slug }, "skillhub uninstall skipped: dir not found");
      return c.json({ ok: true }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ slug, error: message }, "skillhub uninstall failed");
      return c.json({ ok: false, error: message }, 200);
    }
  });

  app.openapi(skillhubDetailRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const cacheDir = getCacheDir();

    // Find catalog entry
    let catalogEntry: Record<string, unknown> | null = null;
    if (cacheDir) {
      const all = readJsonFile<Array<Record<string, unknown>>>(
        resolve(cacheDir, "catalog.json"),
      );
      catalogEntry = all?.find((s) => s.slug === slug) ?? null;
    }

    // Read SKILL.md if installed — check managed dir first, then curated dir
    let skillContent: string | null = null;
    let installed = false;
    let files: string[] = [];

    const dirsToCheck = [getSkillsDir(), getCuratedSkillsDir()].filter(
      Boolean,
    ) as string[];

    for (const dir of dirsToCheck) {
      const skillDir = resolveSkillhubPath(dir, slug);
      const skillMdPath = skillDir ? resolve(skillDir, "SKILL.md") : null;
      if (skillDir && skillMdPath && existsSync(skillMdPath)) {
        installed = true;
        skillContent = readFileSync(skillMdPath, "utf8");
        try {
          files = readdirSync(skillDir, { recursive: true })
            .map(String)
            .filter((f) => !f.startsWith(".clawhub") && f !== "_meta.json");
        } catch {
          // Ignore
        }
        break;
      }
    }

    if (!catalogEntry && !installed) {
      return c.json({ message: "Skill not found" }, 404);
    }

    const stats =
      catalogEntry &&
      typeof catalogEntry.stats === "object" &&
      catalogEntry.stats !== null
        ? (catalogEntry.stats as Record<string, unknown>)
        : {};

    // Parse frontmatter for name/description if no catalog entry
    let diskName = slug;
    let diskDescription = "";
    if (skillContent) {
      const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch?.[1]) {
        const nameMatch = fmMatch[1].match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
        const descMatch = fmMatch[1].match(
          /^description:\s*['"]?(.+?)['"]?\s*$/m,
        );
        if (nameMatch?.[1]) diskName = nameMatch[1].trim();
        if (descMatch?.[1]) diskDescription = descMatch[1].trim();
      }
    }

    return c.json(
      {
        slug,
        name: String(catalogEntry?.name ?? diskName),
        description: String(catalogEntry?.description ?? diskDescription),
        downloads: Number(stats.downloads ?? catalogEntry?.downloads ?? 0),
        stars: Number(stats.stars ?? catalogEntry?.stars ?? 0),
        tags: Array.isArray(catalogEntry?.tags) ? catalogEntry.tags : [],
        version: String(catalogEntry?.version ?? ""),
        updatedAt: String(
          catalogEntry?.updated_at ?? catalogEntry?.updatedAt ?? "",
        ),
        homepage: String(catalogEntry?.homepage ?? ""),
        installed,
        skillContent,
        files,
      },
      200,
    );
  });
}
