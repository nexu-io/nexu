import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { runtimeSkillsResponseSchema } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import {
  controllerSkillUpsertBodySchema,
  controllerSkillsSchema,
} from "../store/schemas.js";
import type { ControllerBindings } from "../types.js";

const skillNameParamSchema = z.object({ name: z.string() });

export function registerSkillRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/skills",
      tags: ["Skills"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ skills: controllerSkillsSchema }),
            },
          },
          description: "Skills catalog",
        },
      },
    }),
    async (c) =>
      c.json({ skills: await container.skillService.getSkills() }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/skills/latest",
      tags: ["Internal"],
      responses: {
        200: {
          content: {
            "application/json": { schema: runtimeSkillsResponseSchema },
          },
          description: "Latest skill runtime snapshot",
        },
      },
    }),
    async (c) =>
      c.json(await container.skillService.getLatestRuntimeSnapshot(), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/skills/{name}",
      tags: ["Internal"],
      request: {
        params: skillNameParamSchema,
        body: {
          content: {
            "application/json": { schema: controllerSkillUpsertBodySchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                ok: z.boolean(),
                name: z.string(),
                version: z.number().int(),
              }),
            },
          },
          description: "Upserted skill",
        },
      },
    }),
    async (c) => {
      const { name } = c.req.valid("param");
      return c.json(
        await container.skillService.upsertSkill({
          name,
          ...c.req.valid("json"),
        }),
        200,
      );
    },
  );
}
