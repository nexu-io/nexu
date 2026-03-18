import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
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
          description: "Slack redirect URI",
        },
      },
    }),
    (c) =>
      c.json(
        { redirectUri: `${container.env.webUrl}/api/oauth/slack/callback` },
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
          description: "Slack OAuth URL placeholder",
        },
      },
    }),
    (c) => {
      const redirectUri = `${container.env.webUrl}/api/oauth/slack/callback`;
      return c.json({ url: redirectUri, redirectUri }, 200);
    },
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
      },
    }),
    async (c) =>
      c.json(
        await container.channelService.connectSlack(c.req.valid("json")),
        200,
      ),
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
      },
    }),
    async (c) =>
      c.json(
        await container.channelService.connectDiscord(c.req.valid("json")),
        200,
      ),
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
      },
    }),
    async (c) =>
      c.json(
        await container.channelService.connectFeishu(c.req.valid("json")),
        200,
      ),
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
