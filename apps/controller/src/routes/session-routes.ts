import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sessionListResponseSchema, sessionResponseSchema } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const querySchema = z.object({
  botId: z.string().optional(),
  channelType: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const sessionIdParamSchema = z.object({ id: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerSessionRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/sessions",
      tags: ["Sessions"],
      request: { query: querySchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: sessionListResponseSchema },
          },
          description: "Session list",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.sessionService.listSessions(c.req.valid("query")),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/sessions/{id}",
      tags: ["Sessions"],
      request: { params: sessionIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: sessionResponseSchema } },
          description: "Session details",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Session not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const session = await container.sessionService.getSession(id);
      if (session === null) {
        return c.json({ message: "Session not found" }, 404);
      }
      return c.json(session, 200);
    },
  );
}
