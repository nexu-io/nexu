import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { runtimeSkillsResponseSchema } from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { db } from "../db/index.js";
import { skills } from "../db/schema/index.js";
import { requireInternalToken } from "../middleware/internal-auth.js";
import {
  getLatestSkillsSnapshot,
  publishSkillsSnapshot,
} from "../services/runtime/skills-service.js";
import type { AppBindings } from "../types.js";

const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
