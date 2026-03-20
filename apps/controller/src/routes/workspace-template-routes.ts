import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { runtimeWorkspaceTemplatesResponseSchema } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import {
  controllerTemplateSchema,
  controllerTemplateUpsertBodySchema,
} from "../store/schemas.js";
import type { ControllerBindings } from "../types.js";

const templateNameParamSchema = z.object({ name: z.string() });

export function registerWorkspaceTemplateRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/workspace-templates",
      tags: ["Workspace Templates"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                templates: z.array(controllerTemplateSchema),
              }),
            },
          },
          description: "Workspace templates",
        },
      },
    }),
    async (c) => c.json(await container.templateService.listTemplates(), 200),
  );

  app.openapi(
    createRoute({
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
          description: "Latest template runtime snapshot",
        },
      },
    }),
    async (c) =>
      c.json(await container.templateService.getLatestRuntimeSnapshot(), 200),
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/internal/workspace-templates/{name}",
      tags: ["Internal"],
      request: {
        params: templateNameParamSchema,
        body: {
          content: {
            "application/json": { schema: controllerTemplateUpsertBodySchema },
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
          description: "Upserted template",
        },
      },
    }),
    async (c) => {
      const { name } = c.req.valid("param");
      return c.json(
        await container.templateService.upsertTemplate({
          name,
          ...c.req.valid("json"),
        }),
        200,
      );
    },
  );
}
