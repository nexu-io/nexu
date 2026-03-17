import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  runtimeSkillsResponseSchema,
  skillDetailResponseSchema,
  skillListResponseSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  integrationCredentials,
  skills,
  supportedSkills,
  supportedToolkits,
  userIntegrations,
} from "../db/schema/index.js";
import { requireInternalToken } from "../middleware/internal-auth.js";
import type { SkillCatalog } from "../services/runtime/skill-catalog.js";
import {
  getLatestSkillsSnapshot,
  publishSkillsSnapshot,
} from "../services/runtime/skills-service.js";
import type { AppBindings } from "../types.js";

const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Pre-downloaded icons stored in apps/web/public/toolkit-icons/
// 34 SVGs from Composio CDN, 1 PNG from Google S2 (jina)
const PNG_ICON_SLUGS = new Set(["jina", "excel"]);

function getToolkitIconUrl(slug: string): string {
  const ext = PNG_ICON_SLUGS.has(slug) ? "png" : "svg";
  return `/toolkit-icons/${slug}.${ext}`;
}

function getToolkitFallbackIconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

const errorResponseSchema = z.object({
  message: z.string(),
});

const skillNameParam = z.object({
  name: z.string(),
});

const putSkillBodySchema = z.object({
  content: z.string().min(1),
  files: z.record(z.string()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const putSkillResponseSchema = z.object({
  ok: z.boolean(),
  name: z.string(),
  version: z.number().int().nonnegative(),
});

const getLatestSkillsRoute = createRoute({
  method: "get",
  path: "/api/internal/skills/latest",
  tags: ["Internal"],
  responses: {
    200: {
      content: { "application/json": { schema: runtimeSkillsResponseSchema } },
      description: "Latest skills snapshot",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Unauthorized",
    },
  },
});

const putSkillRoute = createRoute({
  method: "put",
  path: "/api/internal/skills/{name}",
  tags: ["Internal"],
  request: {
    params: skillNameParam,
    body: {
      content: { "application/json": { schema: putSkillBodySchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: putSkillResponseSchema } },
      description: "Skill upserted",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid name or body",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Unauthorized",
    },
  },
});

export function registerSkillRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getLatestSkillsRoute, async (c) => {
    requireInternalToken(c);

    const snapshot = await getLatestSkillsSnapshot(db);
    return c.json(
      {
        version: snapshot.version,
        skillsHash: snapshot.skillsHash,
        skills: snapshot.skills,
        createdAt: snapshot.createdAt,
      },
      200,
    );
  });

  app.openapi(putSkillRoute, async (c) => {
    requireInternalToken(c);

    const { name } = c.req.valid("param");
    const body = c.req.valid("json");

    if (!SKILL_NAME_REGEX.test(name)) {
      return c.json({ message: `Invalid skill name: ${name}` }, 400);
    }

    const now = new Date().toISOString();
    const status = body.status ?? "active";

    const filesMap: Record<string, string> = body.files
      ? { ...body.files }
      : {};
    filesMap["SKILL.md"] = body.content;
    const filesJson = JSON.stringify(filesMap);

    await db
      .insert(skills)
      .values({
        id: createId(),
        name,
        content: body.content,
        files: filesJson,
        status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: skills.name,
        set: {
          content: body.content,
          files: filesJson,
          status,
          updatedAt: now,
        },
      });

    const snapshot = await publishSkillsSnapshot(db);
    return c.json({ ok: true, name, version: snapshot.version }, 200);
  });
}

// --- Skills Catalog (public, behind auth middleware) ---

const TAG_LABELS: Record<string, string> = {
  "office-collab": "Office & Collaboration",
  "file-knowledge": "Files & Knowledge",
  "creative-design": "Creative & Design",
  "biz-analysis": "Business Analysis",
  "av-generation": "Audio & Video",
  "info-content": "Info & Content",
  "dev-tools": "Dev Tools",
};

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

const listSkillsRoute = createRoute({
  method: "get",
  path: "/api/v1/skills",
  tags: ["Skills"],
  responses: {
    200: {
      content: {
        "application/json": { schema: skillListResponseSchema },
      },
      description: "List of available skills",
    },
  },
});

const skillSlugParam = z.object({
  slug: z.string(),
});

const getSkillDetailRoute = createRoute({
  method: "get",
  path: "/api/v1/skills/{slug}",
  tags: ["Skills"],
  request: {
    params: skillSlugParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: skillDetailResponseSchema },
      },
      description: "Skill detail with tool auth status",
    },
    404: {
      content: {
        "application/json": { schema: z.object({ message: z.string() }) },
      },
      description: "Skill not found",
    },
  },
});

export function registerSkillCatalogRoutes(app: OpenAPIHono<AppBindings>) {
  // --------------------------------------------------------------------------
  // File-based skill listing (replaces DB-backed supportedSkills query)
  // --------------------------------------------------------------------------
  app.openapi(listSkillsRoute, async (c) => {
    const { resolveSkillsDir, scanInstalledSkills } = await import(
      "../services/runtime/skill-scanner.js"
    );
    const { fetchSkillCatalog } = await import(
      "../services/runtime/skill-catalog.js"
    );

    const skillsDir = resolveSkillsDir();
    const [installedSkills, catalogResult] = await Promise.all([
      scanInstalledSkills(skillsDir),
      fetchSkillCatalog().catch(
        (): SkillCatalog => ({ version: 0, skills: {} }),
      ),
    ]);

    const installedByName = new Map(installedSkills.map((s) => [s.name, s]));

    type SkillTag =
      | "office-collab"
      | "file-knowledge"
      | "creative-design"
      | "biz-analysis"
      | "av-generation"
      | "info-content"
      | "dev-tools";

    const VALID_TAGS = new Set(Object.keys(TAG_LABELS));
    const toTag = (t: string): SkillTag =>
      VALID_TAGS.has(t) ? (t as SkillTag) : "dev-tools";
    const toSource = (s: string) =>
      s === "official" || s === "custom" || s === "community"
        ? (s as "official" | "custom" | "community")
        : ("custom" as const);

    const tagCounts: Record<string, number> = {};
    const skills: Array<{
      slug: string;
      name: string;
      description: string;
      longDescription?: string;
      iconName: string;
      prompt: string;
      examples?: string[];
      tag: SkillTag;
      source: "official" | "custom" | "community";
      githubUrl?: string;
      installed?: boolean;
      updatable?: boolean;
    }> = [];

    // Catalog skills (mark installed if found locally)
    for (const [slug, cs] of Object.entries(catalogResult.skills)) {
      const isInstalled = installedByName.has(slug);
      const tag = toTag(cs.tag);
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      skills.push({
        slug,
        name: slug,
        description: cs.description,
        longDescription: cs.longDescription,
        iconName: cs.icon || "Sparkles",
        prompt: cs.prompt,
        examples: cs.examples?.length ? [...cs.examples] : undefined,
        tag,
        source: toSource(cs.source),
        installed: isInstalled,
        updatable: false,
      });
      installedByName.delete(slug);
    }

    // Local-only skills (not in catalog)
    for (const local of installedByName.values()) {
      const tag = toTag(local.tag);
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      skills.push({
        slug: local.name,
        name: local.name,
        description: local.description,
        longDescription: local.longDescription,
        iconName: local.icon || "Sparkles",
        prompt: local.prompt,
        examples: local.examples?.length ? [...local.examples] : undefined,
        tag,
        source: "custom",
        installed: true,
        updatable: false,
      });
    }

    const tags = Object.entries(TAG_LABELS).map(([id, label]) => ({
      id: id as SkillTag,
      label,
      count: tagCounts[id] ?? 0,
    }));

    return c.json({ skills, tags }, 200);
  });

  const mapStatus = (
    dbStatus: string | undefined,
  ): "connected" | "not_connected" | "initiated" | "expired" => {
    if (dbStatus === "active") return "connected";
    if (dbStatus === "initiated") return "initiated";
    if (dbStatus === "expired") return "expired";
    return "not_connected";
  };

  app.openapi(getSkillDetailRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const userId = c.get("userId");

    const [skillRow] = await db
      .select()
      .from(supportedSkills)
      .where(
        and(eq(supportedSkills.slug, slug), eq(supportedSkills.enabled, true)),
      )
      .limit(1);

    if (!skillRow) {
      return c.json({ message: "Skill not found" }, 404);
    }

    const toolkitSlugs = parseJsonArray(skillRow.toolkitSlugs);

    let tools:
      | Array<{
          slug: string;
          name: string;
          provider: string;
          iconUrl: string;
          fallbackIconUrl: string;
          authScheme: string;
          status: "connected" | "not_connected" | "initiated" | "expired";
          integrationId?: string;
        }>
      | undefined;

    if (toolkitSlugs.length > 0) {
      const toolkitRows = await db
        .select()
        .from(supportedToolkits)
        .where(inArray(supportedToolkits.slug, toolkitSlugs));

      const integrationMap = new Map<string, { status: string; id: string }>();

      if (userId) {
        const integrationRows = await db
          .select({
            toolkitSlug: userIntegrations.toolkitSlug,
            status: userIntegrations.status,
            id: userIntegrations.id,
          })
          .from(userIntegrations)
          .where(
            and(
              eq(userIntegrations.userId, userId),
              inArray(userIntegrations.toolkitSlug, toolkitSlugs),
            ),
          );

        for (const row of integrationRows) {
          integrationMap.set(row.toolkitSlug, {
            status: row.status ?? "pending",
            id: row.id,
          });
        }
      }

      // Check global credentials for api_key_global toolkits
      const globalToolkitSlugs = toolkitRows
        .filter((tk) => tk.authScheme === "api_key_global")
        .map((tk) => tk.slug);

      for (const gSlug of globalToolkitSlugs) {
        const [globalCred] = await db
          .select({ pk: integrationCredentials.pk })
          .from(integrationCredentials)
          .where(eq(integrationCredentials.integrationId, `global:${gSlug}`))
          .limit(1);
        if (globalCred) {
          integrationMap.set(gSlug, {
            status: "active",
            id: `global:${gSlug}`,
          });
        }
      }

      tools = toolkitRows.map((tk) => {
        const integration = integrationMap.get(tk.slug);
        return {
          slug: tk.slug,
          name: tk.displayName,
          provider: tk.domain,
          iconUrl: getToolkitIconUrl(tk.slug),
          fallbackIconUrl: getToolkitFallbackIconUrl(tk.domain),
          authScheme: tk.authScheme,
          status: mapStatus(integration?.status),
          integrationId: integration?.id,
        };
      });

      if (tools.length === 0) {
        tools = undefined;
      }
    }

    // Find related skills (same tag, enabled, excluding current)
    const relatedRows = await db
      .select()
      .from(supportedSkills)
      .where(
        and(
          eq(supportedSkills.tag, skillRow.tag),
          eq(supportedSkills.enabled, true),
        ),
      )
      .orderBy(supportedSkills.sortOrder)
      .limit(7);

    const filteredRelated = relatedRows
      .filter((r) => r.slug !== slug)
      .slice(0, 6);

    let relatedSkills:
      | Array<{
          slug: string;
          name: string;
          description: string;
          longDescription?: string;
          iconName: string;
          prompt: string;
          examples?: string[];
          tag:
            | "office-collab"
            | "file-knowledge"
            | "creative-design"
            | "biz-analysis"
            | "av-generation"
            | "info-content"
            | "dev-tools";
          source: "official" | "custom";
          tools?: Array<{
            slug: string;
            name: string;
            provider: string;
            iconUrl: string;
            fallbackIconUrl: string;
          }>;
          githubUrl?: string;
        }>
      | undefined;

    if (filteredRelated.length > 0) {
      // Collect all toolkit slugs from related skills
      const allRelatedToolkitSlugs = new Set<string>();
      for (const r of filteredRelated) {
        for (const ts of parseJsonArray(r.toolkitSlugs)) {
          allRelatedToolkitSlugs.add(ts);
        }
      }

      const relatedToolkitMap = new Map<
        string,
        { displayName: string; domain: string }
      >();

      if (allRelatedToolkitSlugs.size > 0) {
        const relatedToolkitRows = await db
          .select({
            slug: supportedToolkits.slug,
            displayName: supportedToolkits.displayName,
            domain: supportedToolkits.domain,
          })
          .from(supportedToolkits)
          .where(inArray(supportedToolkits.slug, [...allRelatedToolkitSlugs]));

        for (const tk of relatedToolkitRows) {
          relatedToolkitMap.set(tk.slug, {
            displayName: tk.displayName,
            domain: tk.domain,
          });
        }
      }

      relatedSkills = filteredRelated.map((r) => {
        const rToolkitSlugs = parseJsonArray(r.toolkitSlugs);
        const rTools = rToolkitSlugs
          .map((ts) => {
            const tk = relatedToolkitMap.get(ts);
            return tk
              ? {
                  slug: ts,
                  name: tk.displayName,
                  provider: tk.domain,
                  iconUrl: getToolkitIconUrl(ts),
                  fallbackIconUrl: getToolkitFallbackIconUrl(tk.domain),
                }
              : null;
          })
          .filter(
            (
              t,
            ): t is {
              slug: string;
              name: string;
              provider: string;
              iconUrl: string;
              fallbackIconUrl: string;
            } => t !== null,
          );

        const rExamples = parseJsonArray(r.examples);

        // Derive related skill icon from its first toolkit
        const rFirstSlug = rToolkitSlugs[0];
        const rFirstTk = rFirstSlug
          ? relatedToolkitMap.get(rFirstSlug)
          : undefined;

        return {
          slug: r.slug,
          name: r.name,
          description: r.description,
          longDescription: r.longDescription ?? undefined,
          iconName: r.iconName,
          iconUrl: rFirstSlug ? getToolkitIconUrl(rFirstSlug) : undefined,
          fallbackIconUrl: rFirstTk
            ? getToolkitFallbackIconUrl(rFirstTk.domain)
            : undefined,
          prompt: r.prompt,
          examples: rExamples.length > 0 ? rExamples : undefined,
          tag: r.tag as
            | "office-collab"
            | "file-knowledge"
            | "creative-design"
            | "biz-analysis"
            | "av-generation"
            | "info-content"
            | "dev-tools",
          source: r.source as "official" | "custom",
          tools: rTools.length > 0 ? rTools : undefined,
          githubUrl: r.githubUrl ?? undefined,
        };
      });
    }

    const examples = parseJsonArray(skillRow.examples);

    // Derive skill icon from the first linked toolkit
    const firstToolkitSlug = toolkitSlugs[0];
    let skillIconUrl: string | undefined;
    let skillFallbackIconUrl: string | undefined;
    if (firstToolkitSlug) {
      skillIconUrl = getToolkitIconUrl(firstToolkitSlug);
      const firstTk = tools?.find((t) => t.slug === firstToolkitSlug);
      if (firstTk) {
        skillFallbackIconUrl = getToolkitFallbackIconUrl(firstTk.provider);
      }
    }

    return c.json(
      {
        slug: skillRow.slug,
        name: skillRow.name,
        description: skillRow.description,
        longDescription: skillRow.longDescription ?? undefined,
        iconName: skillRow.iconName,
        iconUrl: skillIconUrl,
        fallbackIconUrl: skillFallbackIconUrl,
        prompt: skillRow.prompt,
        examples: examples.length > 0 ? examples : undefined,
        tag: skillRow.tag as
          | "office-collab"
          | "file-knowledge"
          | "creative-design"
          | "biz-analysis"
          | "av-generation"
          | "info-content"
          | "dev-tools",
        source: skillRow.source as "official" | "custom",
        tools,
        githubUrl: skillRow.githubUrl ?? undefined,
        relatedSkills,
      },
      200,
    );
  });
}
