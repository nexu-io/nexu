import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { runtimeWorkspaceTemplatesResponseSchema } from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { db } from "../db/index.js";
import { workspaceTemplates } from "../db/schema/index.js";
import { requireInternalToken } from "../middleware/internal-auth.js";
import {
  getLatestWorkspaceTemplatesSnapshot,
  publishWorkspaceTemplatesSnapshot,
} from "../services/runtime/workspace-templates-service.js";
import type { AppBindings } from "../types.js";

const TEMPLATE_NAME_REGEX = /^[A-Z][A-Z0-9_-]*\.md$/;

const errorResponseSchema = z.object({
  message: z.string(),
});

const templateNameParam = z.object({
  name: z.string(),
});

const putTemplateBodySchema = z.object({
  content: z.string().min(1),
  writeMode: z.enum(["seed", "inject"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const putTemplateResponseSchema = z.object({
  ok: z.boolean(),
  name: z.string(),
  version: z.number().int().nonnegative(),
});

const getLatestTemplatesRoute = createRoute({
  method: "get",
  path: "/api/internal/workspace-templates/latest",
  tags: ["Internal"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: runtimeWorkspaceTemplatesResponseSchema,
        },
      },
      description: "Latest workspace templates snapshot",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Unauthorized",
    },
  },
});

const putTemplateRoute = createRoute({
  method: "put",
  path: "/api/internal/workspace-templates/{name}",
  tags: ["Internal"],
  request: {
    params: templateNameParam,
    body: {
      content: { "application/json": { schema: putTemplateBodySchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: putTemplateResponseSchema },
      },
      description: "Template upserted",
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

export function registerWorkspaceTemplateRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getLatestTemplatesRoute, async (c) => {
    requireInternalToken(c);

    const snapshot = await getLatestWorkspaceTemplatesSnapshot(db);
    return c.json(
      {
        version: snapshot.version,
        templatesHash: snapshot.templatesHash,
        templates: snapshot.templates,
        createdAt: snapshot.createdAt,
      },
      200,
    );
  });

  app.openapi(putTemplateRoute, async (c) => {
    requireInternalToken(c);

    const { name } = c.req.valid("param");
    const body = c.req.valid("json");

    if (!TEMPLATE_NAME_REGEX.test(name)) {
      return c.json(
        {
          message: `Invalid template name: ${name}. Must match UPPERCASE.md pattern (e.g., AGENTS.md, BOOTSTRAP.md)`,
        },
        400,
      );
    }

    const now = new Date().toISOString();
    const status = body.status ?? "active";
    const writeMode = body.writeMode ?? "seed";

    await db
      .insert(workspaceTemplates)
      .values({
        id: createId(),
        name,
        content: body.content,
        writeMode,
        status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceTemplates.name,
        set: {
          content: body.content,
          writeMode,
          status,
          updatedAt: now,
        },
      });

    const snapshot = await publishWorkspaceTemplatesSnapshot(db);
    return c.json({ ok: true, name, version: snapshot.version }, 200);
  });
}
