import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  artifactListResponseSchema,
  artifactResponseSchema,
  artifactStatsResponseSchema,
  createArtifactSchema,
  updateArtifactSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const querySchema = z.object({
  limit: z.coerce.number().int().positive().default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  sessionKey: z.string().optional(),
});

const artifactIdParamSchema = z.object({ id: z.string() });
const artifactNotFoundSchema = z.object({ message: z.string() });

export function registerArtifactRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/artifacts",
      tags: ["Artifacts", "Internal"],
      request: {
        body: {
          content: { "application/json": { schema: createArtifactSchema } },
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: artifactResponseSchema } },
          description: "Created artifact",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.artifactService.createArtifact(c.req.valid("json")),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/internal/artifacts/{id}",
      tags: ["Artifacts", "Internal"],
      request: {
        params: artifactIdParamSchema,
        body: {
          content: { "application/json": { schema: updateArtifactSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: artifactResponseSchema } },
          description: "Updated artifact",
        },
        404: {
          content: { "application/json": { schema: artifactNotFoundSchema } },
          description: "Artifact not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const artifact = await container.artifactService.updateArtifact(
        id,
        c.req.valid("json"),
      );
      if (artifact === null) {
        return c.json({ message: "Artifact not found" }, 404);
      }
      return c.json(artifact, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts",
      tags: ["Artifacts"],
      request: { query: querySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: artifactListResponseSchema },
          },
          description: "Artifacts",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.artifactService.listArtifacts(c.req.valid("query")),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts/stats",
      tags: ["Artifacts"],
      responses: {
        200: {
          content: {
            "application/json": { schema: artifactStatsResponseSchema },
          },
          description: "Artifact stats",
        },
      },
    }),
    async (c) => c.json(await container.artifactService.getStats(), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/artifacts/{id}",
      tags: ["Artifacts"],
      request: { params: artifactIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: artifactResponseSchema } },
          description: "Artifact",
        },
        404: {
          content: { "application/json": { schema: artifactNotFoundSchema } },
          description: "Artifact not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const artifact = await container.artifactService.getArtifact(id);
      if (artifact === null) {
        return c.json({ message: "Artifact not found" }, 404);
      }
      return c.json(artifact, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/artifacts/{id}",
      tags: ["Artifacts"],
      request: { params: artifactIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ ok: z.boolean() }) },
          },
          description: "Deleted artifact",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      return c.json(
        { ok: await container.artifactService.deleteArtifact(id) },
        200,
      );
    },
  );
}
