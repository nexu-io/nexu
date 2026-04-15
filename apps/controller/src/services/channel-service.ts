import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type {
  BotQuotaResponse,
  ChannelResponse,
  ConnectDingtalkInput,
  ConnectDiscordInput,
  ConnectFeishuInput,
  ConnectQqbotInput,
  ConnectSlackInput,
  ConnectTelegramInput,
  ConnectWecomInput,
} from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { ChannelConnectError } from "../lib/channel-connect-error.js";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
import type { ControlPlaneHealthService } from "../runtime/control-plane-health.js";
import type { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import type { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";
import { requireArtifactBackedOpenClawRuntime } from "../runtime/slimclaw-runtime-resolution.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";
import type { QuotaFallbackService } from "./quota-fallback-service.js";

const execFileAsync = promisify(execFile);
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_WHATSAPP_ACCOUNT_ID = "default";
const DEFAULT_WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com";
const DEFAULT_WECHAT_BOT_TYPE = "3";
const WECHAT_LOGIN_TTL_MS = 5 * 60_000;
const WECHAT_QR_POLL_TIMEOUT_MS = 35_000;
const WECHAT_QR_FETCH_TIMEOUT_MS = 10_000;
const WECHAT_QR_POLL_BACKOFF_MS = 1_000;
const WHATSAPP_LOGIN_TTL_MS = 3 * 60_000;
const WHATSAPP_QR_TIMEOUT_MS = 45_000;
const WHATSAPP_WAIT_TIMEOUT_MS = 120_000;
const WHATSAPP_LOGGED_OUT_STATUS = 401;
const WHATSAPP_RUNTIME_RESTART_TIMEOUT_MS = 45_000;
const WHATSAPP_RUNTIME_RESTART_POLL_MS = 500;
const WHATSAPP_READY_TIMEOUT_MS = 45_000;
const WHATSAPP_READY_POLL_MS = 1_500;
const DINGTALK_PLUGIN_ID = "dingtalk-connector";
const WECOM_PLUGIN_ID = "wecom";
const LEGACY_WECOM_PLUGIN_ID = "wecom-openclaw-plugin";
const QQBOT_PLUGIN_ID = "openclaw-qqbot";
const DISCORD_API_ORIGIN = "https://discord.com";
const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

type ActiveWechatLogin = {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
};

type TelegramGetMeResponse = {
  ok: boolean;
  description?: string;
  result?: {
    id?: number;
    username?: string;
    first_name?: string;
  };
};

type WechatQrCodeResponse = {
  qrcode: string;
  qrcode_img_content: string;
};

type WechatQrStatusResponse = {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
};

type WechatStoredAccount = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
};

const activeWechatLogins = new Map<string, ActiveWechatLogin>();

type WaSocket = {
  ws?: { close?: () => void };
  ev: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    off?: (event: string, listener: (...args: unknown[]) => void) => void;
  };
};

type ActiveWhatsappLogin = {
  accountId: string;
  authDir: string;
  startedAt: number;
  sock: WaSocket;
  waitPromise: Promise<void>;
  qr?: string;
  qrDataUrl?: string;
  connected: boolean;
  error?: string;
  errorStatus?: number;
  restartAttempted: boolean;
  preserveAuthDirOnReset?: boolean;
  expectedIdentity?: WhatsappLoginIdentity;
};

type WhatsappLoginIdentity = {
  e164: string | null;
  jid: string | null;
};

type WhatsappRuntimeModules = {
  createWaSocket: (
    printQr: boolean,
    verbose: boolean,
    opts?: { authDir?: string; onQr?: (qr: string) => void },
  ) => Promise<WaSocket>;
  waitForWaConnection: (sock: WaSocket) => Promise<void>;
  getStatusCode: (error: unknown) => number | undefined;
  formatError: (error: unknown) => string;
};

const activeWhatsappLogins = new Map<string, ActiveWhatsappLogin>();

function extractWhatsappStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const directOutput = (error as { output?: unknown }).output;
  if (directOutput && typeof directOutput === "object") {
    const directStatusCode = (directOutput as { statusCode?: unknown })
      .statusCode;
    if (typeof directStatusCode === "number") {
      return directStatusCode;
    }
  }

  const nestedError = (error as { error?: unknown }).error;
  if (nestedError && typeof nestedError === "object") {
    const nestedOutput = (nestedError as { output?: unknown }).output;
    if (nestedOutput && typeof nestedOutput === "object") {
      const nestedStatusCode = (nestedOutput as { statusCode?: unknown })
        .statusCode;
      if (typeof nestedStatusCode === "number") {
        return nestedStatusCode;
      }
    }
  }

  const directStatus = (error as { status?: unknown }).status;
  return typeof directStatus === "number" ? directStatus : undefined;
}

function normalizeAccountId(accountId: string): string {
  return accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeWhatsappSelfJid(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function normalizeWhatsappSelfE164(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/\D+/g, "");
  return digits || null;
}

function readWhatsappLoginIdentity(
  authDir: string,
): WhatsappLoginIdentity | null {
  try {
    const credsPath = path.join(authDir, "creds.json");
    const parsed = JSON.parse(readFileSync(credsPath, "utf-8")) as {
      me?: { id?: string | null };
    };
    const rawId = parsed.me?.id?.trim();
    if (!rawId) {
      return null;
    }
    const jid = rawId.toLowerCase();
    const e164 = normalizeWhatsappSelfE164(rawId.split(":", 1)[0] ?? rawId);
    return { e164, jid };
  } catch {
    return null;
  }
}

function matchesWhatsappIdentity(
  actual: WhatsappLoginIdentity | null,
  expected: WhatsappLoginIdentity | null | undefined,
): boolean {
  if (!expected) {
    return true;
  }
  if (!actual) {
    return false;
  }

  const actualE164 = normalizeWhatsappSelfE164(actual.e164);
  const expectedE164 = normalizeWhatsappSelfE164(expected.e164);
  if (actualE164 && expectedE164) {
    return actualE164 === expectedE164;
  }

  const actualJid = normalizeWhatsappSelfJid(actual.jid);
  const expectedJid = normalizeWhatsappSelfJid(expected.jid);
  if (actualJid && expectedJid) {
    return actualJid === expectedJid;
  }

  return false;
}

function resolveWeChatPluginStateDir(env: ControllerEnv): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    env.openclawStateDir ||
    path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "openclaw-weixin");
}

function resolveWeChatAccountsDir(env: ControllerEnv): string {
  return path.join(resolveWeChatPluginStateDir(env), "accounts");
}

function resolveWeChatAccountIndexPath(env: ControllerEnv): string {
  return path.join(resolveWeChatPluginStateDir(env), "accounts.json");
}

function resolveWhatsAppAccountDir(
  env: ControllerEnv,
  accountId: string,
): string {
  return path.join(
    env.openclawStateDir,
    "credentials",
    "whatsapp",
    normalizeAccountId(accountId),
  );
}

function resolveWhatsAppLoginSessionDir(
  env: ControllerEnv,
  sessionId: string,
): string {
  return path.join(env.openclawStateDir, "whatsapp-login", sessionId);
}

function isTemporaryWhatsAppAuthDir(authDir: string): boolean {
  return authDir.includes(`${path.sep}whatsapp-login${path.sep}`);
}

function resolveWhatsAppLoginSessionRoot(authDir: string): string {
  return path.dirname(path.dirname(authDir));
}

function hasPluginManifestWithId(
  dirPath: string,
  pluginIds: readonly string[],
): boolean {
  try {
    const manifestPath = path.join(dirPath, "openclaw.plugin.json");
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as { id?: unknown };
    return pluginIds.includes(parsed.id as string);
  } catch {
    return false;
  }
}

function resolveInstalledPluginDir(
  env: ControllerEnv,
  pluginId: string,
  aliases: string[] = [],
  manifestIds: string[] = [pluginId],
): string | null {
  const candidateDirNames = [...new Set([pluginId, ...aliases])];
  const candidateRoots = [
    env.openclawExtensionsDir,
    env.openclawBuiltinExtensionsDir,
  ].filter((value): value is string => Boolean(value));

  for (const root of candidateRoots) {
    for (const dirName of candidateDirNames) {
      const dirPath = path.join(root, dirName);
      if (
        existsSync(dirPath) &&
        hasPluginManifestWithId(dirPath, manifestIds)
      ) {
        return dirPath;
      }
    }
  }

  return null;
}

function writeWeChatAccount(
  env: ControllerEnv,
  accountId: string,
  data: WechatStoredAccount,
): void {
  const dir = resolveWeChatAccountsDir(env);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${accountId}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

function registerWeChatAccount(env: ControllerEnv, accountId: string): void {
  const stateDir = resolveWeChatPluginStateDir(env);
  mkdirSync(stateDir, { recursive: true });
  const indexPath = resolveWeChatAccountIndexPath(env);
  const existing = existsSync(indexPath)
    ? (() => {
        try {
          const parsed = JSON.parse(
            readFileSync(indexPath, "utf-8"),
          ) as unknown;
          return Array.isArray(parsed)
            ? parsed.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
        } catch {
          return [];
        }
      })()
    : [];

  if (existing.includes(accountId)) {
    return;
  }

  writeFileSync(
    indexPath,
    JSON.stringify([...existing, accountId], null, 2),
    "utf-8",
  );
}

function getWeChatAccountStateDiagnostics(
  env: ControllerEnv,
  accountId: string,
) {
  const stateDir = resolveWeChatPluginStateDir(env);
  return {
    stateDir,
    accountFileExists: existsSync(
      path.join(stateDir, "accounts", `${accountId}.json`),
    ),
    indexFileExists: existsSync(resolveWeChatAccountIndexPath(env)),
  };
}

function purgeExpiredWechatLogins(): void {
  const now = Date.now();
  for (const [sessionKey, login] of activeWechatLogins) {
    if (now - login.startedAt >= WECHAT_LOGIN_TTL_MS) {
      activeWechatLogins.delete(sessionKey);
    }
  }
}

function closeWhatsappSocket(sock: WaSocket): void {
  try {
    sock.ws?.close?.();
  } catch {
    // ignore
  }
}

function isWhatsappLoginFresh(login: ActiveWhatsappLogin): boolean {
  return Date.now() - login.startedAt < WHATSAPP_LOGIN_TTL_MS;
}

async function resetActiveWhatsappLogin(
  accountId: string,
  reason?: string,
): Promise<void> {
  const login = activeWhatsappLogins.get(accountId);
  if (login) {
    closeWhatsappSocket(login.sock);
    if (
      !login.preserveAuthDirOnReset &&
      isTemporaryWhatsAppAuthDir(login.authDir)
    ) {
      rmSync(resolveWhatsAppLoginSessionRoot(login.authDir), {
        recursive: true,
        force: true,
      });
    }
    activeWhatsappLogins.delete(accountId);
  }
  if (reason) {
    logger.info({ accountId, reason }, "whatsapp_login_reset");
  }
}

function attachWhatsappLoginWaiter(
  login: ActiveWhatsappLogin,
  runtime: WhatsappRuntimeModules,
): void {
  logger.info(
    {
      accountId: login.accountId,
      authDir: login.authDir,
      restartAttempted: login.restartAttempted,
    },
    "whatsapp_login_wait_started",
  );
  login.waitPromise = runtime
    .waitForWaConnection(login.sock)
    .then(() => {
      const current = activeWhatsappLogins.get(login.accountId);
      if (current?.startedAt === login.startedAt) {
        current.connected = true;
        current.expectedIdentity =
          readWhatsappLoginIdentity(current.authDir) ?? undefined;
        logger.info(
          {
            accountId: current.accountId,
            authDir: current.authDir,
            restartAttempted: current.restartAttempted,
            expectedIdentity: current.expectedIdentity ?? null,
          },
          "whatsapp_login_wait_connected",
        );
      }
    })
    .catch((error) => {
      const current = activeWhatsappLogins.get(login.accountId);
      if (current?.startedAt !== login.startedAt) {
        return;
      }
      current.error = runtime.formatError(error);
      current.errorStatus = extractWhatsappStatusCode(error);
      logger.warn(
        {
          accountId: current.accountId,
          authDir: current.authDir,
          restartAttempted: current.restartAttempted,
          error: current.error,
          errorStatus: current.errorStatus,
        },
        "whatsapp_login_wait_failed",
      );
    });
}

async function restartWhatsappLoginSocket(
  login: ActiveWhatsappLogin,
  runtime: WhatsappRuntimeModules,
): Promise<boolean> {
  if (login.restartAttempted) {
    return false;
  }
  login.restartAttempted = true;
  logger.info(
    { accountId: login.accountId, authDir: login.authDir },
    "whatsapp_login_retry_after_515",
  );
  closeWhatsappSocket(login.sock);
  try {
    const sock = await runtime.createWaSocket(false, false, {
      authDir: login.authDir,
    });
    login.sock = sock;
    login.connected = false;
    login.error = undefined;
    login.errorStatus = undefined;
    logger.info(
      { accountId: login.accountId, authDir: login.authDir },
      "whatsapp_login_retry_socket_created",
    );
    attachWhatsappLoginWaiter(login, runtime);
    return true;
  } catch (error) {
    login.error = runtime.formatError(error);
    login.errorStatus = extractWhatsappStatusCode(error);
    logger.warn(
      {
        accountId: login.accountId,
        authDir: login.authDir,
        error: login.error,
        errorStatus: login.errorStatus,
      },
      "whatsapp_login_retry_socket_failed",
    );
    return false;
  }
}

function resolveOpenClawPackageDir(env: ControllerEnv): string {
  const runtime = requireArtifactBackedOpenClawRuntime(env);
  const packageJsonPath = path.join(runtime.packageDir, "package.json");
  if (existsSync(packageJsonPath)) {
    return path.resolve(runtime.packageDir);
  }

  throw new Error("OpenClaw package root not found for WhatsApp login");
}

function findDistModuleFile(
  distDir: string,
  matcher: (name: string) => boolean,
  contentPattern: RegExp,
  errorMessage: string,
): string {
  const files = readdirSync(distDir).filter(matcher).sort();
  for (const file of files) {
    try {
      const source = readFileSync(path.join(distDir, file), "utf-8");
      if (contentPattern.test(source)) {
        return file;
      }
    } catch {
      // ignore unreadable candidates
    }
  }
  throw new Error(errorMessage);
}

async function loadWhatsappRuntimeModules(
  env: ControllerEnv,
): Promise<WhatsappRuntimeModules> {
  const packageDir = resolveOpenClawPackageDir(env);
  const distDir = path.join(packageDir, "dist");
  const sessionFile = findDistModuleFile(
    distDir,
    (name) => /^session-[^.]+\.js$/.test(name),
    /createWaSocket[\s\S]*waitForWaConnection[\s\S]*getStatusCode[\s\S]*formatError/,
    "OpenClaw WhatsApp session module not found",
  );
  const sessionModule = (await import(
    pathToFileURL(path.join(distDir, sessionFile)).href
  )) as Record<string, unknown> & {
    t: WhatsappRuntimeModules["createWaSocket"];
    i: WhatsappRuntimeModules["waitForWaConnection"];
    r: WhatsappRuntimeModules["getStatusCode"];
    n: WhatsappRuntimeModules["formatError"];
  };

  const invalidExports: string[] = [];
  if (typeof sessionModule.t !== "function") {
    invalidExports.push("t:createWaSocket");
  }
  if (typeof sessionModule.i !== "function") {
    invalidExports.push("i:waitForWaConnection");
  }
  if (typeof sessionModule.r !== "function") {
    invalidExports.push("r:getStatusCode");
  }
  if (typeof sessionModule.n !== "function") {
    invalidExports.push("n:formatError");
  }
  if (invalidExports.length > 0) {
    throw new Error(
      `Invalid OpenClaw WhatsApp session module exports: missing or non-function ${invalidExports.join(
        ", ",
      )}; available keys: ${Object.keys(sessionModule).sort().join(", ")}`,
    );
  }

  return {
    createWaSocket: sessionModule.t,
    waitForWaConnection: sessionModule.i,
    getStatusCode: sessionModule.r,
    formatError: sessionModule.n,
  };
}

async function fetchWechatQrCode(
  apiBaseUrl: string,
  botType: string,
): Promise<WechatQrCodeResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    base,
  );
  try {
    const response = await proxyFetch(url.toString(), {
      timeoutMs: WECHAT_QR_FETCH_TIMEOUT_MS,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch QR code: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as WechatQrCodeResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Timed out fetching WeChat QR code");
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out fetching WeChat QR code");
    }
    throw error;
  }
}

async function pollWechatQrStatus(
  apiBaseUrl: string,
  qrcode: string,
): Promise<WechatQrStatusResponse> {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    base,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WECHAT_QR_POLL_TIMEOUT_MS);
  try {
    const response = await proxyFetch(url.toString(), {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Failed to poll QR status: ${response.status} ${response.statusText}`,
      );
    }
    return JSON.parse(rawText) as WechatQrStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class ChannelService {
  constructor(
    private readonly env: ControllerEnv,
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
    private readonly gatewayService: OpenClawGatewayService,
    private readonly openclawProcess: OpenClawProcessManager,
    private readonly controlPlaneHealth: ControlPlaneHealthService,
    private readonly wsClient: OpenClawWsClient,
    private readonly quotaFallbackService?: QuotaFallbackService,
  ) {}

  async listChannels() {
    return this.configStore.listChannels();
  }

  async getChannel(channelId: string): Promise<ChannelResponse | null> {
    return this.configStore.getChannel(channelId);
  }

  private getWorkspacePath(botId: string): string {
    return path.join(this.env.openclawStateDir, "agents", botId);
  }

  private logChannelConnectSuccess(channel: ChannelResponse): void {
    logger.info(
      {
        channelType: channel.channelType,
        channelId: channel.id,
        accountId: channel.accountId,
        botId: channel.botId,
        workspacePath: this.getWorkspacePath(channel.botId),
      },
      "channel_connect_workspace_binding",
    );
  }

  async getBotQuota(): Promise<BotQuotaResponse> {
    const base: BotQuotaResponse = {
      available: true,
      resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    if (!this.quotaFallbackService) {
      return base;
    }

    const [usingByok, byokProvider] = await Promise.all([
      this.quotaFallbackService
        .isUsingManagedModel()
        .then((managed) => !managed),
      this.quotaFallbackService.getAvailableByokProvider(),
    ]);

    return {
      ...base,
      usingByok,
      byokAvailable: byokProvider !== null,
      autoFallbackTriggered: usingByok,
    };
  }

  async connectSlack(input: ConnectSlackInput) {
    logger.info({}, "slack_connect_start");
    const authResp = await proxyFetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${input.botToken}` },
      timeoutMs: 5000,
    });
    const authData = (await authResp.json()) as {
      ok: boolean;
      team_id?: string;
      team?: string;
      bot_id?: string;
      user_id?: string;
      error?: string;
    };
    if (!authData.ok || !authData.team_id) {
      logger.error(
        { slackError: authData.error },
        "slack_connect_verify_failed",
      );
      throw new Error(
        `Invalid Slack bot token: ${authData.error ?? "auth.test failed"}`,
      );
    }

    let appId = input.appId;
    if (!appId && authData.bot_id) {
      const botInfoResp = await proxyFetch(
        `https://slack.com/api/bots.info?bot=${authData.bot_id}`,
        {
          headers: { Authorization: `Bearer ${input.botToken}` },
          timeoutMs: 5000,
        },
      );
      const botInfo = (await botInfoResp.json()) as {
        ok: boolean;
        bot?: { app_id?: string };
      };
      appId = botInfo.bot?.app_id;
    }

    if (!appId) {
      throw new Error("Could not resolve Slack app id from bot token");
    }

    const channel = await this.configStore.connectSlack({
      ...input,
      teamId: input.teamId ?? authData.team_id,
      teamName: input.teamName ?? authData.team,
      appId,
      botUserId: authData.user_id ?? null,
    });
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info(
      { channelId: channel.id, teamName: authData.team },
      "slack_connect_success",
    );
    return channel;
  }

  async connectDiscord(input: ConnectDiscordInput) {
    logger.info({ appId: input.appId }, "discord_connect_start");
    let userResp: Response;
    try {
      userResp = await proxyFetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${input.botToken}` },
        timeoutMs: 5000,
      });
    } catch (error) {
      throw this.toUpstreamConnectError(error, {
        channel: "discord",
        phase: "verify_credentials",
        upstreamHost: DISCORD_API_ORIGIN,
      });
    }

    if (!userResp.ok) {
      logger.error(
        { appId: input.appId, status: userResp.status },
        "discord_connect_verify_failed",
      );
      throw new ChannelConnectError(
        userResp.status === 401
          ? {
              message: "Invalid Discord bot token",
              code: "invalid_credentials",
              status: 422,
              retryable: false,
              phase: "verify_credentials",
              upstreamHost: DISCORD_API_ORIGIN,
              upstreamStatus: userResp.status,
            }
          : {
              message: `Discord API error (${userResp.status})`,
              code: "upstream_http_error",
              status: 502,
              retryable: userResp.status >= 500,
              phase: "verify_credentials",
              upstreamHost: DISCORD_API_ORIGIN,
              upstreamStatus: userResp.status,
            },
      );
    }

    const userData = (await userResp.json()) as { id?: string };

    let appResp: Response;
    try {
      appResp = await proxyFetch(
        "https://discord.com/api/v10/applications/@me",
        {
          headers: { Authorization: `Bot ${input.botToken}` },
          timeoutMs: 5000,
        },
      );
    } catch (error) {
      throw this.toUpstreamConnectError(error, {
        channel: "discord",
        phase: "verify_app",
        upstreamHost: DISCORD_API_ORIGIN,
      });
    }

    if (!appResp.ok) {
      logger.error(
        { appId: input.appId, status: appResp.status },
        "discord_connect_app_verify_failed",
      );
      throw new ChannelConnectError({
        message: `Discord API error (${appResp.status})`,
        code: "upstream_http_error",
        status: 502,
        retryable: appResp.status >= 500,
        phase: "verify_app",
        upstreamHost: DISCORD_API_ORIGIN,
        upstreamStatus: appResp.status,
      });
    }

    const appData = (await appResp.json()) as { id: string };
    if (appData.id !== input.appId) {
      logger.error(
        { expected: input.appId, actual: appData.id },
        "discord_connect_app_id_mismatch",
      );
      throw new ChannelConnectError({
        message: `Application ID mismatch: token belongs to ${appData.id}, but ${input.appId} was provided`,
        code: "app_id_mismatch",
        status: 422,
        retryable: false,
        phase: "verify_app",
        upstreamHost: DISCORD_API_ORIGIN,
        upstreamStatus: 200,
      });
    }

    let channel: ChannelResponse;
    try {
      channel = await this.configStore.connectDiscord({
        ...input,
        botUserId: userData.id ?? null,
      });
    } catch (error) {
      throw this.toPersistConnectError(error, "discord");
    }
    try {
      await this.syncService.syncAll();
    } catch (error) {
      throw this.toSyncConnectError(error, "discord");
    }
    this.logChannelConnectSuccess(channel);
    logger.info(
      { channelId: channel.id, botUserId: userData.id },
      "discord_connect_success",
    );
    return channel;
  }

  async connectWechat(accountId: string) {
    const channel = await this.configStore.connectWechat({ accountId });
    logger.info(
      {
        accountId,
        phase: "before",
        ...getWeChatAccountStateDiagnostics(this.env, accountId),
      },
      "wechat_connect_sync_all",
    );
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info(
      {
        accountId,
        phase: "after",
        ...getWeChatAccountStateDiagnostics(this.env, accountId),
      },
      "wechat_connect_sync_all",
    );
    // Don't block on readiness — the prewarm hot-reload + monitor startup
    // can take 15-30s depending on the previous long-poll cycle. Blocking
    // here keeps the connect modal open and risks a rollback that triggers
    // yet another config write + channel restart (making things worse).
    // The home page's live-status polling (every 3s) shows the real-time
    // "connecting → connected" transition instead.
    return channel;
  }

  async wechatQrStart() {
    const sessionKey = randomUUID();
    purgeExpiredWechatLogins();

    const qrResponse = await fetchWechatQrCode(
      DEFAULT_WECHAT_BASE_URL,
      DEFAULT_WECHAT_BOT_TYPE,
    );

    activeWechatLogins.set(sessionKey, {
      sessionKey,
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    });

    return {
      qrDataUrl: qrResponse.qrcode_img_content,
      message: "使用微信扫描以下二维码，以完成连接。",
      sessionKey,
    };
  }

  async wechatQrWait(sessionKey: string) {
    const activeLogin = activeWechatLogins.get(sessionKey);
    if (!activeLogin) {
      return {
        connected: false,
        message: "当前没有进行中的登录，请先发起登录。",
      };
    }

    if (Date.now() - activeLogin.startedAt >= WECHAT_LOGIN_TTL_MS) {
      activeWechatLogins.delete(sessionKey);
      return {
        connected: false,
        message: "二维码已过期，请重新生成。",
      };
    }

    const deadline = Date.now() + 500_000;
    while (Date.now() < deadline) {
      const status = await pollWechatQrStatus(
        DEFAULT_WECHAT_BASE_URL,
        activeLogin.qrcode,
      );

      if (status.status === "wait" || status.status === "scaned") {
        await sleep(WECHAT_QR_POLL_BACKOFF_MS);
        continue;
      }

      if (status.status === "expired") {
        activeWechatLogins.delete(sessionKey);
        return {
          connected: false,
          message: "二维码已过期，请重新生成。",
        };
      }

      if (
        status.status === "confirmed" &&
        status.bot_token &&
        status.ilink_bot_id
      ) {
        const normalizedAccountId = normalizeAccountId(status.ilink_bot_id);
        writeWeChatAccount(this.env, normalizedAccountId, {
          token: status.bot_token,
          savedAt: new Date().toISOString(),
          baseUrl: status.baseurl || DEFAULT_WECHAT_BASE_URL,
          userId: status.ilink_user_id,
        });
        registerWeChatAccount(this.env, normalizedAccountId);
        logger.info(
          {
            accountId: normalizedAccountId,
            ...getWeChatAccountStateDiagnostics(this.env, normalizedAccountId),
          },
          "wechat_qr_confirmation_state_written",
        );
        activeWechatLogins.delete(sessionKey);
        return {
          connected: true,
          message: "微信连接成功。",
          accountId: normalizedAccountId,
        };
      }
    }

    activeWechatLogins.delete(sessionKey);
    return {
      connected: false,
      message: "等待扫码超时，请重新生成二维码。",
    };
  }

  async connectTelegram(input: ConnectTelegramInput) {
    logger.info({}, "telegram_connect_start");
    let response: Response;
    try {
      response = await proxyFetch(
        `https://api.telegram.org/bot${encodeURIComponent(input.botToken)}/getMe`,
        {
          timeoutMs: 5000,
        },
      );
    } catch (error) {
      throw this.toUpstreamConnectError(error, {
        channel: "telegram",
        phase: "verify_credentials",
        upstreamHost: TELEGRAM_API_ORIGIN,
      });
    }

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "telegram_connect_verify_failed",
      );
      throw new ChannelConnectError(
        response.status === 401
          ? {
              message: "Invalid Telegram bot token",
              code: "invalid_credentials",
              status: 422,
              retryable: false,
              phase: "verify_credentials",
              upstreamHost: TELEGRAM_API_ORIGIN,
              upstreamStatus: response.status,
            }
          : {
              message: `Telegram API error (${response.status})`,
              code: "upstream_http_error",
              status: 502,
              retryable: response.status >= 500,
              phase: "verify_credentials",
              upstreamHost: TELEGRAM_API_ORIGIN,
              upstreamStatus: response.status,
            },
      );
    }

    const payload = (await response.json()) as TelegramGetMeResponse;
    if (!payload.ok || !payload.result?.id) {
      logger.error(
        { description: payload.description },
        "telegram_connect_payload_invalid",
      );
      throw new ChannelConnectError({
        message: payload.description ?? "Invalid Telegram bot token",
        code: "invalid_credentials",
        status: 422,
        retryable: false,
        phase: "verify_credentials",
        upstreamHost: TELEGRAM_API_ORIGIN,
        upstreamStatus: 200,
      });
    }

    let channel: ChannelResponse;
    try {
      channel = await this.configStore.connectTelegram({
        botToken: input.botToken,
        telegramBotId: String(payload.result.id),
        botUsername: payload.result.username ?? null,
        displayName:
          payload.result.username?.trim() ||
          payload.result.first_name?.trim() ||
          null,
      });
    } catch (error) {
      throw this.toPersistConnectError(error, "telegram");
    }
    try {
      await this.syncService.syncAll();
    } catch (error) {
      throw this.toSyncConnectError(error, "telegram");
    }
    this.logChannelConnectSuccess(channel);
    logger.info(
      { channelId: channel.id, botUsername: payload.result.username },
      "telegram_connect_success",
    );
    return channel;
  }

  async connectQqbot(input: ConnectQqbotInput) {
    logger.info({}, "qqbot_connect_start");
    this.ensureQqbotPluginInstalled();
    const { appId, appSecret } = await this.verifyQqbotCredentials(input);

    const channel = await this.configStore.connectQqbot({
      appId,
      appSecret,
    });
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info({ channelId: channel.id, appId }, "qqbot_connect_success");
    return channel;
  }

  async connectDingtalk(input: ConnectDingtalkInput) {
    logger.info({}, "dingtalk_connect_start");
    this.ensureDingtalkPluginInstalled();
    const { clientId, clientSecret } =
      await this.verifyDingtalkCredentials(input);

    const channel = await this.configStore.connectDingtalk({
      clientId,
      clientSecret,
    });
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info(
      { channelId: channel.id, clientId },
      "dingtalk_connect_success",
    );
    return channel;
  }

  async testQqbotConnectivity(input: ConnectQqbotInput) {
    this.ensureQqbotPluginInstalled();
    const { appId } = await this.verifyQqbotCredentials(input);
    return {
      success: true,
      message: `QQ credentials are valid for App ID ${appId}`,
    };
  }

  async testDingtalkConnectivity(input: ConnectDingtalkInput) {
    this.ensureDingtalkPluginInstalled();
    const { clientId } = await this.verifyDingtalkCredentials(input);
    return {
      success: true,
      message: `DingTalk credentials are valid for Client ID ${clientId}`,
    };
  }

  async connectWecom(input: ConnectWecomInput) {
    logger.info({}, "wecom_connect_start");
    this.ensureWecomPluginInstalled();
    const { botId, secret } = this.verifyWecomCredentials(input);

    const channel = await this.configStore.connectWecom({
      botId,
      secret,
    });
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info({ channelId: channel.id, botId }, "wecom_connect_success");
    return channel;
  }

  async testWecomConnectivity(input: ConnectWecomInput) {
    this.ensureWecomPluginInstalled();
    const { botId } = this.verifyWecomCredentials(input);
    return {
      success: true,
      message: `WeCom credentials are configured for Bot ID ${botId}`,
    };
  }

  async whatsappQrStart() {
    // Force a clean auth dir before creating a new QR login session.
    // This avoids stale or corrupted default credentials from mismatching the
    // new socket/auth state; the user-visible consequence is that QR login
    // always requires a fresh scan for DEFAULT_WHATSAPP_ACCOUNT_ID.
    await this.resetWhatsAppDefaultLoginState(DEFAULT_WHATSAPP_ACCOUNT_ID);
    const existing = activeWhatsappLogins.get(DEFAULT_WHATSAPP_ACCOUNT_ID);
    if (existing && isWhatsappLoginFresh(existing) && existing.qrDataUrl) {
      return {
        qrDataUrl: existing.qrDataUrl,
        message: "QR already active. Scan it in WhatsApp -> Linked Devices.",
        accountId: DEFAULT_WHATSAPP_ACCOUNT_ID,
        alreadyLinked: false,
      };
    }

    await resetActiveWhatsappLogin(DEFAULT_WHATSAPP_ACCOUNT_ID);

    const runtime = await loadWhatsappRuntimeModules(this.env);
    let resolveQr: ((qr: string) => void) | null = null;
    let rejectQr: ((error: Error) => void) | null = null;
    const qrPromise = new Promise<string>((resolve, reject) => {
      resolveQr = resolve;
      rejectQr = reject;
    });
    const qrTimer = setTimeout(() => {
      rejectQr?.(new Error("Timed out waiting for WhatsApp QR"));
    }, WHATSAPP_QR_TIMEOUT_MS);

    const loginSessionId = randomUUID();
    const loginSessionDir = resolveWhatsAppLoginSessionDir(
      this.env,
      loginSessionId,
    );
    const authDir = path.join(loginSessionDir, "credentials", "whatsapp");
    mkdirSync(authDir, { recursive: true });

    let sock: WaSocket;
    let pendingQr: string | null = null;
    try {
      sock = await runtime.createWaSocket(false, false, {
        authDir,
        onQr: (qr) => {
          if (pendingQr) {
            return;
          }
          pendingQr = qr;
          const current = activeWhatsappLogins.get(DEFAULT_WHATSAPP_ACCOUNT_ID);
          if (current && !current.qr) {
            current.qr = qr;
          }
          clearTimeout(qrTimer);
          resolveQr?.(qr);
        },
      });
    } catch (error) {
      clearTimeout(qrTimer);
      await resetActiveWhatsappLogin(DEFAULT_WHATSAPP_ACCOUNT_ID);
      throw new Error(`Failed to start WhatsApp login: ${String(error)}`);
    }

    const login: ActiveWhatsappLogin = {
      accountId: DEFAULT_WHATSAPP_ACCOUNT_ID,
      authDir,
      startedAt: Date.now(),
      sock,
      waitPromise: Promise.resolve(),
      connected: false,
      restartAttempted: false,
    };
    activeWhatsappLogins.set(DEFAULT_WHATSAPP_ACCOUNT_ID, login);
    if (pendingQr && !login.qr) {
      login.qr = pendingQr;
    }
    attachWhatsappLoginWaiter(login, runtime);

    let qr: string;
    try {
      qr = await qrPromise;
    } catch (error) {
      clearTimeout(qrTimer);
      await resetActiveWhatsappLogin(DEFAULT_WHATSAPP_ACCOUNT_ID);
      throw new Error(`Failed to get QR: ${String(error)}`);
    }

    login.qrDataUrl = qr;
    return {
      qrDataUrl: login.qrDataUrl,
      message: "Scan this QR in WhatsApp -> Linked Devices.",
      accountId: DEFAULT_WHATSAPP_ACCOUNT_ID,
      alreadyLinked: false,
    };
  }

  async whatsappQrWait(accountId: string) {
    const login = activeWhatsappLogins.get(accountId);
    if (!login) {
      return {
        connected: false,
        message: "No active WhatsApp login in progress.",
        accountId,
      };
    }
    if (!isWhatsappLoginFresh(login)) {
      await resetActiveWhatsappLogin(accountId);
      return {
        connected: false,
        message: "The login QR expired. Generate a new one.",
        accountId,
      };
    }

    const runtime = await loadWhatsappRuntimeModules(this.env);
    const deadline = Date.now() + WHATSAPP_WAIT_TIMEOUT_MS;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return {
          connected: false,
          message:
            "Still waiting for the QR scan. Let me know when you've scanned it.",
          accountId,
        };
      }

      const timeout = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), remaining),
      );
      const result = await Promise.race([
        login.waitPromise.then(() => "done" as const),
        timeout,
      ]);

      if (result === "timeout") {
        return {
          connected: false,
          message:
            "Still waiting for the QR scan. Let me know when you've scanned it.",
          accountId,
        };
      }

      if (login.error) {
        logger.warn(
          {
            accountId,
            authDir: login.authDir,
            error: login.error,
            errorStatus: login.errorStatus,
            restartAttempted: login.restartAttempted,
          },
          "whatsapp_qr_wait_observed_login_error",
        );
        if (login.errorStatus === WHATSAPP_LOGGED_OUT_STATUS) {
          rmSync(login.authDir, { recursive: true, force: true });
          const message =
            "WhatsApp reported the session is logged out. Cleared cached web session; please scan a new QR.";
          await resetActiveWhatsappLogin(accountId, message);
          return { connected: false, message, accountId };
        }
        if (login.errorStatus === 515) {
          const restarted = await restartWhatsappLoginSocket(login, runtime);
          if (restarted && isWhatsappLoginFresh(login)) {
            continue;
          }
        }
        const message = `WhatsApp login failed: ${login.error}`;
        await resetActiveWhatsappLogin(accountId, message);
        return { connected: false, message, accountId };
      }

      if (login.connected) {
        login.preserveAuthDirOnReset = true;
        return {
          connected: true,
          message: "Linked! WhatsApp is ready.",
          accountId,
        };
      }

      return {
        connected: false,
        message: "Login ended without a connection.",
        accountId,
      };
    }
  }

  async connectWhatsapp(accountId: string) {
    const login = activeWhatsappLogins.get(accountId);
    if (!login || !login.connected) {
      throw new Error("WhatsApp login is not complete yet.");
    }
    const expectedIdentity = login.expectedIdentity;
    const channel = await this.configStore.connectWhatsapp({
      accountId,
      authDir: login.authDir,
    });
    await this.syncService.syncAll();
    await this.restartOpenClawForWhatsappLifecycle("whatsapp-connect");
    const readiness = await this.waitForWhatsappReady(
      accountId,
      expectedIdentity,
    );
    if (!readiness.ready) {
      await this.configStore.disconnectChannel(channel.id);
      await this.syncService.syncAll();
      await this.restartOpenClawForWhatsappLifecycle(
        "whatsapp-connect-rollback",
      );
      login.preserveAuthDirOnReset = false;
      await resetActiveWhatsappLogin(accountId);
      throw new Error(
        readiness.lastError ??
          "WhatsApp linked, but the runtime failed to start the listener.",
      );
    }
    this.logChannelConnectSuccess(channel);
    await resetActiveWhatsappLogin(accountId);
    return channel;
  }

  async connectFeishu(input: ConnectFeishuInput) {
    logger.info({ appId: input.appId }, "feishu_connect_start");
    const response = await proxyFetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: input.appId,
          app_secret: input.appSecret,
        }),
        timeoutMs: 5000,
      },
    );
    const payload = (await response.json()) as { code?: number; msg?: string };
    if (!response.ok || payload.code !== 0) {
      logger.error(
        {
          appId: input.appId,
          status: response.status,
          code: payload.code,
          feishuMsg: payload.msg,
        },
        "feishu_connect_verify_failed",
      );
      throw new Error(
        `Invalid Feishu credentials: ${payload.msg ?? `HTTP ${response.status}`}`,
      );
    }

    const channel = await this.configStore.connectFeishu(input);
    await this.syncService.syncAll();
    this.logChannelConnectSuccess(channel);
    logger.info(
      { channelId: channel.id, appId: input.appId },
      "feishu_connect_success",
    );
    return channel;
  }

  async disconnectChannel(channelId: string) {
    // Align with OpenClaw's "remove" semantics: disconnect only unbinds the
    // channel from Nexu config and leaves the linked session intact. Explicit
    // logout remains a separate operation.
    const getChannel =
      "getChannel" in this.configStore &&
      typeof this.configStore.getChannel === "function"
        ? this.configStore.getChannel.bind(this.configStore)
        : null;
    const channel = getChannel ? await getChannel(channelId) : null;
    logger.info(
      { channelId, channelType: channel?.channelType ?? "unknown" },
      "channel_disconnect_start",
    );
    const removed = await this.configStore.disconnectChannel(channelId);
    if (removed) {
      // syncAll triggers the authoritative index writer which removes
      // account IDs no longer in config. Credential files are cleaned up
      // by the writer's orphan sweep — no destructive cleanup here so
      // disconnect stays a pure "unbind", not a "logout".
      await this.syncService.syncAll();
      if (channel?.channelType === "whatsapp") {
        await this.restartOpenClawForWhatsappLifecycle("whatsapp-disconnect");
      }
      logger.info(
        { channelId, channelType: channel?.channelType ?? "unknown" },
        "channel_disconnect_success",
      );
    } else {
      logger.warn({ channelId }, "channel_disconnect_not_found");
    }
    return removed;
  }

  private async waitForWhatsappReady(
    accountId: string,
    expectedIdentity?: WhatsappLoginIdentity,
  ) {
    const deadline = Date.now() + WHATSAPP_READY_TIMEOUT_MS;
    let lastReadiness = await this.gatewayService.getChannelReadiness(
      "whatsapp",
      accountId,
    );
    while (Date.now() < deadline) {
      if (lastReadiness.ready) {
        const status = await this.gatewayService.getChannelsStatusSnapshot({
          probe: false,
          timeoutMs: 1000,
        });
        const self = status.channels?.whatsapp?.self
          ? {
              e164: status.channels.whatsapp.self.e164 ?? null,
              jid: status.channels.whatsapp.self.jid ?? null,
            }
          : null;
        if (matchesWhatsappIdentity(self, expectedIdentity)) {
          return lastReadiness;
        }
        logger.info(
          {
            accountId,
            expectedIdentity: expectedIdentity ?? null,
            actualIdentity: self,
          },
          "whatsapp_ready_identity_mismatch",
        );
        lastReadiness = {
          ...lastReadiness,
          ready: false,
          lastError: "listener identity mismatch",
        };
      }
      await sleep(WHATSAPP_READY_POLL_MS);
      lastReadiness = await this.gatewayService.getChannelReadiness(
        "whatsapp",
        accountId,
      );
    }
    return lastReadiness;
  }

  private async restartOpenClawForWhatsappLifecycle(reason: string) {
    logger.info({ reason }, "whatsapp_runtime_restart_requested");

    if (this.env.manageOpenclawProcess) {
      await this.openclawProcess.stop();
      this.openclawProcess.enableAutoRestart();
      this.openclawProcess.start();
    } else if (this.env.openclawLaunchdLabel) {
      const domain = `gui/${os.userInfo().uid}/${this.env.openclawLaunchdLabel}`;
      await execFileAsync("launchctl", ["kickstart", "-k", domain]);
    } else {
      logger.warn(
        {
          reason,
          manageOpenclawProcess: this.env.manageOpenclawProcess,
        },
        "whatsapp_runtime_restart_skipped",
      );
      return;
    }

    this.wsClient.retryNow();

    const deadline = Date.now() + WHATSAPP_RUNTIME_RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const controlPlane = await this.controlPlaneHealth.probe({
        timeoutMs: 1500,
      });
      if (controlPlane.ok) {
        logger.info({ reason }, "whatsapp_runtime_restart_ready");
        return;
      }
      await sleep(WHATSAPP_RUNTIME_RESTART_POLL_MS);
    }

    throw new Error("OpenClaw runtime did not become healthy after restart.");
  }

  private async resetWhatsAppDefaultLoginState(accountId: string) {
    const authDir = resolveWhatsAppAccountDir(this.env, accountId);
    if (!existsSync(authDir)) {
      logger.info(
        { channelType: "whatsapp", accountId, authDir },
        "whatsapp_qr_start_no_auth_dir",
      );
      return;
    }

    rmSync(authDir, { recursive: true, force: true });
    logger.info(
      { channelType: "whatsapp", accountId, authDir },
      "whatsapp_qr_start_auth_dir_cleared",
    );
  }

  private ensureQqbotPluginInstalled(): void {
    const pluginDir = resolveInstalledPluginDir(this.env, QQBOT_PLUGIN_ID, [
      "qqbot",
    ]);
    if (!pluginDir) {
      throw new Error(`QQ plugin not installed: ${QQBOT_PLUGIN_ID}`);
    }
  }

  private toUpstreamConnectError(
    error: unknown,
    input: {
      channel: "discord" | "telegram";
      phase: "verify_credentials" | "verify_app";
      upstreamHost: string;
    },
  ): ChannelConnectError {
    if (error instanceof ChannelConnectError) {
      return error;
    }

    if (error instanceof Error && error.name === "TimeoutError") {
      return new ChannelConnectError({
        message: `${input.channel === "discord" ? "Discord" : "Telegram"} request timed out after 5000ms`,
        code: "timeout",
        status: 504,
        retryable: true,
        phase: input.phase,
        upstreamHost: input.upstreamHost,
      });
    }

    return new ChannelConnectError({
      message: `${input.channel === "discord" ? "Discord" : "Telegram"} network request failed`,
      code: "network_error",
      status: 502,
      retryable: true,
      phase: input.phase,
      upstreamHost: input.upstreamHost,
    });
  }

  private toSyncConnectError(
    error: unknown,
    channel: "discord" | "telegram",
  ): ChannelConnectError {
    if (error instanceof ChannelConnectError) {
      return error;
    }

    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Runtime sync failed";

    return new ChannelConnectError({
      message: `${channel === "discord" ? "Discord" : "Telegram"} credentials were saved, but runtime sync failed: ${message}`,
      code: "sync_failed",
      status: 503,
      retryable: true,
      phase: "sync_runtime",
    });
  }

  private toPersistConnectError(
    error: unknown,
    channel: "discord" | "telegram",
  ): ChannelConnectError {
    if (error instanceof ChannelConnectError) {
      return error;
    }

    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Local config persistence failed";

    return new ChannelConnectError({
      message: `${channel === "discord" ? "Discord" : "Telegram"} credentials were verified, but saving local channel config failed: ${message}`,
      code: "sync_failed",
      status: 503,
      retryable: true,
      phase: "persist_config",
    });
  }

  private ensureDingtalkPluginInstalled(): void {
    const pluginDir = resolveInstalledPluginDir(this.env, DINGTALK_PLUGIN_ID, [
      "dingtalk",
    ]);
    if (!pluginDir) {
      throw new Error(`DingTalk plugin not installed: ${DINGTALK_PLUGIN_ID}`);
    }
  }

  private ensureWecomPluginInstalled(): void {
    const pluginDir = resolveInstalledPluginDir(
      this.env,
      WECOM_PLUGIN_ID,
      [LEGACY_WECOM_PLUGIN_ID],
      [WECOM_PLUGIN_ID, LEGACY_WECOM_PLUGIN_ID],
    );
    if (!pluginDir) {
      throw new Error(`WeCom plugin not installed: ${WECOM_PLUGIN_ID}`);
    }
  }

  private verifyWecomCredentials(input: ConnectWecomInput): {
    botId: string;
    secret: string;
  } {
    const botId = input.botId.trim();
    const secret = input.secret.trim();
    if (!botId || !secret) {
      throw new Error("WeCom Bot ID and Secret are required");
    }
    return { botId, secret };
  }

  private async verifyQqbotCredentials(input: ConnectQqbotInput): Promise<{
    appId: string;
    appSecret: string;
  }> {
    const appId = input.appId.trim();
    const appSecret = input.appSecret.trim();
    const response = await proxyFetch(
      "https://bots.qq.com/app/getAppAccessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId,
          clientSecret: appSecret,
        }),
        timeoutMs: 5000,
      },
    );
    const payload = (await response.json()) as {
      access_token?: string;
      code?: number;
      message?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Invalid QQ credentials: ${payload.message ?? `HTTP ${response.status}`}`,
      );
    }

    return { appId, appSecret };
  }

  private async verifyDingtalkCredentials(
    input: ConnectDingtalkInput,
  ): Promise<{
    clientId: string;
    clientSecret: string;
  }> {
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!clientId || !clientSecret) {
      throw new Error("DingTalk Client ID and Client Secret are required");
    }

    const response = await proxyFetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(clientId)}&appsecret=${encodeURIComponent(clientSecret)}`,
      {
        method: "GET",
        timeoutMs: 5000,
      },
    );
    const payload = (await response.json()) as {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Invalid DingTalk credentials: ${payload.errmsg ?? `HTTP ${response.status}`}`,
      );
    }

    return { clientId, clientSecret };
  }
}
