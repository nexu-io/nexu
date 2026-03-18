import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  botQuotaResponseSchema,
  channelListResponseSchema,
  channelResponseSchema,
  connectDiscordSchema,
  connectFeishuSchema,
  connectSlackSchema,
  slackOAuthUrlResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

const channelIdParamSchema = z.object({ channelId: z.string() });
const errorSchema = z.object({ message: z.string() });

export function registerChannelRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels",
      tags: ["Channels"],
      responses: {
        200: {
          content: {
            "application/json": { schema: channelListResponseSchema },
          },
          description: "Channel list",
        },
      },
    }),
    async (c) =>
      c.json({ channels: await container.channelService.listChannels() }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/slack/redirect-uri",
      tags: ["Channels"],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ redirectUri: z.string() }),
            },
          },
          description: "Deprecated Slack redirect URI",
        },
      },
    }),
    (c) =>
      c.json(
        { redirectUri: `${container.env.webUrl}/manual-slack-connect` },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/slack/oauth-url",
      tags: ["Channels"],
      request: {
        query: z.object({ returnTo: z.string().optional() }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: slackOAuthUrlResponseSchema },
          },
          description: "Deprecated Slack OAuth placeholder",
        },
      },
    }),
    (c) =>
      c.json(
        {
          url: `${container.env.webUrl}/manual-slack-connect`,
          redirectUri: `${container.env.webUrl}/manual-slack-connect`,
        },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/slack/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectSlackSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected slack channel",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid credentials",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          await container.channelService.connectSlack(c.req.valid("json")),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "Slack connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/discord/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectDiscordSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected discord channel",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid credentials",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          await container.channelService.connectDiscord(c.req.valid("json")),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "Discord connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/feishu/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectFeishuSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected feishu channel",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid credentials",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          await container.channelService.connectFeishu(c.req.valid("json")),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "Feishu connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/{channelId}/status",
      tags: ["Channels"],
      request: { params: channelIdParamSchema },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Channel status",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
    }),
    async (c) => {
      const { channelId } = c.req.valid("param");
      const channel = await container.channelService.getChannel(channelId);
      if (channel === null) {
        return c.json({ message: "Channel not found" }, 404);
      }
      return c.json(channel, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/bot-quota",
      tags: ["Channels"],
      responses: {
        200: {
          content: { "application/json": { schema: botQuotaResponseSchema } },
          description: "Bot quota",
        },
      },
    }),
    async (c) => c.json(await container.channelService.getBotQuota(), 200),
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/v1/channels/{channelId}",
      tags: ["Channels"],
      request: { params: channelIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ success: z.boolean() }) },
          },
          description: "Disconnected channel",
        },
      },
    }),
    async (c) => {
      const { channelId } = c.req.valid("param");
      return c.json(
        {
          success: await container.channelService.disconnectChannel(channelId),
        },
        200,
      );
    },
  );
}
