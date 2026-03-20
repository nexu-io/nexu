import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const desktopReadyResponseSchema = z.object({
  ready: z.boolean(),
  runtime: z.object({
    ok: z.boolean(),
    status: z.number().nullable(),
  }),
  status: z.enum(["active", "degraded", "unhealthy"]),
});

export function registerDesktopRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/ready",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopReadyResponseSchema },
          },
          description: "Desktop runtime ready status",
        },
      },
    }),
    async (c) => {
      const runtime = await container.runtimeHealth.probe();
      return c.json(
        {
          ready: true,
          runtime,
          status: container.runtimeState.status,
        },
        200,
      );
    },
  );
}
