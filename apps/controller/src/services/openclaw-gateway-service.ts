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
import { serializeOpenClawConfig } from "../lib/openclaw-config-serialization.js";
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
  linked?: boolean;
}

export interface ChannelSelfPresence {
  e164?: string | null;
  jid?: string | null;
}

export interface ChannelSummarySnapshot {
  configured?: boolean;
  linked?: boolean;
  self?: ChannelSelfPresence | null;
}

/** Result of channels.status RPC. */
export interface ChannelsStatusResult {
  channelOrder: string[];
  channels?: Record<string, ChannelSummarySnapshot>;
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

export interface LogoutChannelAccountResult {
  cleared?: boolean;
  loggedOut?: boolean;
}

interface LiveStatusChannelInput {
  id: string;
  channelType: string;
  accountId: string;
}

function isImplicitlyReadyChannelType(channelType: string): boolean {
  return channelType === "feishu";
}

function isConfiguredAsConnectedChannelType(channelType: string): boolean {
  return channelType === "dingtalk";
}

function resolveOpenClawChannelType(channelType: string): string {
  if (channelType === "wechat") {
    return "openclaw-weixin";
  }
  if (channelType === "dingtalk") {
    return "dingtalk-connector";
  }
  return channelType;
}

function resolveOpenClawAccountId(
  channelType: string,
  accountId: string,
): string {
  if (channelType === "dingtalk" && accountId === "default") {
    return "__default__";
  }
  return accountId;
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

  async getGatewayHealthSnapshot(opts?: {
    timeoutMs?: number;
    probe?: boolean;
  }): Promise<unknown> {
    return this.wsClient.request(
      "health",
      {
        probe: opts?.probe ?? false,
      },
      {
        timeoutMs: opts?.timeoutMs ?? 1000,
      },
    );
  }

  async getGatewayStatusSummary(opts?: {
    timeoutMs?: number;
  }): Promise<unknown> {
    return this.wsClient.request("status", undefined, {
      timeoutMs: opts?.timeoutMs ?? 1000,
    });
  }

  async getGatewayConfigSnapshot(opts?: {
    timeoutMs?: number;
  }): Promise<unknown> {
    return this.wsClient.request(
      "config.get",
      {},
      {
        timeoutMs: opts?.timeoutMs ?? 1000,
      },
    );
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
    const startedAt = Date.now();
    const idempotencyKey =
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
        .digest("hex");

    logger.info(
      {
        channel: input.channel,
        to: input.to,
        accountId: input.accountId ?? null,
        threadId: input.threadId ?? null,
        sessionKey: input.sessionKey ?? null,
        idempotencyKey,
        messageLength: input.message.length,
      },
      "openclaw_send_request_start",
    );

    try {
      const result = await this.wsClient.request<SendChannelMessageResult>(
        "send",
        {
          to: input.to,
          message: input.message,
          channel: input.channel,
          accountId: input.accountId,
          threadId: input.threadId,
          sessionKey: input.sessionKey,
          idempotencyKey,
        },
      );

      logger.info(
        {
          channel: input.channel,
          idempotencyKey,
          durationMs: Date.now() - startedAt,
          runId: result.runId ?? null,
          messageId: result.messageId ?? null,
          conversationId: result.conversationId ?? null,
        },
        "openclaw_send_request_success",
      );

      return result;
    } catch (error) {
      logger.warn(
        {
          channel: input.channel,
          idempotencyKey,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        },
        "openclaw_send_request_failure",
      );
      throw error;
    }
  }

  async logoutChannelAccount(
    channelType: string,
    accountId?: string,
  ): Promise<LogoutChannelAccountResult> {
    const channel = resolveOpenClawChannelType(channelType.trim());
    return this.wsClient.request<LogoutChannelAccountResult>(
      "channels.logout",
      {
        channel,
        ...(accountId ? { accountId } : {}),
      },
      { timeoutMs: 5000 },
    );
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
      // WS is not connected: we cannot observe live channel status. Report
      // "connecting" regardless of boot phase so the UI surfaces a neutral
      // gateway-offline state instead of a per-channel credential failure,
      // and preserve configured: true for channels with persisted credentials
      // so the UI does not render the "not configured" reconnect prompt.
      return {
        gatewayConnected: false,
        channels: channels.map((channel) => ({
          channelType: channel.channelType,
          channelId: channel.id,
          accountId: channel.accountId,
          status: "connecting",
          ready: false,
          connected: false,
          running: false,
          configured: true,
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
          const openclawChannelId = resolveOpenClawChannelType(
            channel.channelType,
          );
          const openclawAccountId = resolveOpenClawAccountId(
            channel.channelType,
            channel.accountId,
          );
          const accounts = status.channelAccounts?.[openclawChannelId] ?? [];
          const snapshot = accounts.find(
            (entry) => entry.accountId === openclawAccountId,
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

          // WeChat "not configured" typically means session expired — the
          // plugin paused after errcode -14 and gateway sees the channel as
          // unconfigured. Surface a friendlier error.
          const friendlyError =
            openclawChannelId === "openclaw-weixin" &&
            lastError === "not configured" &&
            !running
              ? "session expired"
              : lastError;

          // For channels like Feishu where `connected` is always false
          // (they use long-polling/WS to Feishu servers, not a direct
          // inbound connection), running + configured + no error means
          // the channel is operational.
          const operationalWithoutProbe =
            (running && configured && !lastError) ||
            (isConfiguredAsConnectedChannelType(channel.channelType) &&
              configured &&
              !lastError);
          const effectiveRunning =
            enabled && (running || operationalWithoutProbe);
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

          if (
            openclawChannelId === "openclaw-weixin" &&
            derivedStatus !== "connected"
          ) {
            logger.info(
              {
                channelId: channel.id,
                accountId: channel.accountId,
                rawSnapshot: {
                  running,
                  configured,
                  connected,
                  enabled,
                  restartPending: snapshot.restartPending === true,
                  lastError,
                  probeOk: hasProbeOk,
                },
                derivedStatus,
              },
              "openclaw_weixin_live_status_non_connected",
            );
          }

          return {
            channelType: channel.channelType,
            channelId: channel.id,
            accountId: channel.accountId,
            status: derivedStatus,
            ready,
            connected: enabled && connected,
            running: effectiveRunning,
            configured,
            lastError: friendlyError,
          };
        }),
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "openclaw_channels_live_status_error",
      );
      // Gateway RPC failed mid-flight — treat as a transient gateway outage.
      // Report "connecting" + configured: true so the UI shows the
      // gateway-offline banner instead of prompting users to re-authenticate
      // channels whose credentials on disk are still valid.
      return {
        gatewayConnected: false,
        channels: channels.map((channel) => ({
          channelType: channel.channelType,
          channelId: channel.id,
          accountId: channel.accountId,
          status: "connecting",
          ready: false,
          connected: false,
          running: false,
          configured: true,
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
      const openclawId = resolveOpenClawChannelType(channelType);
      const openclawAccountId = resolveOpenClawAccountId(
        channelType,
        accountId,
      );
      const accounts = status.channelAccounts?.[openclawId] ?? [];
      const snapshot = accounts.find((a) => a.accountId === openclawAccountId);

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
      const isConfiguredReady =
        isConfiguredAsConnectedChannelType(channelType) &&
        snapshot.configured === true &&
        !snapshot.lastError;
      const ready = isConnected || isWebhookReady || isConfiguredReady;

      return {
        ready,
        connected: snapshot.connected ?? false,
        running: snapshot.running ?? isConfiguredReady,
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

  async whatsappQrStart(accountId: string): Promise<{
    qrDataUrl?: string;
    message: string;
    accountId?: string;
  }> {
    if (!this.wsClient.isConnected()) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    return this.wsClient.request(
      "web.login.start",
      {
        accountId,
        force: true,
      },
      { timeoutMs: 60_000 },
    );
  }

  async whatsappQrWait(accountId: string): Promise<{
    connected: boolean;
    message: string;
  }> {
    return this.wsClient.request(
      "web.login.wait",
      { accountId },
      { timeoutMs: 500_000 },
    );
  }

  private configHash(config: OpenClawConfig): string {
    return createHash("sha256")
      .update(serializeOpenClawConfig(config))
      .digest("hex");
  }
}
