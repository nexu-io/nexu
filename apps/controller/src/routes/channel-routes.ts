import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  botQuotaResponseSchema,
  channelListResponseSchema,
  channelResponseSchema,
  connectDiscordSchema,
  connectFeishuSchema,
  connectSlackSchema,
  connectWechatSchema,
  slackOAuthUrlResponseSchema,
  wechatQrStartResponseSchema,
  wechatQrWaitResponseSchema,
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

  // WeChat QR login flow
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/wechat/qr-start",
      tags: ["Channels"],
      responses: {
        200: {
          content: {
            "application/json": { schema: wechatQrStartResponseSchema },
          },
          description: "QR code data for WeChat login",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "Gateway not connected",
        },
      },
    }),
    async (c) => {
      try {
        const result = await container.gatewayService.wechatQrStart();
        return c.json(result, 200);
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "Failed to start WeChat QR login",
          },
          502,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/wechat/qr-wait",
      tags: ["Channels"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ sessionKey: z.string().min(1) }),
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: wechatQrWaitResponseSchema },
          },
          description: "WeChat QR login result",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "Gateway not connected or timeout",
        },
      },
    }),
    async (c) => {
      try {
        const { sessionKey } = c.req.valid("json");
        const result = await container.gatewayService.wechatQrWait(sessionKey);
        return c.json(result, 200);
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "WeChat QR login failed",
          },
          502,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/wechat/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectWechatSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected wechat channel",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Connection failed",
        },
      },
    }),
    async (c) => {
      try {
        const { accountId } = c.req.valid("json");
        return c.json(
          await container.channelService.connectWechat(accountId),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "WeChat connect failed",
          },
          409,
        );
      }
    },
  );

  // Channel readiness (queries OpenClaw gateway status)
  const channelReadinessResponseSchema = z.object({
    ready: z.boolean(),
    connected: z.boolean(),
    running: z.boolean(),
    configured: z.boolean(),
    lastError: z.string().nullable(),
    gatewayConnected: z.boolean(),
  });

  const channelLiveStatusEntrySchema = z.object({
    channelType: z.string(),
    channelId: z.string(),
    accountId: z.string(),
    status: z.enum([
      "connected",
      "connecting",
      "disconnected",
      "error",
      "restarting",
    ]),
    ready: z.boolean(),
    connected: z.boolean(),
    running: z.boolean(),
    configured: z.boolean(),
    lastError: z.string().nullable(),
  });

  const channelsLiveStatusResponseSchema = z.object({
    gatewayConnected: z.boolean(),
    channels: z.array(channelLiveStatusEntrySchema),
    agent: z.object({
      modelId: z.string().nullable(),
      modelName: z.string().nullable(),
      alive: z.boolean(),
    }),
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/live-status",
      tags: ["Channels"],
      responses: {
        200: {
          content: {
            "application/json": { schema: channelsLiveStatusResponseSchema },
          },
          description: "Live channel and agent status from OpenClaw gateway",
        },
      },
    }),
    async (c) => {
      const channels = await container.channelService.listChannels();
      const liveStatus =
        await container.gatewayService.getAllChannelsLiveStatus(
          channels.map((channel) => ({
            id: channel.id,
            channelType: channel.channelType,
            accountId: channel.accountId,
          })),
        );
      const effectiveModelId =
        await container.runtimeModelStateService.getEffectiveModelId();
      const models = await container.modelProviderService.listModels();
      const modelId = effectiveModelId;
      const modelName = modelId
        ? (models.models.find((model) => model.id === modelId)?.name ?? null)
        : null;

      return c.json(
        {
          gatewayConnected: liveStatus.gatewayConnected,
          channels: liveStatus.channels,
          agent: {
            modelId,
            modelName,
            alive:
              container.gatewayService.isConnected() &&
              container.runtimeState.gatewayStatus === "active",
          },
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/channels/{channelId}/readiness",
      tags: ["Channels"],
      request: { params: channelIdParamSchema },
      responses: {
        200: {
          content: {
            "application/json": { schema: channelReadinessResponseSchema },
          },
          description: "Channel readiness status from OpenClaw gateway",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Channel not found",
        },
      },
    }),
    async (c) => {
      const { channelId } = c.req.valid("param");
      const channel = await container.channelService.getChannel(channelId);
      if (!channel) {
        return c.json({ message: "Channel not found" }, 404);
      }
      const readiness = await container.gatewayService.getChannelReadiness(
        channel.channelType,
        channel.accountId,
      );
      return c.json(readiness, 200);
    },
  );
}
