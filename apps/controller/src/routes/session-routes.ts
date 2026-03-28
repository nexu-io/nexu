import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  createSessionSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  updateSessionSchema,
} from "@nexu/shared";
import { HTTPException } from "hono/http-exception";
import type { ControllerContainer } from "../app/container.js";
import { FeishuCardDeliveryError } from "../runtime/sessions-runtime.js";
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

function getRouteErrorMessage(prefix: string, error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `${prefix}: ${error.message}`;
  }

  return prefix;
}

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

  // ---------------------------------------------------------------------------
  // Internal: Feishu interactive card
  // ---------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/channels/feishu/send-card",
      tags: ["Internal", "Channels"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({
                botId: z.string(),
                card: z.record(z.unknown()),
                to: z.string(),
                receiveIdType: z
                  .enum(["chat_id", "open_id", "user_id", "union_id", "email"])
                  .optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ messageId: z.string() }),
            },
          },
          description: "Feishu card send result",
        },
        500: {
          content: {
            "application/json": { schema: errorSchema },
          },
          description: "Feishu card send failed due to internal configuration",
        },
        502: {
          content: {
            "application/json": { schema: errorSchema },
          },
          description: "Feishu card send failed due to upstream error",
        },
      },
    }),
    async (c) => {
      const { botId, card, to, receiveIdType } = c.req.valid("json");
      try {
        const result = await container.sessionService.sendFeishuCard({
          botId,
          card,
          to,
          receiveIdType,
        });
        return c.json(result, 200);
      } catch (error) {
        const prefix = `Failed to send Feishu card for botId=${botId} to=${to} receiveIdType=${receiveIdType ?? "chat_id"}`;
        if (error instanceof FeishuCardDeliveryError) {
          const statusCode = error.statusCode === 502 ? 502 : 500;
          const message = getRouteErrorMessage(prefix, error);
          throw new HTTPException(statusCode, {
            res: c.json({ message }, statusCode),
          });
        }
        const message = getRouteErrorMessage(prefix, error);
        throw new HTTPException(500, {
          res: c.json({ message }, 500),
        });
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/channels/feishu/update-card",
      tags: ["Internal", "Channels"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({
                botId: z.string(),
                messageId: z.string(),
                card: z.record(z.unknown()),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ ok: z.boolean() }),
            },
          },
          description: "Feishu card update result",
        },
        500: {
          content: {
            "application/json": { schema: errorSchema },
          },
          description:
            "Feishu card update failed due to internal configuration",
        },
        502: {
          content: {
            "application/json": { schema: errorSchema },
          },
          description: "Feishu card update failed due to upstream error",
        },
      },
    }),
    async (c) => {
      const { botId, messageId, card } = c.req.valid("json");
      try {
        const result = await container.sessionService.updateFeishuCard({
          botId,
          messageId,
          card,
        });
        return c.json(result, 200);
      } catch (error) {
        const prefix = `Failed to update Feishu card for botId=${botId} messageId=${messageId}`;
        if (error instanceof FeishuCardDeliveryError) {
          const statusCode = error.statusCode === 502 ? 502 : 500;
          const message = getRouteErrorMessage(prefix, error);
          throw new HTTPException(statusCode, {
            res: c.json({ message }, statusCode),
          });
        }
        const message = getRouteErrorMessage(prefix, error);
        throw new HTTPException(500, {
          res: c.json({ message }, 500),
        });
      }
    },
  );
}
