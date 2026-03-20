import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createSessionSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  updateSessionSchema,
} from "@nexu/shared";
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
      method: "post",
      path: "/api/internal/sessions",
      tags: ["Sessions", "Internal"],
      request: {
        body: {
          content: { "application/json": { schema: createSessionSchema } },
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: sessionResponseSchema } },
          description: "Created or updated session",
        },
      },
    }),
    async (c) =>
      c.json(
        await container.sessionService.createSession(c.req.valid("json")),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/internal/sessions/{id}",
      tags: ["Sessions", "Internal"],
      request: {
        params: sessionIdParamSchema,
        body: {
          content: { "application/json": { schema: updateSessionSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: sessionResponseSchema } },
          description: "Updated session",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const session = await container.sessionService.updateSession(
        id,
        c.req.valid("json"),
      );
      if (!session) return c.json({ message: "Session not found" }, 404);
      return c.json(session, 200);
    },
  );

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

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/sessions/{id}/reset",
      tags: ["Sessions"],
      request: { params: sessionIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: sessionResponseSchema } },
          description: "Reset session",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const session = await container.sessionService.resetSession(id);
      if (!session) return c.json({ message: "Session not found" }, 404);
      return c.json(session, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/sessions/{id}/messages",
      tags: ["Sessions"],
      request: {
        params: sessionIdParamSchema,
        query: z.object({
          limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                messages: z.array(
                  z.object({
                    id: z.string(),
                    role: z.enum(["user", "assistant"]),
                    content: z.unknown(),
                    timestamp: z.number().nullable(),
                    createdAt: z.string().nullable(),
                  }),
                ),
                sessionKey: z.string().nullable(),
              }),
            },
          },
          description: "Chat messages for the session",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Session not found",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { limit } = c.req.valid("query");
      const result = await container.sessionService.getChatHistory(id, limit);
      if (result.sessionKey === null) {
        return c.json({ message: "Session not found" }, 404);
      }
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/sessions/{id}",
      tags: ["Sessions"],
      request: { params: sessionIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ ok: z.boolean() }) },
          },
          description: "Delete session",
        },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      return c.json(
        { ok: await container.sessionService.deleteSession(id) },
        200,
      );
    },
  );
}
