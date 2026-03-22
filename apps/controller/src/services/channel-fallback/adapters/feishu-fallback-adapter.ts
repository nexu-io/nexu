import type {
  ChannelFallbackAdapter,
  ChannelReplyOutcomePayload,
  FallbackErrorCode,
  FallbackTemplateMap,
  NormalizedFallback,
} from "../core/channel-fallback-types.js";

const FEISHU_FALLBACK_TEMPLATES: FallbackTemplateMap = {
  unknown: {
    en: "🤖 Sorry, I can't handle your request right now. Please try again later, or contact the NexU team for support: https://docs.nexu.io/guide/contact",
    "zh-CN":
      "🤖 抱歉，我暂时无法处理你的请求，请稍后重试，或联系 NexU 工作人员获取支持：https://docs.nexu.io/zh/guide/contact",
  },
  internal_error: {
    en: "Sorry, I hit an internal error while replying. Please try again in a moment.",
    "zh-CN": "抱歉，我刚刚回复时遇到内部错误。请稍后再试。",
  },
  reply_delivery_failed: {
    en: "Sorry, I couldn't deliver the previous reply successfully. Please try again in a moment.",
    "zh-CN": "抱歉，我刚刚没有成功送达上一条回复。请稍后再试。",
  },
  no_final_reply: {
    en: "Sorry, I couldn't finish the previous reply. Please try again in a moment.",
    "zh-CN": "抱歉，我刚刚没有完整完成上一条回复。请稍后再试。",
  },
  synthetic_pre_llm_failure: {
    en: "Sorry, Nexu intentionally interrupted this reply for diagnostics.",
    "zh-CN": "抱歉，这条回复被 Nexu 为诊断目的主动中断。",
  },
};

export class FeishuFallbackAdapter
  implements ChannelFallbackAdapter<FallbackErrorCode>
{
  readonly channel = "feishu";

  shouldHandle(payload: ChannelReplyOutcomePayload): boolean {
    if (payload.channel !== this.channel) {
      return false;
    }
    return payload.status === "failed" || payload.status === "silent";
  }

  normalize(
    payload: ChannelReplyOutcomePayload,
  ): NormalizedFallback<FallbackErrorCode> | null {
    const target = payload.to ?? chatIdToTarget(payload.chatId);
    if (!target) {
      return null;
    }

    const threadId = payload.replyToMessageId ?? payload.threadId ?? undefined;
    const actionId =
      payload.actionId ?? payload.turnId ?? payload.messageId ?? null;
    const receivedAt = payload.ts ?? new Date().toISOString();
    const override = parseSyntheticOverride(payload.syntheticInput);
    const errorCode = override?.errorCode ?? mapFeishuErrorCode(payload);
    const dedupeKey = payload.replyToMessageId ?? payload.messageId ?? null;

    return {
      channel: payload.channel,
      accountId: payload.accountId,
      actionId,
      receivedAt,
      claimKey: dedupeKey
        ? [
            payload.channel,
            payload.accountId ?? "default",
            dedupeKey,
            errorCode,
          ].join(":")
        : null,
      target: {
        to: target,
        threadId,
      },
      errorCode,
      params: {
        reasonCode: payload.reasonCode ?? payload.status,
        ...(override?.params ?? {}),
      },
      reasonCode: payload.reasonCode,
    };
  }

  resolveLang(_normalized: NormalizedFallback<FallbackErrorCode>) {
    return "en" as const;
  }

  getTemplateMap(): FallbackTemplateMap<FallbackErrorCode> {
    return FEISHU_FALLBACK_TEMPLATES;
  }

  toSendInput(input: {
    normalized: NormalizedFallback<FallbackErrorCode>;
    lang: "en" | "zh-CN";
    message: string;
  }) {
    const message = appendOptionalDiagnosticHint(
      input.message,
      input.normalized.params.hint,
      input.normalized.errorCode,
      input.lang,
    );

    return {
      channel: input.normalized.channel,
      accountId: input.normalized.accountId,
      to: input.normalized.target.to,
      threadId: input.normalized.target.threadId,
      message,
    };
  }
}

function appendOptionalDiagnosticHint(
  message: string,
  hint: string | undefined,
  errorCode: FallbackErrorCode,
  lang: "en" | "zh-CN",
): string {
  if (errorCode !== "unknown") {
    return message;
  }
  const trimmedHint = hint?.trim();
  if (!trimmedHint) {
    return message;
  }

  let suffix: string;
  switch (lang) {
    case "zh-CN":
      suffix = `诊断提示：${trimmedHint}`;
      break;
    default:
      suffix = `Diagnostic hint: ${trimmedHint}`;
      break;
  }

  return [message, suffix].join("\n\n");
}

function parseSyntheticOverride(
  syntheticInput?: string,
): { errorCode: FallbackErrorCode; params: Record<string, string> } | null {
  if (!syntheticInput) {
    return null;
  }

  try {
    const parsed = JSON.parse(syntheticInput) as {
      errorCode?: unknown;
      params?: unknown;
    };
    const errorCode = normalizeFallbackErrorCode(parsed.errorCode);
    return {
      errorCode,
      params: normalizeTemplateParams(parsed.params),
    };
  } catch {
    return {
      errorCode: "unknown",
      params: {},
    };
  }
}

function normalizeFallbackErrorCode(value: unknown): FallbackErrorCode {
  switch (value) {
    case "unknown":
    case "internal_error":
    case "reply_delivery_failed":
    case "no_final_reply":
    case "synthetic_pre_llm_failure":
      return value;
    default:
      return "unknown";
  }
}

function normalizeTemplateParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([key, entryValue]) => [key, String(entryValue)],
    ),
  );
}

function mapFeishuErrorCode(
  payload: ChannelReplyOutcomePayload,
): FallbackErrorCode {
  switch (payload.reasonCode) {
    case "synthetic_pre_llm_failure":
      return "synthetic_pre_llm_failure";
    case "final_reply_failed":
    case "block_reply_failed":
    case "media_reply_failed":
    case "dispatch_threw":
      return "reply_delivery_failed";
    case "no_final_reply":
      return "no_final_reply";
    default:
      return "unknown";
  }
}

function chatIdToTarget(chatId?: string): string | null {
  if (!chatId) {
    return null;
  }
  return `chat:${chatId}`;
}
