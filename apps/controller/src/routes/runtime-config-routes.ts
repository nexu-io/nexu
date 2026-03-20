import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import { controllerRuntimeConfigSchema } from "../store/schemas.js";
import type { ControllerBindings } from "../types.js";

const runtimeConfigEnvelopeSchema = z.object({
  runtime: controllerRuntimeConfigSchema,
});

export function registerRuntimeConfigRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/runtime-config",
      tags: ["Runtime Config"],
      responses: {
        200: {
          content: {
            "application/json": { schema: runtimeConfigEnvelopeSchema },
          },
          description: "Runtime config",
        },
      },
    }),
    async (c) => {
      const runtime = await container.runtimeConfigService.getRuntimeConfig();
      return c.json({ runtime }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/runtime-config",
      tags: ["Runtime Config"],
      request: {
        body: {
          content: {
            "application/json": { schema: controllerRuntimeConfigSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: runtimeConfigEnvelopeSchema },
          },
          description: "Updated runtime config",
        },
      },
    }),
    async (c) => {
      const runtime = await container.runtimeConfigService.setRuntimeConfig(
        c.req.valid("json"),
      );
      return c.json({ runtime }, 200);
    },
  );
}
