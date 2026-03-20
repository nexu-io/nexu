/**
 * OpenClaw Communication Service
 *
 * Encapsulates all WebSocket communication with the OpenClaw Gateway:
 * - Protocol layer: WS connection, handshake, JSON-RPC request/response, heartbeat, auto-reconnect
 * - Business layer: config push (config.apply), channel status query (channels.status), readiness checks
 *
 * Uses OpenClaw protocol v3 with token-based authentication.
 * Avoids importing the openclaw package directly (GatewayClient includes device identity,
 * TLS pinning, and other desktop-side logic).
 */

import { createHash, randomUUID } from "node:crypto";
import type { OpenClawConfig } from "@nexu/shared";
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
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this._connected) {
      throw new Error("openclaw gateway not connected");
    }
    const id = randomUUID();
    const frame: RequestFrame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `openclaw request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.ws?.send(JSON.stringify(frame));
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
    this.tickTimer = setInterval(
      () => {
        if (this.closed || !this.lastTick) {
          return;
        }
        const gap = Date.now() - this.lastTick;
        if (gap > this.tickIntervalMs * 2) {
          logger.warn({ message: "openclaw_ws_tick_timeout", gapMs: gap });
          this.ws?.close(4000, "tick timeout");
        }
      },
      Math.max(this.tickIntervalMs, 1000),
    );
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

/** SHA-256 hash of the last config we successfully pushed via pushConfig(). */
let lastPushedConfigHash: string | null = null;

function configHash(config: OpenClawConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

/**
 * Get or create the singleton OpenClaw WS client.
 * The client starts connecting lazily on first access.
 */
export function getOpenClawClient(): OpenClawWsClient {
  if (!instance) {
    const url = process.env.OPENCLAW_WS_URL ?? "ws://127.0.0.1:18789";
    const token = process.env.GATEWAY_TOKEN ?? "gw-secret-token";
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
    // Push latest config from DB on each (re)connect.
    // Skip if the config hasn't changed since the last push to avoid the
    // push → OpenClaw restart → reconnect → push infinite loop.
    void (async () => {
      try {
        const config = await loadConfig();
        if (!config) {
          logger.info({
            message: "openclaw_init_push_skipped",
            reason: "no config available",
          });
          return;
        }
        const hash = configHash(config);
        if (hash === lastPushedConfigHash) {
          logger.info({
            message: "openclaw_init_push_skipped",
            reason: "config unchanged",
          });
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
 * Push a full configuration to OpenClaw.
 *
 * Flow:
 * 1. Call `config.get` to obtain the current config hash (optimistic concurrency)
 * 2. Call `config.apply` with `baseHash` to push the new configuration
 * 3. OpenClaw validates → persists to openclaw.json → SIGUSR1 hot-reload
 *
 * @throws If the WS is not connected or the RPC fails
 */
export async function pushConfig(config: OpenClawConfig): Promise<void> {
  const client = getOpenClawClient();

  // config.apply requires baseHash for optimistic concurrency control.
  // Fetch the current config hash first via config.get.
  const current = await client.request<{ hash?: string }>("config.get");
  const baseHash = current?.hash;

  await client.request("config.apply", {
    raw: JSON.stringify(config, null, 2),
    note: "pushed from nexu-api",
    ...(baseHash ? { baseHash } : {}),
  });

  // Record the hash so onConnected can skip redundant pushes after restart.
  lastPushedConfigHash = configHash(config);
  logger.info({ message: "openclaw_config_pushed" });
}

/**
 * Query the runtime status snapshot of all channels.
 *
 * Calls the `channels.status` RPC. When probe=true, real-time probes are triggered
 * (e.g. Feishu bot-info validation); results are included in snapshot.probe.
 *
 * @throws If the WS is not connected or the RPC fails
 */
export async function getChannelsStatus(): Promise<ChannelsStatusResult> {
  const client = getOpenClawClient();
  return client.request<ChannelsStatusResult>("channels.status", {
    probe: true,
    timeoutMs: 8000,
  });
}

/**
 * Query runtime session list.
 *
 * Calls the `sessions.list` RPC, returning OpenClaw's current active session snapshots.
 *
 * @throws If the WS is not connected or the RPC fails
 */
export async function getRuntimeSessions(params: {
  limit?: number;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
  search?: string;
}): Promise<unknown> {
  const client = getOpenClawClient();
  if (!client.isConnected()) {
    throw new Error("OpenClaw WS not connected");
  }
  return client.request("sessions.list", {
    limit: params.limit ?? 50,
    includeDerivedTitles: params.includeDerivedTitles ?? true,
    includeLastMessage: params.includeLastMessage ?? true,
    ...(params.search ? { search: params.search } : {}),
  });
}

/**
 * Query session chat history.
 *
 * Calls the `chat.history` RPC, returning the message list for a given session.
 *
 * @throws If the WS is not connected or the RPC fails
 */
export async function getRuntimeChatHistory(params: {
  sessionKey: string;
  limit?: number;
}): Promise<unknown> {
  const client = getOpenClawClient();
  if (!client.isConnected()) {
    throw new Error("OpenClaw WS not connected");
  }
  return client.request("chat.history", {
    sessionKey: params.sessionKey,
    ...(params.limit ? { limit: params.limit } : {}),
  });
}

/**
 * Query the readiness state of a single channel.
 *
 * Internally calls getChannelsStatus() and looks up the matching snapshot
 * by channelType + accountId.
 *
 * Readiness logic:
 * - WebSocket-based channels (Slack/Discord): connected === true
 * - Webhook-based channels (Feishu): running && configured && probe.ok
 *
 * Returns gatewayConnected: false (graceful degradation) when WS is not connected.
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
