import path from "node:path";

import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { normalizeAccountId } from "openclaw/plugin-sdk";

import { assertSessionActive } from "./api/session-guard.js";
import {
  DEFAULT_BASE_URL,
  listWeixinAccountIds,
  loadWeixinAccount,
  registerWeixinAccountId,
  resolveWeixinAccount,
  saveWeixinAccount,
  triggerWeixinChannelReload,
} from "./auth/accounts.js";
import type { ResolvedWeixinAccount } from "./auth/accounts.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "./auth/login-qr.js";
import type {
  WeixinQrStartResult,
  WeixinQrWaitResult,
} from "./auth/login-qr.js";
import { downloadRemoteImageToTemp } from "./cdn/upload.js";
import { getContextToken } from "./messaging/inbound.js";
import { sendWeixinMediaFile } from "./messaging/send-media.js";
import { sendMessageWeixin } from "./messaging/send.js";
import { monitorWeixinProvider } from "./monitor/monitor.js";
import { logger } from "./util/logger.js";

/** Returns true when mediaUrl refers to a local filesystem path (absolute or relative). */
function isLocalFilePath(mediaUrl: string): boolean {
  // Treat anything without a URL scheme (no "://") as a local path.
  return !mediaUrl.includes("://");
}

function isRemoteUrl(mediaUrl: string): boolean {
  return mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://");
}

const MEDIA_OUTBOUND_TEMP_DIR = "/tmp/openclaw/weixin/media/outbound-temp";

/** Resolve any local path scheme to an absolute filesystem path. */
function resolveLocalPath(mediaUrl: string): string {
  if (mediaUrl.startsWith("file://")) return new URL(mediaUrl).pathname;
  // Resolve any relative path (./foo, ../foo, .openclaw/foo, foo/bar) against cwd
  if (!path.isAbsolute(mediaUrl)) return path.resolve(mediaUrl);
  return mediaUrl;
}

async function sendWeixinOutbound(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  accountId?: string | null;
  contextToken?: string;
  mediaUrl?: string;
}): Promise<{ channel: string; messageId: string }> {
  const account = resolveWeixinAccount(params.cfg, params.accountId);
  const aLog = logger.withAccount(account.accountId);
  assertSessionActive(account.accountId);
  if (!account.configured) {
    aLog.error(`sendWeixinOutbound: account not configured`);
    throw new Error(
      "weixin not configured: please run `openclaw channels login --channel openclaw-weixin`",
    );
  }
  if (!params.contextToken) {
    aLog.error(
      `sendWeixinOutbound: contextToken missing, refusing to send to=${params.to}`,
    );
    throw new Error("sendWeixinOutbound: contextToken is required");
  }
  const result = await sendMessageWeixin({
    to: params.to,
    text: params.text,
    opts: {
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken: params.contextToken,
    },
  });
  return { channel: "openclaw-weixin", messageId: result.messageId };
}

export const weixinPlugin: ChannelPlugin<ResolvedWeixinAccount> = {
  id: "openclaw-weixin",
  meta: {
    id: "openclaw-weixin",
    label: "openclaw-weixin",
    selectionLabel: "openclaw-weixin (long-poll)",
    docsPath: "/channels/openclaw-weixin",
    docsLabel: "openclaw-weixin",
    blurb: "getUpdates long-poll upstream, sendMessage downstream; token auth.",
    order: 75,
  },
  gatewayMethods: ["web.login.start", "web.login.wait"],
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
  },
  messaging: {
    targetResolver: {
      // Weixin user IDs always end with @im.wechat; treat as direct IDs, skip directory lookup.
      looksLikeId: (raw) => raw.endsWith("@im.wechat"),
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "To send an image or file to the current user, use the message tool with action='send' and set 'media' to a local file path or a remote URL. You do not need to specify 'to' — the current conversation recipient is used automatically.",
      "When the user asks you to find an image from the web, use a web search or browser tool to find a suitable image URL, then send it using the message tool with 'media' set to that HTTPS image URL — do NOT download the image first.",
      "IMPORTANT: When generating or saving a file to send, always use an absolute path (e.g. /tmp/photo.png), never a relative path like ./photo.png. Relative paths cannot be resolved and the file will not be delivered.",
      "IMPORTANT: When creating a cron job (scheduled task) for the current Weixin user, you MUST set delivery.to to the user's Weixin ID (the xxx@im.wechat address from the current conversation). Without an explicit 'to', the cron delivery will fail with 'requires target'. Example: delivery: { mode: 'announce', channel: 'openclaw-weixin', to: '<current_user_id@im.wechat>' }.",
    ],
  },
  reload: { configPrefixes: ["channels.openclaw-weixin"] },
  config: {
    listAccountIds: (cfg) => listWeixinAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWeixinAccount(cfg, accountId),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async (ctx) => {
      const result = await sendWeixinOutbound({
        cfg: ctx.cfg,
        to: ctx.to,
        text: ctx.text,
        accountId: ctx.accountId,
        contextToken: getContextToken(ctx.accountId!, ctx.to),
      });
      return result;
    },
    sendMedia: async (ctx) => {
      const account = resolveWeixinAccount(ctx.cfg, ctx.accountId);
      const aLog = logger.withAccount(account.accountId);
      assertSessionActive(account.accountId);
      if (!account.configured) {
        aLog.error(`sendMedia: account not configured`);
        throw new Error(
          "weixin not configured: please run `openclaw channels login --channel openclaw-weixin`",
        );
      }

      const mediaUrl = ctx.mediaUrl;

      if (mediaUrl && (isLocalFilePath(mediaUrl) || isRemoteUrl(mediaUrl))) {
        let filePath: string;
        if (isLocalFilePath(mediaUrl)) {
          filePath = resolveLocalPath(mediaUrl);
          aLog.debug(`sendMedia: uploading local file ${filePath}`);
        } else {
          aLog.debug(
            `sendMedia: downloading remote mediaUrl=${mediaUrl.slice(0, 80)}...`,
          );
          filePath = await downloadRemoteImageToTemp(
            mediaUrl,
            MEDIA_OUTBOUND_TEMP_DIR,
          );
          aLog.debug(`sendMedia: remote image downloaded to ${filePath}`);
        }
        const contextToken = getContextToken(account.accountId, ctx.to);
        const result = await sendWeixinMediaFile({
          filePath,
          to: ctx.to,
          text: ctx.text ?? "",
          opts: {
            baseUrl: account.baseUrl,
            token: account.token,
            contextToken,
          },
          cdnBaseUrl: account.cdnBaseUrl,
        });
        return { channel: "openclaw-weixin", messageId: result.messageId };
      }

      const result = await sendWeixinOutbound({
        cfg: ctx.cfg,
        to: ctx.to,
        text: ctx.text ?? "",
        accountId: ctx.accountId,
        contextToken: getContextToken(ctx.accountId!, ctx.to),
      });
      return result;
    },
  },
  status: {
    defaultRuntime: {
      accountId: "",
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
    collectStatusIssues: () => [],
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      ...runtime,
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },
  auth: {
    login: async ({ cfg, accountId, verbose, runtime }) => {
      const account = resolveWeixinAccount(cfg, accountId);

      const log = (msg: string) => {
        runtime?.log?.(msg);
      };

      log(`正在启动微信扫码登录...`);
      const startResult: WeixinQrStartResult = await startWeixinLoginWithQr({
        accountId: account.accountId,
        apiBaseUrl: account.baseUrl,
        botType: DEFAULT_ILINK_BOT_TYPE,
        verbose: Boolean(verbose),
      });

      if (!startResult.qrcodeUrl) {
        logger.warn(
          `auth.login: failed to get QR code accountId=${account.accountId} message=${startResult.message}`,
        );
        log(startResult.message);
        throw new Error(startResult.message);
      }

      log(`\n使用微信扫描以下二维码，以完成连接：\n`);
      try {
        const qrcodeterminal = await import("qrcode-terminal");
        await new Promise<void>((resolve) => {
          qrcodeterminal.default.generate(
            startResult.qrcodeUrl!,
            { small: true },
            (qr: string) => {
              console.log(qr);
              resolve();
            },
          );
        });
      } catch (err) {
        logger.warn(
          `auth.login: qrcode-terminal unavailable, falling back to URL err=${String(err)}`,
        );
        log(`二维码链接: ${startResult.qrcodeUrl}`);
      }

      const loginTimeoutMs = 480_000;
      log(`\n等待连接结果...\n`);

      const waitResult: WeixinQrWaitResult = await waitForWeixinLogin({
        sessionKey: startResult.sessionKey,
        apiBaseUrl: account.baseUrl,
        timeoutMs: loginTimeoutMs,
        verbose: Boolean(verbose),
        botType: DEFAULT_ILINK_BOT_TYPE,
      });

      if (waitResult.connected && waitResult.botToken && waitResult.accountId) {
        try {
          // Normalize the raw ilink_bot_id (e.g. "hex@im.bot") to a filesystem-safe
          // key (e.g. "hex-im-bot") so account files have no special chars.
          const normalizedId = normalizeAccountId(waitResult.accountId);
          saveWeixinAccount(normalizedId, {
            token: waitResult.botToken,
            baseUrl: waitResult.baseUrl,
            userId: waitResult.userId,
          });
          registerWeixinAccountId(normalizedId);
          void triggerWeixinChannelReload();
          log(`\n✅ 与微信连接成功！`);
        } catch (err) {
          logger.error(
            `auth.login: failed to save account data accountId=${waitResult.accountId} err=${String(err)}`,
          );
          log(`⚠️  保存账号数据失败: ${String(err)}`);
        }
      } else {
        logger.warn(
          `auth.login: login did not complete accountId=${account.accountId} message=${waitResult.message}`,
        );
        // log(waitResult.message);
        throw new Error(waitResult.message);
      }
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      logger.debug(`startAccount entry`);
      if (!ctx) {
        logger.warn(
          `gateway.startAccount: called with undefined ctx, skipping`,
        );
        return;
      }
      const account = ctx.account;
      const aLog = logger.withAccount(account.accountId);
      aLog.debug(`about to call monitorWeixinProvider`);
      aLog.info(`starting weixin webhook`);

      ctx.setStatus?.({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
        lastEventAt: Date.now(),
      });

      if (!account.configured) {
        aLog.error(`account not configured`);
        ctx.log?.error?.(
          `[${account.accountId}] weixin not logged in — run: openclaw channels login --channel openclaw-weixin`,
        );
        ctx.setStatus?.({ accountId: account.accountId, running: false });
        throw new Error("weixin not configured: missing token");
      }

      ctx.log?.info?.(
        `[${account.accountId}] starting weixin provider (${DEFAULT_BASE_URL})`,
      );

      const logPath = aLog.getLogFilePath();
      ctx.log?.info?.(`[${account.accountId}] weixin logs: ${logPath}`);

      return monitorWeixinProvider({
        baseUrl: account.baseUrl,
        cdnBaseUrl: account.cdnBaseUrl,
        token: account.token,
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        setStatus: ctx.setStatus,
      });
    },
    loginWithQrStart: async ({ accountId, force, timeoutMs, verbose }) => {
      // For re-login: use saved baseUrl from account data; fall back to default for new accounts.
      const savedBaseUrl = accountId
        ? loadWeixinAccount(accountId)?.baseUrl?.trim()
        : "";
      const result: WeixinQrStartResult = await startWeixinLoginWithQr({
        accountId: accountId ?? undefined,
        apiBaseUrl: savedBaseUrl || DEFAULT_BASE_URL,
        botType: DEFAULT_ILINK_BOT_TYPE,
        force,
        timeoutMs,
        verbose,
      });
      // Return sessionKey so the client can pass it back in loginWithQrWait.
      return {
        qrDataUrl: result.qrcodeUrl,
        message: result.message,
        sessionKey: result.sessionKey,
      } as { qrDataUrl?: string; message: string };
    },
    loginWithQrWait: async (params) => {
      // sessionKey is forwarded by the client after loginWithQrStart (runtime param extension).
      const sessionKey =
        (params as { sessionKey?: string }).sessionKey ||
        params.accountId ||
        "";
      const savedBaseUrl = params.accountId
        ? loadWeixinAccount(params.accountId)?.baseUrl?.trim()
        : "";
      const result: WeixinQrWaitResult = await waitForWeixinLogin({
        sessionKey,
        apiBaseUrl: savedBaseUrl || DEFAULT_BASE_URL,
        timeoutMs: params.timeoutMs,
      });

      if (result.connected && result.botToken && result.accountId) {
        try {
          const normalizedId = normalizeAccountId(result.accountId);
          saveWeixinAccount(normalizedId, {
            token: result.botToken,
            baseUrl: result.baseUrl,
            userId: result.userId,
          });
          registerWeixinAccountId(normalizedId);
          triggerWeixinChannelReload();
          logger.info(
            `loginWithQrWait: saved account data for accountId=${normalizedId}`,
          );
        } catch (err) {
          logger.error(
            `loginWithQrWait: failed to save account data err=${String(err)}`,
          );
        }
      }

      // Return the normalized accountId so Nexu config matches the ID
      // the gateway uses internally (e.g. "hex-im-bot" not "hex@im.bot").
      const returnAccountId =
        result.connected && result.accountId
          ? normalizeAccountId(result.accountId)
          : result.accountId;
      return {
        connected: result.connected,
        message: result.message,
        accountId: returnAccountId,
      } as { connected: boolean; message: string };
    },
  },
};
