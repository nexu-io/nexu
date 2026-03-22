import type { SendChannelMessageInput } from "../../openclaw-gateway-service.js";

export type FallbackLang = "en" | "zh-CN";

export type FallbackErrorCode =
  | "unknown"
  | "internal_error"
  | "reply_delivery_failed"
  | "no_final_reply"
  | "synthetic_pre_llm_failure";

export interface ChannelReplyOutcomePayload {
  channel: string;
  status: string;
  reasonCode?: string;
  accountId?: string;
  to?: string;
  chatId?: string;
  threadId?: string;
  replyToMessageId?: string;
  sessionKey?: string;
  actionId?: string;
  turnId?: string;
  messageId?: string;
  error?: string;
  ts?: string;
  syntheticInput?: string;
}

export interface FallbackTarget {
  to: string;
  threadId?: string;
}

export interface NormalizedFallback<
  TErrorCode extends string = FallbackErrorCode,
> {
  channel: string;
  accountId?: string;
  actionId: string | null;
  receivedAt: string;
  claimKey: string | null;
  target: FallbackTarget;
  errorCode: TErrorCode;
  params: Record<string, string>;
  langHint?: FallbackLang;
  reasonCode?: string;
}

export type FallbackTemplateMap<TErrorCode extends string = FallbackErrorCode> =
  Record<TErrorCode, Partial<Record<FallbackLang, string>>>;

export interface RenderedFallbackMessage {
  lang: FallbackLang;
  template: string;
  message: string;
}

export interface ChannelFallbackAdapter<
  TErrorCode extends string = FallbackErrorCode,
> {
  readonly channel: string;
  shouldHandle(payload: ChannelReplyOutcomePayload): boolean;
  normalize(
    payload: ChannelReplyOutcomePayload,
  ): NormalizedFallback<TErrorCode> | null;
  resolveLang(normalized: NormalizedFallback<TErrorCode>): FallbackLang;
  getTemplateMap(): FallbackTemplateMap<TErrorCode>;
  toSendInput(input: {
    normalized: NormalizedFallback<TErrorCode>;
    lang: FallbackLang;
    message: string;
  }): SendChannelMessageInput;
}
