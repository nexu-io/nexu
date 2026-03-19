import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

export function registerDesktopRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.get("/api/internal/desktop/ready", async (c) => {
    const runtime = await container.runtimeHealth.probe();
    return c.json(
      {
        ready: true,
        runtime,
        status: container.runtimeState.status,
      },
      200,
    );
  });
}
