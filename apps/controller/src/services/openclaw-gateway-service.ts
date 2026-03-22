/**
 * OpenClaw Gateway Service
 *
 * High-level business API for communicating with the OpenClaw Gateway via
 * WebSocket RPC. Wraps the low-level OpenClawWsClient to provide:
 *
 * - Config push (direct file write for hot-reload without restart)
 * - Channel status query (channels.status)
 * - Single-channel readiness check
 */

import { createHash } from "node:crypto";
import type { OpenClawConfig } from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";

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
  restartPending?: boolean;
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

export type ChannelLiveStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "restarting";

export interface ChannelLiveStatusEntry {
  channelType: string;
  channelId: string;
  accountId: string;
  status: ChannelLiveStatus;
  ready: boolean;
  connected: boolean;
  running: boolean;
  configured: boolean;
  lastError: string | null;
}

export interface SendChannelMessageInput {
  channel: string;
  to: string;
  message: string;
  accountId?: string;
  threadId?: string;
  sessionKey?: string;
  idempotencyKey?: string;
}

export interface SendChannelMessageResult {
  runId?: string;
  messageId?: string;
  channel?: string;
  chatId?: string;
  conversationId?: string;
}

interface LiveStatusChannelInput {
  id: string;
  channelType: string;
  accountId: string;
}

function isImplicitlyReadyChannelType(channelType: string): boolean {
  return channelType === "feishu";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OpenClawGatewayService {
  /** SHA-256 hash of the last config we successfully observed. */
  private lastPushedConfigHash: string | null = null;

  constructor(private readonly wsClient: OpenClawWsClient) {}

  /** Whether the WS client has completed handshake and is ready for RPC. */
  isConnected(): boolean {
    return this.wsClient.isConnected();
  }

  /**
   * Pre-seed the config hash so the next pushConfig() call skips if
   * the config hasn't changed. Used during bootstrap to avoid a
   * redundant config.apply → SIGUSR1 cycle on first WS connect.
   */
  preSeedConfigHash(config: OpenClawConfig): void {
    this.lastPushedConfigHash = this.configHash(config);
  }

  async shouldPushConfig(config: OpenClawConfig): Promise<boolean> {
    const hash = this.configHash(config);

    if (hash === this.lastPushedConfigHash) {
      logger.info({}, "openclaw_push_skipped_unchanged");
      return false;
    }
    return true;
  }

  noteConfigWritten(config: OpenClawConfig): void {
    this.lastPushedConfigHash = this.configHash(config);
  }

  /**
   * Query the runtime status snapshot of all channels.
   * When probe=true, real-time probes are triggered (e.g. Feishu bot-info validation).
   */
  async getChannelsStatus(): Promise<ChannelsStatusResult> {
    return this.getChannelsStatusSnapshot({ probe: true, timeoutMs: 8000 });
  }

  async sendChannelMessage(
    input: SendChannelMessageInput,
  ): Promise<SendChannelMessageResult> {
    return this.wsClient.request<SendChannelMessageResult>("send", {
      to: input.to,
      message: input.message,
      channel: input.channel,
      accountId: input.accountId,
      threadId: input.threadId,
      sessionKey: input.sessionKey,
      idempotencyKey:
        input.idempotencyKey ??
        createHash("sha256")
          .update(
            JSON.stringify({
              channel: input.channel,
              to: input.to,
              message: input.message,
              accountId: input.accountId ?? null,
              threadId: input.threadId ?? null,
              sessionKey: input.sessionKey ?? null,
            }),
          )
          .digest("hex"),
    });
  }

  async getChannelsStatusSnapshot(opts?: {
    probe?: boolean;
    timeoutMs?: number;
  }): Promise<ChannelsStatusResult> {
    return this.wsClient.request<ChannelsStatusResult>("channels.status", {
      probe: opts?.probe ?? true,
      timeoutMs: opts?.timeoutMs ?? 8000,
    });
  }

  async getAllChannelsLiveStatus(channels: LiveStatusChannelInput[]): Promise<{
    gatewayConnected: boolean;
    channels: ChannelLiveStatusEntry[];
  }> {
    if (!this.wsClient.isConnected()) {
      return {
        gatewayConnected: false,
        channels: channels.map((channel) => ({
          channelType: channel.channelType,
          channelId: channel.id,
          accountId: channel.accountId,
          status: "disconnected",
          ready: false,
          connected: false,
          running: false,
          configured: false,
          lastError: null,
        })),
      };
    }

    try {
      const status = await this.getChannelsStatusSnapshot({
        probe: false,
        timeoutMs: 1000,
      });

      return {
        gatewayConnected: true,
        channels: channels.map((channel) => {
          const openclawChannelId =
            channel.channelType === "wechat"
              ? "openclaw-weixin"
              : channel.channelType;
          const accounts = status.channelAccounts?.[openclawChannelId] ?? [];
          const snapshot = accounts.find(
            (entry) => entry.accountId === channel.accountId,
          );

          if (!snapshot) {
            if (isImplicitlyReadyChannelType(channel.channelType)) {
              return {
                channelType: channel.channelType,
                channelId: channel.id,
                accountId: channel.accountId,
                status: "connected" satisfies ChannelLiveStatus,
                ready: true,
                connected: false,
                running: true,
                configured: true,
                lastError: null,
              };
            }

            return {
              channelType: channel.channelType,
              channelId: channel.id,
              accountId: channel.accountId,
              status: "restarting" satisfies ChannelLiveStatus,
              ready: false,
              connected: false,
              running: false,
              configured: false,
              lastError: null,
            };
          }

          const connected = snapshot.connected === true;
          const running = snapshot.running === true;
          const configured = snapshot.configured === true;
          const enabled = snapshot.enabled !== false;
          const hasProbeOk = snapshot.probe?.ok === true;
          const rawLastError = snapshot.lastError?.trim()
            ? snapshot.lastError
            : null;
          const lastError = rawLastError === "disabled" ? null : rawLastError;

          // For channels like Feishu where `connected` is always false
          // (they use long-polling/WS to Feishu servers, not a direct
          // inbound connection), running + configured + no error means
          // the channel is operational.
          const operationalWithoutProbe = running && configured && !lastError;
          const ready =
            enabled &&
            (connected ||
              (running && configured && hasProbeOk) ||
              operationalWithoutProbe);

          let derivedStatus: ChannelLiveStatus;
          if (!enabled) {
            derivedStatus = "disconnected";
          } else if (lastError) {
            derivedStatus = "error";
          } else if (snapshot.restartPending === true) {
            derivedStatus = "restarting";
          } else if (ready || operationalWithoutProbe) {
            derivedStatus = "connected";
          } else if (running) {
            derivedStatus = "connecting";
          } else {
            derivedStatus = "disconnected";
          }

          return {
            channelType: channel.channelType,
            channelId: channel.id,
            accountId: channel.accountId,
            status: derivedStatus,
            ready,
            connected: enabled && connected,
            running: enabled && running,
            configured,
            lastError,
          };
        }),
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "openclaw_channels_live_status_error",
      );
      return {
        gatewayConnected: false,
        channels: channels.map((channel) => ({
          channelType: channel.channelType,
          channelId: channel.id,
          accountId: channel.accountId,
          status: "disconnected",
          ready: false,
          connected: false,
          running: false,
          configured: false,
          lastError: null,
        })),
      };
    }
  }

  /**
   * Query the readiness state of a single channel.
   *
   * Readiness logic:
   * - WebSocket-based channels (Slack/Discord): connected === true
   * - Webhook-based channels (Feishu): running && configured && probe.ok
   *
   * Returns gatewayConnected: false when WS is not connected (graceful degradation).
   */
  async getChannelReadiness(
    channelType: string,
    accountId: string,
  ): Promise<ChannelReadiness> {
    if (!this.wsClient.isConnected()) {
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
      const status = await this.getChannelsStatus();
      const openclawId =
        channelType === "wechat" ? "openclaw-weixin" : channelType;
      const accounts = status.channelAccounts?.[openclawId] ?? [];
      const snapshot = accounts.find((a) => a.accountId === accountId);

      if (!snapshot) {
        if (isImplicitlyReadyChannelType(channelType)) {
          return {
            ready: true,
            connected: false,
            running: true,
            configured: true,
            lastError: null,
            gatewayConnected: true,
          };
        }

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
      const isEnabled = snapshot.enabled !== false;
      if (!isEnabled) {
        return {
          ready: false,
          connected: false,
          running: false,
          configured: snapshot.configured ?? false,
          lastError: null,
          gatewayConnected: true,
        };
      }

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
      logger.warn(
        {
          channelType,
          accountId,
          error: err instanceof Error ? err.message : String(err),
        },
        "openclaw_channel_readiness_error",
      );
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

  async wechatQrStart(): Promise<{
    qrDataUrl?: string;
    message: string;
    sessionKey?: string;
  }> {
    // Retry once if the WS hasn't reconnected yet (e.g. after config push restart).
    if (!this.wsClient.isConnected()) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    return this.wsClient.request("web.login.start", {});
  }

  async wechatQrWait(sessionKey: string): Promise<{
    connected: boolean;
    message: string;
    accountId?: string;
  }> {
    return this.wsClient.request(
      "web.login.wait",
      { accountId: sessionKey },
      { timeoutMs: 500_000 },
    );
  }

  private configHash(config: OpenClawConfig): string {
    return createHash("sha256").update(JSON.stringify(config)).digest("hex");
  }
}
