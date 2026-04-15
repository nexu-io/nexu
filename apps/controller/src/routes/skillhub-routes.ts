import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const DEFAULT_DOWNLOAD_COUNT = 1000;

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
  source: z.enum(["managed", "custom", "workspace", "user"]),
  name: z.string(),
  description: z.string(),
  installedAt: z.string().nullable(),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
});

const catalogMetaSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  skillCount: z.number(),
});

const queueItemSchema = z.object({
  slug: z.string(),
  source: z.enum(["managed", "custom", "workspace", "user"]),
  status: z.enum([
    "queued",
    "downloading",
    "installing-deps",
    "done",
    "failed",
  ]),
  position: z.number(),
  error: z.string().nullable(),
  errorCode: z.enum(["skill_not_found", "rate_limit", "unknown"]).nullable(),
  retries: z.number(),
  enqueuedAt: z.string(),
});

const skillhubCatalogResponseSchema = z.object({
  skills: z.array(minimalSkillSchema),
  installedSlugs: z.array(z.string()),
  installedSkills: z.array(installedSkillSchema),
  meta: catalogMetaSchema.nullable(),
  queue: z.array(queueItemSchema),
});

const skillhubMutationResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const skillhubSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const skillhubSourceSchema = z.enum(["managed", "custom", "workspace", "user"]);
const skillhubUninstallRequestSchema = z
  .object({
    slug: skillhubSlugSchema,
    source: skillhubSourceSchema.optional(),
    agentId: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === "workspace" && !value.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agentId"],
        message: "agentId is required for workspace uninstall",
      });
    }
  });

const skillhubInstallResultSchema = z.object({
  ok: z.boolean(),
  queued: z.boolean().optional(),
  slug: z.string().optional(),
  status: z
    .enum(["queued", "downloading", "installing-deps", "done", "failed"])
    .optional(),
  position: z.number().optional(),
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
  installedSource: skillhubSourceSchema.nullable(),
  agentId: z.string().nullable(),
  uninstallable: z.boolean(),
  skillContent: z.string().nullable(),
  files: z.array(z.string()),
});

const skillhubImportResultSchema = z.object({
  ok: z.boolean(),
  slug: z.string().optional(),
  error: z.string().optional(),
});

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
      const queue = [...container.skillhubService.queue.getQueue()];
      const bots = await container.configStore.listBots();
      const botNameMap = new Map(bots.map((b) => [b.id, b.name]));

      const installedSkills = catalog.installedSkills.map((skill) => ({
        ...skill,
        agentName: skill.agentId
          ? (botNameMap.get(skill.agentId) ?? null)
          : null,
      }));

      return c.json({ ...catalog, installedSkills, queue }, 200);
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
              schema: skillhubUninstallRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubInstallResultSchema },
          },
          description: "Install",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      const queueItem = container.skillhubService.enqueueInstall(slug);
      return c.json(
        {
          ok: true,
          queued: true,
          slug: queueItem.slug,
          status: queueItem.status,
          position: queueItem.position,
        },
        200,
      );
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
              schema: z.object({
                slug: skillhubSlugSchema,
                source: z
                  .enum(["managed", "custom", "workspace", "user"])
                  .optional(),
                agentId: z.string().nullable().optional(),
              }),
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
      const request = c.req.valid("json");
      const result = await container.skillhubService.uninstallSkill(request);
      if (result.ok) {
        await container.openclawSyncService.syncAll();
      }
      return c.json(result, 200);
    },
  );

  // POST /api/v1/skillhub/cancel
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/cancel",
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
            "application/json": {
              schema: z.object({
                ok: z.boolean(),
                cancelled: z.boolean(),
              }),
            },
          },
          description: "Cancel or dismiss a queued / failed install",
        },
      },
    }),
    async (c) => {
      const { slug } = c.req.valid("json");
      const cancelled = container.skillhubService.cancelInstall(slug);
      return c.json({ ok: true, cancelled }, 200);
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
      request: {
        params: z.object({ slug: skillhubSlugSchema }),
        query: z
          .object({
            source: skillhubSourceSchema.optional(),
            agentId: z.string().optional(),
          })
          .superRefine((value, ctx) => {
            if (value.source === "workspace" && !value.agentId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["agentId"],
                message: "agentId is required for workspace skill detail",
              });
            }
          }),
      },
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
      const query = c.req.valid("query");
      const catalog = container.skillhubService.catalog.getCatalog();
      const catalogSkill = catalog.skills.find((s) => s.slug === slug);
      const matchingInstalledSkills = catalog.installedSkills.filter(
        (s) => s.slug === slug,
      );
      const installedSkill = query.source
        ? matchingInstalledSkills.find(
            (skill) =>
              skill.source === query.source &&
              (query.source !== "workspace" || skill.agentId === query.agentId),
          )
        : matchingInstalledSkills.length === 1
          ? matchingInstalledSkills[0]
          : matchingInstalledSkills.find(
              (skill) => skill.source !== "workspace",
            );
      const installed =
        query.source || matchingInstalledSkills.length <= 1
          ? Boolean(installedSkill)
          : matchingInstalledSkills.length > 0;

      if (!catalogSkill && !installedSkill) {
        return c.json({ message: "Skill not found" }, 404);
      }

      const isCustom = installedSkill?.source === "custom";
      const rawDownloads = catalogSkill?.downloads ?? 0;
      const downloads = isCustom
        ? 0
        : rawDownloads > 0
          ? rawDownloads
          : DEFAULT_DOWNLOAD_COUNT;

      return c.json(
        {
          slug,
          name: catalogSkill?.name ?? installedSkill?.name ?? slug,
          description:
            catalogSkill?.description ?? installedSkill?.description ?? "",
          downloads,
          stars: catalogSkill?.stars ?? 0,
          tags: catalogSkill?.tags ?? [],
          version: catalogSkill?.version ?? "1.0.0",
          updatedAt: catalogSkill?.updatedAt ?? new Date().toISOString(),
          installed,
          installedSource: installedSkill?.source ?? null,
          agentId: installedSkill?.agentId ?? null,
          uninstallable: Boolean(
            installedSkill &&
              (installedSkill.source !== "workspace" || installedSkill.agentId),
          ),
          skillContent: null,
          files: [],
        },
        200,
      );
    },
  );

  // POST /api/v1/skillhub/import
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/skillhub/import",
      tags: ["SkillHub"],
      request: {
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.instanceof(File),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: skillhubImportResultSchema },
          },
          description: "Import result",
        },
        400: {
          content: {
            "application/json": {
              schema: z.object({
                ok: z.literal(false),
                error: z.string(),
              }),
            },
          },
          description: "Bad request",
        },
      },
    }),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;

      if (!(file instanceof File)) {
        return c.json(
          { ok: false as const, error: "No zip file provided" },
          400,
        );
      }

      if (!file.name.endsWith(".zip")) {
        return c.json(
          { ok: false as const, error: "Only .zip files are accepted" },
          400,
        );
      }

      const maxSize = 50 * 1024 * 1024; // 50 MB
      if (file.size > maxSize) {
        return c.json(
          { ok: false as const, error: "Zip file too large (max 50 MB)" },
          400,
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const result =
        await container.skillhubService.catalog.importSkillZip(buffer);

      if (result.ok) {
        await container.openclawSyncService.syncAll();
      }

      return c.json(result, 200);
    },
  );
}
