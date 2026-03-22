/**
 * OpenClaw WebSocket Client
 *
 * Low-level WebSocket protocol implementation for communicating with the
 * OpenClaw Gateway. Handles connection, challenge-response handshake,
 * JSON-RPC request/response, heartbeat monitoring, and auto-reconnect.
 *
 * Uses OpenClaw protocol v3 with token-based authentication.
 */

import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Device identity helpers (Ed25519, matching openclaw protocol v3)
// ---------------------------------------------------------------------------

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto
    .createPublicKey(publicKeyPem)
    .export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(
    crypto.sign(null, Buffer.from(payload, "utf8"), key) as unknown as Buffer,
  );
}

function loadOrCreateDeviceIdentity(filePath: string): DeviceIdentity {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem as string);
        return {
          deviceId: derivedId,
          publicKeyPem: parsed.publicKeyPem as string,
          privateKeyPem: parsed.privateKeyPem as string,
        };
      }
    }
  } catch {
    // fall through to generation
  }

  // Generate new Ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const privateKeyPem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);

  const stored = {
    version: 1,
    deviceId,
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now(),
  };

  // Ensure directory exists
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, {
    mode: 0o600,
  });

  return { deviceId, publicKeyPem, privateKeyPem };
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
  platform: string;
  deviceFamily?: string;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    params.platform.trim().toLowerCase(),
    (params.deviceFamily ?? "").trim().toLowerCase(),
  ].join("|");
}

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
  private onGatewayShutdownCallback:
    | ((payload: {
        restartExpectedMs: number | null;
        reason: string | null;
      }) => void)
    | null = null;
  private readonly url: string;
  private readonly token: string;
  private readonly deviceIdentity: DeviceIdentity;

  constructor(env: ControllerEnv) {
    this.url = `ws://127.0.0.1:${env.openclawGatewayPort}`;
    this.token = env.openclawGatewayToken ?? "";
    this.deviceIdentity = loadOrCreateDeviceIdentity(
      path.join(env.openclawStateDir, "identity", "device.json"),
    );
  }

  /** Register a callback fired once each time the WS handshake completes. */
  onConnected(cb: () => void): void {
    this.onConnectedCallback = cb;
  }

  onGatewayShutdown(
    cb: (payload: {
      restartExpectedMs: number | null;
      reason: string | null;
    }) => void,
  ): void {
    this.onGatewayShutdownCallback = cb;
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
    logger.info({ url: this.url }, "openclaw_ws_connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    // Native WebSocket: use event handler properties instead of ws .on()
    ws.onmessage = (event) => {
      const data = event.data;
      this.handleMessage(typeof data === "string" ? data : String(data));
    };

    let didCleanup = false;
    const cleanupOnce = () => {
      if (didCleanup) return;
      didCleanup = true;
      this.cleanup();
      this.scheduleReconnect();
    };

    ws.onclose = (event) => {
      logger.info(
        { code: event.code, reason: event.reason },
        "openclaw_ws_closed",
      );
      cleanupOnce();
    };

    ws.onerror = () => {
      logger.warn({}, "openclaw_ws_error");
      // Native WebSocket does NOT fire onclose after a connection-refused error
      // (unlike the `ws` npm package). Force cleanup + reconnect here.
      cleanupOnce();
    };
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
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this._connected) {
      throw new Error("openclaw gateway not connected");
    }
    const id = randomUUID();
    const frame: RequestFrame = { type: "req", id, method, params };
    const timeoutMs = opts?.timeoutMs ?? REQUEST_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `openclaw request "${method}" timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

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
        logger.error({}, "openclaw_ws_missing_nonce");
        this.ws?.close(1008, "missing nonce");
        return;
      }
      this.sendConnectRequest(nonce);
      return;
    }

    if (evt.event === "tick") {
      this.lastTick = Date.now();
      return;
    }

    if (evt.event === "shutdown") {
      const payload =
        evt.payload && typeof evt.payload === "object"
          ? (evt.payload as {
              restartExpectedMs?: unknown;
              reason?: unknown;
            })
          : undefined;
      const restartExpectedMs =
        typeof payload?.restartExpectedMs === "number" &&
        Number.isFinite(payload.restartExpectedMs)
          ? payload.restartExpectedMs
          : null;
      const reason =
        typeof payload?.reason === "string" && payload.reason.trim().length > 0
          ? payload.reason
          : null;

      logger.info({ restartExpectedMs, reason }, "openclaw_ws_shutdown_event");

      try {
        this.onGatewayShutdownCallback?.({ restartExpectedMs, reason });
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "openclaw_ws_on_shutdown_callback_error",
        );
      }
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

  private sendConnectRequest(nonce: string): void {
    const id = randomUUID();
    const signedAtMs = Date.now();
    const role = "operator";
    const scopes = ["operator.admin"];
    const clientId = "gateway-client";
    const clientMode = "backend";
    const platform = process.platform;

    // Build v3 auth payload and sign with device identity
    const payloadStr = buildDeviceAuthPayloadV3({
      deviceId: this.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: this.token,
      nonce,
      platform,
    });
    const signature = signDevicePayload(
      this.deviceIdentity.privateKeyPem,
      payloadStr,
    );

    const frame: RequestFrame = {
      type: "req",
      id,
      method: "connect",
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: clientId,
          version: "1.0.0",
          platform,
          mode: clientMode,
        },
        device: {
          id: this.deviceIdentity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(
            this.deviceIdentity.publicKeyPem,
          ),
          signature,
          signedAt: signedAtMs,
          nonce,
        },
        auth: { token: this.token },
        role,
        scopes,
      },
    };

    const timer = setTimeout(() => {
      this.pending.delete(id);
      logger.error({}, "openclaw_ws_connect_timeout");
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

        logger.info({}, "openclaw_ws_connected");

        // Fire the onConnected callback (e.g. to push initial config)
        try {
          this.onConnectedCallback?.();
        } catch (err) {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            "openclaw_ws_on_connected_callback_error",
          );
        }
      },
      reject: (err) => {
        logger.error({ error: err.message }, "openclaw_ws_connect_failed");
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
          logger.warn({ gapMs: gap }, "openclaw_ws_tick_timeout");
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
    logger.info({ delayMs: delay }, "openclaw_ws_reconnect_scheduled");
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.connect();
    }, delay);
  }
}
