import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  botQuotaResponseSchema,
  channelConnectErrorSchema,
  channelListResponseSchema,
  channelResponseSchema,
  connectDingtalkSchema,
  connectDiscordSchema,
  connectFeishuSchema,
  connectQqbotSchema,
  connectSlackSchema,
  connectTelegramSchema,
  connectWechatSchema,
  connectWecomSchema,
  connectWhatsappSchema,
  dingtalkConnectivityResponseSchema,
  qqbotConnectivityResponseSchema,
  slackOAuthUrlResponseSchema,
  wechatQrStartResponseSchema,
  wechatQrWaitResponseSchema,
  wecomConnectivityResponseSchema,
  whatsappQrStartResponseSchema,
  whatsappQrWaitRequestSchema,
  whatsappQrWaitResponseSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { isChannelConnectError } from "../lib/channel-connect-error.js";
import { logger } from "../lib/logger.js";
import {
  readProxyFetchEnv,
  redactProxyUrl,
  shouldBypassProxy,
} from "../lib/proxy-fetch.js";
import type { ControllerBindings } from "../types.js";

const channelIdParamSchema = z.object({ channelId: z.string() });
const errorSchema = z.object({ message: z.string() });
type ControllerLocale = "en" | "zh-CN";

function getOpenclawOrigin(container: ControllerContainer): string | null {
  try {
    return new URL(container.env.openclawBaseUrl).origin;
  } catch {
    return null;
  }
}

async function getControllerLocale(
  container: ControllerContainer,
): Promise<ControllerLocale> {
  try {
    return await container.configStore.getDesktopLocale();
  } catch {
    return "en";
  }
}

function localizeChannelConnectMessage(
  error: unknown,
  locale: ControllerLocale,
): string {
  if (!isChannelConnectError(error)) {
    return locale === "zh-CN"
      ? "连接失败，请稍后重试。"
      : "Connection failed. Please try again.";
  }

  if (locale === "zh-CN") {
    switch (error.code) {
      case "invalid_credentials":
        return "凭证无效，请检查后重试。";
      case "app_id_mismatch":
        return "Application ID 与 Bot Token 不匹配，请检查后重试。";
      case "timeout":
        return "请求超时，请检查网络或代理设置后重试。";
      case "network_error":
      case "proxy_error":
        return "网络请求失败，请检查网络或代理设置后重试。";
      case "sync_failed":
        return error.phase === "persist_config"
          ? "凭证已校验，但本地保存配置失败，请稍后重试。"
          : "凭证已校验，但本地运行时同步失败，请稍后重试。";
      case "upstream_http_error":
        return "上游服务返回异常，请稍后重试。";
      case "already_connected":
        return "渠道已连接，正在刷新...";
    }
  }

  switch (error.code) {
    case "invalid_credentials":
      return "Credentials are invalid. Check them and try again.";
    case "app_id_mismatch":
      return "Application ID does not match the provided Bot Token.";
    case "timeout":
      return "The request timed out. Check your network or proxy settings and try again.";
    case "network_error":
    case "proxy_error":
      return "The network request failed. Check your network or proxy settings and try again.";
    case "sync_failed":
      return error.phase === "persist_config"
        ? "Credentials were verified, but saving the local channel config failed. Please try again."
        : "Credentials were verified, but syncing the local runtime failed. Please try again.";
    case "upstream_http_error":
      return "The upstream service returned an error. Please try again later.";
    case "already_connected":
      return "Channel already connected, refreshing...";
  }
}

function getChannelConnectErrorResponse(
  requestId: string,
  locale: ControllerLocale,
  error: unknown,
) {
  if (isChannelConnectError(error)) {
    return {
      status: error.status,
      body: {
        message: localizeChannelConnectMessage(error, locale),
        code: error.code,
        requestId,
        retryable: error.retryable,
        phase: error.phase,
      },
      upstreamHost: error.upstreamHost,
      upstreamStatus: error.upstreamStatus,
    } as const;
  }

  return {
    status: 502,
    body: {
      message: localizeChannelConnectMessage(error, locale),
      code: "network_error",
      requestId,
      retryable: true,
      phase: "verify_credentials",
    },
    upstreamHost: null,
    upstreamStatus: null,
  } as const;
}

function logChannelConnectFailure(
  container: ControllerContainer,
  input: {
    requestId: string;
    channel: "discord" | "telegram";
    locale: ControllerLocale;
    error: unknown;
  },
): {
  status: 422 | 502 | 503 | 504;
  body: z.infer<typeof channelConnectErrorSchema>;
} {
  const response = getChannelConnectErrorResponse(
    input.requestId,
    input.locale,
    input.error,
  );
  const proxyEnv = readProxyFetchEnv();
  const proxyTargetBypassed = response.upstreamHost
    ? shouldBypassProxy(response.upstreamHost, proxyEnv.noProxy)
    : null;

  logger.error(
    {
      requestId: input.requestId,
      channel: input.channel,
      error:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
      errorCode: response.body.code,
      errorPhase: response.body.phase,
      retryable: response.body.retryable,
      httpStatus: response.status,
      upstreamHost: response.upstreamHost,
      upstreamStatus: response.upstreamStatus,
      proxy: {
        httpProxyRedacted: redactProxyUrl(proxyEnv.httpProxy),
        httpsProxyRedacted: redactProxyUrl(proxyEnv.httpsProxy),
        allProxyRedacted: redactProxyUrl(proxyEnv.allProxy),
        noProxy: proxyEnv.noProxy,
        bypassedForUpstream: proxyTargetBypassed,
      },
      runtimeState: {
        status: container.runtimeState.status,
        configSyncStatus: container.runtimeState.configSyncStatus,
        skillsSyncStatus: container.runtimeState.skillsSyncStatus,
        templatesSyncStatus: container.runtimeState.templatesSyncStatus,
        gatewayStatus: container.runtimeState.gatewayStatus,
        lastGatewayProbeAt: container.runtimeState.lastGatewayProbeAt,
        lastGatewayError: container.runtimeState.lastGatewayError,
      },
      runtimeEnv: {
        manageOpenclawProcess: container.env.manageOpenclawProcess,
        gatewayProbeEnabled: container.env.gatewayProbeEnabled,
        openclawBaseUrl: getOpenclawOrigin(container),
      },
    },
    "channel_connect_failure",
  );

  void container.controlPlaneHealth
    .probe({ timeoutMs: 1500 })
    .then((controlPlaneHealth) => {
      logger.warn(
        {
          requestId: input.requestId,
          channel: input.channel,
          errorCode: response.body.code,
          errorPhase: response.body.phase,
          controlPlaneHealth,
          process: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
          },
        },
        "channel_connect_failure_context",
      );
    })
    .catch((captureError: unknown) => {
      logger.warn(
        {
          requestId: input.requestId,
          channel: input.channel,
          error:
            captureError instanceof Error
              ? captureError.message
              : String(captureError),
        },
        "channel_connect_failure_context_failed",
      );
    });

  return {
    status: response.status,
    body: response.body,
  };
}

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
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "channel_connect_error_slack",
        );
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
        422: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Invalid credentials",
        },
        502: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Upstream network or proxy failure",
        },
        503: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Local runtime sync failed",
        },
        504: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Upstream timeout",
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
        const requestId = c.get("requestId");
        const locale = await getControllerLocale(container);
        const response = logChannelConnectFailure(container, {
          requestId,
          channel: "discord",
          locale,
          error,
        });
        return c.json(response.body, response.status);
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
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "channel_connect_error_feishu",
        );
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
      method: "post",
      path: "/api/v1/channels/telegram/connect",
      tags: ["Channels"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: connectTelegramSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected telegram channel",
        },
        422: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Invalid credentials",
        },
        502: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Upstream network or proxy failure",
        },
        503: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Local runtime sync failed",
        },
        504: {
          content: {
            "application/json": { schema: channelConnectErrorSchema },
          },
          description: "Upstream timeout",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          await container.channelService.connectTelegram(c.req.valid("json")),
          200,
        );
      } catch (error) {
        const requestId = c.get("requestId");
        const locale = await getControllerLocale(container);
        const response = logChannelConnectFailure(container, {
          requestId,
          channel: "telegram",
          locale,
          error,
        });
        return c.json(response.body, response.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/dingtalk/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectDingtalkSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected dingtalk channel",
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
          await container.channelService.connectDingtalk(c.req.valid("json")),
          200,
        );
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "channel_connect_error_dingtalk",
        );
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "DingTalk connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/dingtalk/test",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectDingtalkSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: dingtalkConnectivityResponseSchema },
          },
          description: "DingTalk connectivity test result",
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
          await container.channelService.testDingtalkConnectivity(
            c.req.valid("json"),
          ),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "DingTalk connectivity test failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/qqbot/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectQqbotSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected qqbot channel",
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
          await container.channelService.connectQqbot(c.req.valid("json")),
          200,
        );
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "channel_connect_error_qqbot",
        );
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "QQ connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/qqbot/test",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectQqbotSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: qqbotConnectivityResponseSchema },
          },
          description: "QQ connectivity test result",
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
          await container.channelService.testQqbotConnectivity(
            c.req.valid("json"),
          ),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "QQ connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/wecom/connect",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectWecomSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected wecom channel",
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
          await container.channelService.connectWecom(c.req.valid("json")),
          200,
        );
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "channel_connect_error_wecom",
        );
        return c.json(
          {
            message:
              error instanceof Error ? error.message : "WeCom connect failed",
          },
          409,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/wecom/test",
      tags: ["Channels"],
      request: {
        body: {
          content: { "application/json": { schema: connectWecomSchema } },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: wecomConnectivityResponseSchema },
          },
          description: "WeCom connectivity test result",
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
          await container.channelService.testWecomConnectivity(
            c.req.valid("json"),
          ),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "WeCom connectivity test failed",
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

  // WhatsApp QR login flow
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/whatsapp/qr-start",
      tags: ["Channels"],
      responses: {
        200: {
          content: {
            "application/json": { schema: whatsappQrStartResponseSchema },
          },
          description: "QR code data for WhatsApp login",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "WhatsApp login unavailable",
        },
      },
    }),
    async (c) => {
      try {
        return c.json(await container.channelService.whatsappQrStart(), 200);
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "Failed to start WhatsApp QR login",
          },
          502,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/whatsapp/qr-wait",
      tags: ["Channels"],
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: whatsappQrWaitRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: whatsappQrWaitResponseSchema },
          },
          description: "WhatsApp QR login result",
        },
        502: {
          content: { "application/json": { schema: errorSchema } },
          description: "WhatsApp login unavailable or timeout",
        },
      },
    }),
    async (c) => {
      try {
        const { accountId } = c.req.valid("json");
        return c.json(
          await container.channelService.whatsappQrWait(accountId),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "WhatsApp QR login failed",
          },
          502,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/channels/whatsapp/connect",
      tags: ["Channels"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: connectWhatsappSchema } },
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: channelResponseSchema } },
          description: "Connected whatsapp channel",
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
          await container.channelService.connectWhatsapp(accountId),
          200,
        );
      } catch (error) {
        return c.json(
          {
            message:
              error instanceof Error
                ? error.message
                : "WhatsApp connect failed",
          },
          409,
        );
      }
    },
  );

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
        const result = await container.channelService.wechatQrStart();
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
          required: true,
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
        const result = await container.channelService.wechatQrWait(sessionKey);
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
          required: true,
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
