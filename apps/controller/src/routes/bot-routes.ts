import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  botListResponseSchema,
  botResponseSchema,
  createBotSchema,
  updateBotSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const botIdParamSchema = z.object({ botId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerBotRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bots",
      tags: ["Bots"],
      responses: {
        200: {
          content: { "application/json": { schema: botListResponseSchema } },
          description: "Bot list",
        },
      },
    }),
    async (c) => c.json({ bots: await container.agentService.listBots() }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bots/default",
      tags: ["Bots"],
      responses: {
        200: {
          content: { "application/json": { schema: botResponseSchema } },
          description: "Default bot (existing or newly created)",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Failed to get or create default bot",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          await container.agentService.getOrCreateDefaultBot(),
          200,
        );
      } catch (err) {
        return c.json(
          {
            message:
              err instanceof Error
                ? err.message
                : "Failed to get or create bot",
          },
          500,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bots/{botId}",
      tags: ["Bots"],
      request: { params: botIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: botResponseSchema } },
          description: "Bot",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { botId } = c.req.valid("param");
      const bot = await container.agentService.getBot(botId);
      if (bot === null) {
        return c.json({ message: "Bot not found" }, 404);
      }

      return c.json(bot, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/bots",
      tags: ["Bots"],
      request: {
        body: { content: { "application/json": { schema: createBotSchema } } },
      },
      responses: {
        200: {
          content: { "application/json": { schema: botResponseSchema } },
          description: "Created",
        },
      },
    }),
    async (c) =>
      c.json(await container.agentService.createBot(c.req.valid("json")), 200),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/bots/{botId}",
      tags: ["Bots"],
      request: {
        params: botIdParamSchema,
        body: { content: { "application/json": { schema: updateBotSchema } } },
      },
      responses: {
        200: {
          content: { "application/json": { schema: botResponseSchema } },
          description: "Updated",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { botId } = c.req.valid("param");
      const bot = await container.agentService.updateBot(
        botId,
        c.req.valid("json"),
      );
      if (bot === null) {
        return c.json({ message: "Bot not found" }, 404);
      }

      return c.json(bot, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/bots/{botId}",
      tags: ["Bots"],
      request: { params: botIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ success: z.boolean() }) },
          },
          description: "Deleted",
        },
      },
    }),
    async (c) => {
      const { botId } = c.req.valid("param");
      const success = await container.agentService.deleteBot(botId);
      return c.json({ success }, 200);
    },
  );

  for (const [pathSuffix, description, handler] of [
    [
      "pause",
      "Paused",
      (botId: string) => container.agentService.pauseBot(botId),
    ],
    [
      "resume",
      "Resumed",
      (botId: string) => container.agentService.resumeBot(botId),
    ],
  ] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path: `/api/v1/bots/{botId}/${pathSuffix}`,
        tags: ["Bots"],
        request: { params: botIdParamSchema },
        responses: {
          200: {
            content: { "application/json": { schema: botResponseSchema } },
            description,
          },
          404: {
            content: { "application/json": { schema: errorSchema } },
            description: "Not found",
          },
        },
      }),
      async (c) => {
        const { botId } = c.req.valid("param");
        const bot = await handler(botId);
        if (bot === null) {
          return c.json({ message: "Bot not found" }, 404);
        }

        return c.json(bot, 200);
      },
    );
  }
}
