/**
 * OpenClaw 通信服务模块
 *
 * 封装与 OpenClaw Gateway 的所有 WebSocket 通信，包括：
 * - 协议层：WS 连接、握手、JSON-RPC 请求/响应、心跳、自动重连
 * - 业务层：配置推送（config.apply）、频道状态查询（channels.status）、就绪检测
 *
 * 使用 OpenClaw 协议 v3，token-based 认证。
 * 避免直接引用 openclaw 包（GatewayClient 含 device identity、TLS pinning 等桌面侧逻辑）。
 */

import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "@nexu/shared";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- ws has no bundled types; we only use .OPEN, .send, .close, .on
import WebSocket from "ws";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Protocol types (subset of openclaw/src/gateway/protocol)
// ---------------------------------------------------------------------------

interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
}

type Frame = RequestFrame | ResponseFrame | EventFrame;

// ---------------------------------------------------------------------------
// Public types — channel status & readiness
// ---------------------------------------------------------------------------

/** Snapshot of a single channel account as returned by channels.status RPC. */
export interface ChannelAccountSnapshot {
  accountId: string;
  connected?: boolean;
  running?: boolean;
  configured?: boolean;
  enabled?: boolean;
  lastError?: string | null;
  probe?: { ok?: boolean };
}

/** Result of channels.status RPC. */
export interface ChannelsStatusResult {
  channelOrder: string[];
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
}

/** Readiness info for a single channel, used by the readiness endpoint. */
export interface ChannelReadiness {
  ready: boolean;
  connected: boolean;
  running: boolean;
  configured: boolean;
  lastError: string | null;
  gatewayConnected: boolean;
}

// ---------------------------------------------------------------------------
// WS Client
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = 3;
const MAX_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class OpenClawWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private _connected = false;
  private closed = false;
  private backoffMs = 1000;
  private lastTick: number | null = null;
  private tickIntervalMs = 30_000;
  private tickTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private onConnectedCallback: (() => void) | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  /** Register a callback fired once each time the WS handshake completes. */
  onConnected(cb: () => void): void {
    this.onConnectedCallback = cb;
  }

  /** Whether the client has completed the handshake and is ready for RPC. */
  isConnected(): boolean {
    return this._connected;
  }

  /** Open a WebSocket and begin the handshake. Safe to call multiple times. */
  connect(): void {
    if (this.closed || this.ws) {
      return;
    }
    logger.info({ message: "openclaw_ws_connecting", url: this.url });

    const ws = new WebSocket(this.url, { maxPayload: 25 * 1024 * 1024 });
    this.ws = ws;

    ws.on("open", () => {
      // Wait for connect.challenge event from gateway
    });

    ws.on("message", (data: string | Buffer) => {
      this.handleMessage(
        typeof data === "string" ? data : data.toString("utf8"),
      );
    });

    ws.on("close", (code: number, reason: string | Buffer) => {
      const reasonText =
        typeof reason === "string" ? reason : reason.toString("utf8");
      logger.info({
        message: "openclaw_ws_closed",
        code,
        reason: reasonText,
      });
      this.cleanup();
      this.scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      logger.warn({
        message: "openclaw_ws_error",
        error: err.message,
      });
    });
  }

  /** Gracefully close the connection. No reconnect after this. */
  stop(): void {
    this.closed = true;
    this.cleanup();
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Send a JSON-RPC request and wait for the matching response.
   * Rejects if the gateway is not connected or the request times out.
   */
  async request<T = unknown>(
    method: string,
    params?: unknown,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this._connected) {
      throw new Error("openclaw gateway not connected");
    }
    const id = randomUUID();
    const frame: RequestFrame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`openclaw request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private handleMessage(raw: string): void {
    let parsed: Frame;
    try {
      parsed = JSON.parse(raw) as Frame;
    } catch {
      return;
    }

    if (parsed.type === "event") {
      this.handleEvent(parsed);
      return;
    }

    if (parsed.type === "res") {
      this.handleResponse(parsed);
    }
  }

  private handleEvent(evt: EventFrame): void {
    if (evt.event === "connect.challenge") {
      const payload = evt.payload as { nonce?: string } | undefined;
      const nonce = payload?.nonce;
      if (!nonce) {
        logger.error({ message: "openclaw_ws_missing_nonce" });
        this.ws?.close(1008, "missing nonce");
        return;
      }
      this.sendConnectRequest(nonce);
      return;
    }

    if (evt.event === "tick") {
      this.lastTick = Date.now();
    }
  }

  private handleResponse(res: ResponseFrame): void {
    const pending = this.pending.get(res.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(res.id);

    if (res.ok) {
      pending.resolve(res.payload);
    } else {
      pending.reject(
        new Error(res.error?.message ?? "openclaw request failed"),
      );
    }
  }

  private sendConnectRequest(_nonce: string): void {
    const id = randomUUID();
    const frame: RequestFrame = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: "gateway-client",
          version: "1.0.0",
          platform: process.platform,
          mode: "backend",
        },
        auth: { token: this.token },
        role: "operator",
        scopes: ["operator.admin"],
      },
    };

    const timer = setTimeout(() => {
      this.pending.delete(id);
      logger.error({ message: "openclaw_ws_connect_timeout" });
      this.ws?.close(1008, "connect timeout");
    }, 10_000);

    this.pending.set(id, {
      resolve: (helloOk) => {
        this._connected = true;
        this.backoffMs = 1000;

        const policy = (helloOk as Record<string, unknown>)?.policy as
          | { tickIntervalMs?: number }
          | undefined;
        if (typeof policy?.tickIntervalMs === "number") {
          this.tickIntervalMs = policy.tickIntervalMs;
        }
        this.lastTick = Date.now();
        this.startTickWatch();

        logger.info({ message: "openclaw_ws_connected" });

        // Fire the onConnected callback (e.g. to push initial config)
        try {
          this.onConnectedCallback?.();
        } catch (err) {
          logger.warn({
            message: "openclaw_ws_on_connected_callback_error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      reject: (err) => {
        logger.error({
          message: "openclaw_ws_connect_failed",
          error: err.message,
        });
        this.ws?.close(1008, "connect failed");
      },
      timer,
    });

    this.ws?.send(JSON.stringify(frame));
  }

  private startTickWatch(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
    this.tickTimer = setInterval(() => {
      if (this.closed || !this.lastTick) {
        return;
      }
      const gap = Date.now() - this.lastTick;
      if (gap > this.tickIntervalMs * 2) {
        logger.warn({ message: "openclaw_ws_tick_timeout", gapMs: gap });
        this.ws?.close(4000, "tick timeout");
      }
    }, Math.max(this.tickIntervalMs, 1000));
  }

  private cleanup(): void {
    this._connected = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    // Reject all pending requests
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("openclaw gateway disconnected"));
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    this.ws = null;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    logger.info({
      message: "openclaw_ws_reconnect_scheduled",
      delayMs: delay,
    });
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.connect();
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// Singleton & lifecycle
// ---------------------------------------------------------------------------

let instance: OpenClawWsClient | null = null;

/**
 * Get or create the singleton OpenClaw WS client.
 * The client starts connecting lazily on first access.
 */
export function getOpenClawClient(): OpenClawWsClient {
  if (!instance) {
    const url = process.env.OPENCLAW_WS_URL ?? "ws://127.0.0.1:18789";
    const token =
      process.env.GATEWAY_TOKEN ?? "gw-secret-token";
    instance = new OpenClawWsClient(url, token);
    instance.connect();
  }
  return instance;
}

/** Stop the singleton client (call on server shutdown). */
export function stopOpenClawClient(): void {
  instance?.stop();
  instance = null;
}

/**
 * Initialize the OpenClaw service with DB access.
 * - Starts the WS connection
 * - Registers an onConnected callback that pushes the latest config from DB
 *   each time the WS handshake succeeds (covers cold start + reconnect)
 *
 * Call once at API startup, after DB is ready.
 *
 * @param loadConfig — async function that returns the current OpenClawConfig
 *                     from DB (typically calling generatePoolConfig).
 *                     Injected to avoid circular imports with pool-config-service.
 */
export function initOpenClawService(
  loadConfig: () => Promise<OpenClawConfig | null>,
): void {
  const client = getOpenClawClient();

  client.onConnected(() => {
    // Push latest config from DB on each (re)connect
    void (async () => {
      try {
        const config = await loadConfig();
        if (!config) {
          logger.info({ message: "openclaw_init_push_skipped", reason: "no config available" });
          return;
        }
        await pushConfig(config);
        logger.info({ message: "openclaw_init_config_pushed" });
      } catch (err) {
        logger.warn({
          message: "openclaw_init_config_push_failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// High-level business APIs
// ---------------------------------------------------------------------------

/**
 * 推送完整配置到 OpenClaw。
 *
 * 调用 `config.apply` RPC。OpenClaw 会：
 * 1. 验证配置合法性
 * 2. 持久化到 openclaw.json
 * 3. 通过 SIGUSR1 触发热重载（channels 重新初始化）
 *
 * @throws 如果 WS 未连接或 RPC 失败
 */
export async function pushConfig(config: OpenClawConfig): Promise<void> {
  const client = getOpenClawClient();
  await client.request("config.apply", {
    raw: JSON.stringify(config, null, 2),
    note: "pushed from nexu-api",
    restartDelayMs: 500,
  });
  logger.info({ message: "openclaw_config_pushed" });
}

/**
 * 查询所有 channel 的运行状态快照。
 *
 * 调用 `channels.status` RPC。当 probe=true 时会触发实时探测
 * （如飞书 bot-info 校验），结果包含在 snapshot.probe 中。
 *
 * @throws 如果 WS 未连接或 RPC 失败
 */
export async function getChannelsStatus(): Promise<ChannelsStatusResult> {
  const client = getOpenClawClient();
  return client.request<ChannelsStatusResult>("channels.status", {
    probe: true,
    timeoutMs: 8000,
  });
}

/**
 * 查询单个 channel 的就绪状态。
 *
 * 内部调用 getChannelsStatus() 后按 channelType + accountId 查找匹配的 snapshot。
 *
 * 就绪判断逻辑：
 * - WebSocket 模式（Slack/Discord）：connected === true
 * - Webhook 模式（Feishu）：running && configured && probe.ok
 *
 * 当 WS 未连接时返回 gatewayConnected: false 而不是抛错（优雅降级）。
 */
export async function getChannelReadiness(
  channelType: string,
  accountId: string,
): Promise<ChannelReadiness> {
  const client = getOpenClawClient();

  if (!client.isConnected()) {
    return {
      ready: false,
      connected: false,
      running: false,
      configured: false,
      lastError: null,
      gatewayConnected: false,
    };
  }

  try {
    const status = await getChannelsStatus();
    const accounts = status.channelAccounts?.[channelType] ?? [];
    const snapshot = accounts.find((a) => a.accountId === accountId);

    if (!snapshot) {
      // Channel not yet visible to OpenClaw (config not yet loaded)
      return {
        ready: false,
        connected: false,
        running: false,
        configured: false,
        lastError: null,
        gatewayConnected: true,
      };
    }

    // WebSocket-based channels (Slack, Discord): connected === true
    // Webhook-based channels (Feishu): running && configured && probe.ok
    const isConnected = snapshot.connected === true;
    const isWebhookReady =
      snapshot.running === true &&
      snapshot.configured === true &&
      snapshot.probe?.ok === true;
    const ready = isConnected || isWebhookReady;

    return {
      ready,
      connected: snapshot.connected ?? false,
      running: snapshot.running ?? false,
      configured: snapshot.configured ?? false,
      lastError: snapshot.lastError ?? null,
      gatewayConnected: true,
    };
  } catch (err) {
    logger.warn({
      message: "openclaw_channel_readiness_error",
      channelType,
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ready: false,
      connected: false,
      running: false,
      configured: false,
      lastError: null,
      gatewayConnected: false,
    };
  }
}
