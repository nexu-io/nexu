import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import {
  getRuntimeChatHistory,
  getRuntimeSessions,
} from "../services/openclaw-service.js";
import type { AppBindings } from "../types.js";

const errorSchema = z.object({ message: z.string() });

const runtimeSessionSchema = z.object({
  sessions: z.array(z.object({}).passthrough()).optional(),
});

const runtimeMessagesSchema = z.object({
  messages: z.array(z.object({}).passthrough()).optional(),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/v1/runtime/sessions",
  tags: ["Runtime"],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimeSessionSchema },
      },
      description: "Runtime sessions from OpenClaw",
    },
    503: {
      content: {
        "application/json": { schema: errorSchema },
      },
      description: "OpenClaw not connected",
    },
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/api/v1/runtime/sessions/{sessionKey}/messages",
  tags: ["Runtime"],
  request: {
    params: z.object({ sessionKey: z.string() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimeMessagesSchema },
      },
      description: "Chat history from OpenClaw",
    },
    503: {
      content: {
        "application/json": { schema: errorSchema },
      },
      description: "OpenClaw not connected",
    },
  },
});

export function registerRuntimeSessionRoutes(app: OpenAPIHono<AppBindings>) {
  // biome-ignore lint/suspicious/noExplicitAny: passthrough OpenClaw response
  app.openapi(listRoute, async (c: any) => {
    try {
      const { limit, search } = c.req.valid("query");
      const result = await getRuntimeSessions({
        limit,
        search,
        includeDerivedTitles: true,
        includeLastMessage: true,
      });
      return c.json(result, 200);
    } catch {
      return c.json({ message: "OpenClaw runtime not available" }, 503);
    }
  });

  // biome-ignore lint/suspicious/noExplicitAny: passthrough OpenClaw response
  app.openapi(historyRoute, async (c: any) => {
    try {
      const { sessionKey } = c.req.valid("param");
      const { limit } = c.req.valid("query");
      const result = await getRuntimeChatHistory({ sessionKey, limit });
      return c.json(result, 200);
    } catch {
      return c.json({ message: "OpenClaw runtime not available" }, 503);
    }
  });
}
