import { execFile } from "node:child_process";
import path from "node:path";
import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { ControllerContainer } from "../app/container.js";
import { env } from "../app/env.js";
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
  const shellOpenRequestSchema = z.object({
    path: z.string().min(1),
  });

  const shellOpenResponseSchema = z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/shell-open",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": { schema: shellOpenRequestSchema },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: shellOpenResponseSchema },
          },
          description: "Shell open result",
        },
        403: {
          content: {
            "application/json": { schema: shellOpenResponseSchema },
          },
          description: "Path not allowed",
        },
      },
    }),
    async (c) => {
      const { path: targetPath } = c.req.valid("json");
      const resolved = path.resolve(targetPath);
      const allowedRoot = path.resolve(env.openclawStateDir);

      if (
        !resolved.startsWith(allowedRoot + path.sep) &&
        resolved !== allowedRoot
      ) {
        return c.json(
          { ok: false, error: "Path outside allowed directory" },
          403,
        );
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const cmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "explorer"
                : "xdg-open";
          execFile(cmd, [resolved], (err) => (err ? reject(err) : resolve()));
        });
        return c.json({ ok: true }, 200);
      } catch {
        return c.json({ ok: false, error: "Failed to open folder" }, 200);
      }
    },
  );

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
