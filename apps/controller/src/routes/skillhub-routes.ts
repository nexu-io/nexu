import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

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
  installed: z.boolean(),
  skillContent: z.string().nullable(),
  files: z.array(z.string()),
});

const skillhubSlugSchema = z.string().min(1);

export function registerSkillhubRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  // GET /api/v1/skillhub/catalog
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skillhub/catalog",
      tags: ["SkillHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubCatalogResponseSchema },
          },
          description: "SkillHub catalog",
        },
      },
    }),
    async (c) => {
      const catalog = container.skillhubService.catalog.getCatalog();
      return c.json(catalog, 200);
    },
  );

  // POST /api/v1/skillhub/install
  app.openapi(
    createRoute({
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
          description: "Install",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      const result = await container.skillhubService.catalog.installSkill(slug);
      return c.json(result, 200);
    },
  );

  // POST /api/v1/skillhub/uninstall
  app.openapi(
    createRoute({
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
          description: "Uninstall",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      const result =
        await container.skillhubService.catalog.uninstallSkill(slug);
      return c.json(result, 200);
    },
  );

  // POST /api/v1/skillhub/refresh
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/refresh",
      tags: ["SkillHub"],
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubRefreshResultSchema },
          },
          description: "Refresh",
        },
      },
    }),
    async (c) => {
      const result = await container.skillhubService.catalog.refreshCatalog();
      return c.json(result, 200);
    },
  );

  // GET /api/v1/skillhub/skills/{slug}
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skillhub/skills/{slug}",
      tags: ["SkillHub"],
      request: { params: z.object({ slug: skillhubSlugSchema }) },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubDetailResponseSchema },
          },
          description: "Skill detail",
        },
        404: {
          content: {
            "application/json": { schema: z.object({ message: z.string() }) },
          },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("param");
      const catalog = container.skillhubService.catalog.getCatalog();
      const catalogSkill = catalog.skills.find((s) => s.slug === slug);
      const installed = catalog.installedSlugs.includes(slug);
      const installedSkill = catalog.installedSkills.find(
        (s) => s.slug === slug,
      );

      if (!catalogSkill && !installedSkill) {
        return c.json({ message: "Skill not found" }, 404);
      }

      return c.json(
        {
          slug,
          name: catalogSkill?.name ?? installedSkill?.name ?? slug,
          description:
            catalogSkill?.description ?? installedSkill?.description ?? "",
          downloads: catalogSkill?.downloads ?? 0,
          stars: catalogSkill?.stars ?? 0,
          tags: catalogSkill?.tags ?? [],
          version: catalogSkill?.version ?? "1.0.0",
          updatedAt: catalogSkill?.updatedAt ?? new Date().toISOString(),
          installed,
          skillContent: null,
          files: [],
        },
        200,
      );
    },
  );
}
