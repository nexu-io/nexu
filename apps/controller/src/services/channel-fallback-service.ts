import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import type { OpenClawRuntimeEvent } from "../runtime/openclaw-process.js";
import { FeishuFallbackAdapter } from "./channel-fallback/adapters/feishu-fallback-adapter.js";
import type {
  ChannelFallbackAdapter,
  FallbackErrorCode,
} from "./channel-fallback/core/channel-fallback-types.js";
import { resolveFallbackLang } from "./channel-fallback/core/lang-resolver.js";
import { parseChannelReplyOutcomePayload } from "./channel-fallback/core/payload-parser.js";
import { renderFallbackTemplate } from "./channel-fallback/core/template-renderer.js";
import { selectFallbackTemplate } from "./channel-fallback/core/template-selector.js";
import type {
  SendChannelMessageInput,
  SendChannelMessageResult,
} from "./openclaw-gateway-service.js";

const MAX_RECENT_EVENTS = 100;
const CLAIM_TTL_MS = 10 * 60 * 1000;
export interface ReplyOutcomeRuntimeEvent {
  event: "channel.reply_outcome";
  payload?: unknown;
}

export interface ChannelFallbackDiagnosticEntry {
  id: string;
  receivedAt: string;
  channel: string;
  status: string;
  reasonCode: string | null;
  accountId: string | null;
  to: string | null;
  threadId: string | null;
  sessionKey: string | null;
  actionId: string | null;
  fallbackOutcome: "sent" | "skipped" | "failed";
  fallbackReason: string;
  error: string | null;
  sendResult: SendChannelMessageResult | null;
}

export interface ChannelFallbackEventSource {
  onRuntimeEvent(listener: (event: OpenClawRuntimeEvent) => void): () => void;
}

export interface ChannelFallbackMessageSender {
  sendChannelMessage(
    input: SendChannelMessageInput,
  ): Promise<SendChannelMessageResult>;
}

export interface ChannelFallbackLocaleProvider {
  getLocale(): Promise<"en" | "zh-CN"> | "en" | "zh-CN";
}

export class ChannelFallbackService {
  private unsubscribe: (() => void) | null = null;
  private readonly recentEvents: ChannelFallbackDiagnosticEntry[] = [];
  private readonly claimedKeys = new Map<string, number>();
  private readonly adapters = new Map<string, ChannelFallbackAdapter>([
    ["feishu", new FeishuFallbackAdapter()],
  ]);

  constructor(
    private readonly eventSource: ChannelFallbackEventSource,
    private readonly messageSender: ChannelFallbackMessageSender,
    private readonly localeProvider: ChannelFallbackLocaleProvider,
  ) {}

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.eventSource.onRuntimeEvent((event) => {
      if (event.event !== "channel.reply_outcome") {
        return;
      }
      void this.handleReplyOutcome(event as ReplyOutcomeRuntimeEvent);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  listRecentEvents(limit = 20): ChannelFallbackDiagnosticEntry[] {
    const normalizedLimit = Math.max(1, Math.min(limit, MAX_RECENT_EVENTS));
    return this.recentEvents.slice(-normalizedLimit).reverse();
  }

  private async handleReplyOutcome(
    event: ReplyOutcomeRuntimeEvent,
  ): Promise<void> {
    const payload = parseChannelReplyOutcomePayload(event.payload);
    if (!payload) {
      this.remember({
        id: randomUUID(),
        receivedAt: new Date().toISOString(),
        channel: "unknown",
        status: "invalid",
        reasonCode: null,
        accountId: null,
        to: null,
        threadId: null,
        sessionKey: null,
        actionId: null,
        fallbackOutcome: "skipped",
        fallbackReason: "invalid_payload",
        error: null,
        sendResult: null,
      });
      return;
    }

    const adapter = this.adapters.get(payload.channel);
    if (!adapter) {
      this.remember({
        id: randomUUID(),
        receivedAt: payload.ts ?? new Date().toISOString(),
        channel: payload.channel,
        status: payload.status,
        reasonCode: payload.reasonCode ?? null,
        accountId: payload.accountId ?? null,
        to: payload.to ?? null,
        threadId: payload.replyToMessageId ?? payload.threadId ?? null,
        sessionKey: payload.sessionKey ?? null,
        actionId:
          payload.actionId ??
          payload.turnId ??
          payload.messageId ??
          payload.sessionKey ??
          null,
        fallbackOutcome: "skipped",
        fallbackReason: "unsupported_channel",
        error: null,
        sendResult: null,
      });
      return;
    }

    const normalized = adapter.normalize(payload);
    const receivedAt =
      normalized?.receivedAt ?? payload.ts ?? new Date().toISOString();
    const baseEntry = {
      id: randomUUID(),
      receivedAt,
      channel: payload.channel,
      status: payload.status,
      reasonCode: payload.reasonCode ?? null,
      accountId: payload.accountId ?? null,
      to: normalized?.target.to ?? payload.to ?? null,
      threadId:
        normalized?.target.threadId ??
        payload.replyToMessageId ??
        payload.threadId ??
        null,
      sessionKey: payload.sessionKey ?? null,
      actionId: normalized?.actionId ?? null,
    } satisfies Omit<
      ChannelFallbackDiagnosticEntry,
      "fallbackOutcome" | "fallbackReason" | "error" | "sendResult"
    >;

    if (!adapter.shouldHandle(payload)) {
      this.remember({
        ...baseEntry,
        fallbackOutcome: "skipped",
        fallbackReason: "ignored_event",
        error: null,
        sendResult: null,
      });
      return;
    }

    if (!normalized) {
      this.remember({
        ...baseEntry,
        fallbackOutcome: "skipped",
        fallbackReason: "missing_target",
        error: null,
        sendResult: null,
      });
      return;
    }

    if (normalized.claimKey && !this.claim(normalized.claimKey)) {
      this.remember({
        ...baseEntry,
        fallbackOutcome: "skipped",
        fallbackReason: "duplicate_claim",
        error: null,
        sendResult: null,
      });
      return;
    }

    const lang = resolveFallbackLang(
      normalized,
      await this.localeProvider.getLocale(),
    );
    const template = selectFallbackTemplate(
      adapter.getTemplateMap() as Record<
        FallbackErrorCode,
        Partial<Record<"en" | "zh-CN", string>>
      >,
      normalized.errorCode as FallbackErrorCode,
      lang,
    );
    const message = renderFallbackTemplate(template, normalized.params);
    const sendInput = adapter.toSendInput({ normalized, lang, message });

    try {
      const sendResult = await this.messageSender.sendChannelMessage({
        ...sendInput,
        sessionKey: payload.sessionKey,
        idempotencyKey: normalized.claimKey
          ? `fallback:${normalized.claimKey}`
          : undefined,
      });

      logger.info(
        {
          channel: payload.channel,
          accountId: payload.accountId ?? null,
          to: normalized.target.to,
          actionId: normalized.actionId,
          errorCode: normalized.errorCode,
          lang,
          reasonCode: payload.reasonCode ?? null,
          messageId: sendResult.messageId ?? null,
        },
        "channel_fallback_sent",
      );

      this.remember({
        ...baseEntry,
        fallbackOutcome: "sent",
        fallbackReason: "fallback_sent",
        error: null,
        sendResult,
      });
    } catch (error) {
      if (normalized.claimKey) {
        this.claimedKeys.delete(normalized.claimKey);
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        {
          channel: payload.channel,
          accountId: payload.accountId ?? null,
          to: normalized.target.to,
          actionId: normalized.actionId,
          errorCode: normalized.errorCode,
          lang,
          reasonCode: payload.reasonCode ?? null,
          error: message,
        },
        "channel_fallback_send_failed",
      );
      this.remember({
        ...baseEntry,
        fallbackOutcome: "failed",
        fallbackReason: "send_failed",
        error: message,
        sendResult: null,
      });
    }
  }

  private claim(key: string): boolean {
    const now = Date.now();
    for (const [entryKey, claimedAt] of this.claimedKeys) {
      if (now - claimedAt > CLAIM_TTL_MS) {
        this.claimedKeys.delete(entryKey);
      }
    }
    if (this.claimedKeys.has(key)) {
      return false;
    }
    this.claimedKeys.set(key, now);
    return true;
  }
  private remember(entry: ChannelFallbackDiagnosticEntry): void {
    this.recentEvents.push(entry);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS);
    }
  }
}
