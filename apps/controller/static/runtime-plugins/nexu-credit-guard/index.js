/**
 * nexu-credit-guard
 *
 * Intercepts OpenClaw's default error replies and replaces them with
 * Nexu-specific user-facing messages, localised to the desktop locale.
 *
 * Detection strategy:
 *  1. `llm_output` — inspects `lastAssistant` for raw error text from the
 *     link service, extracts the error code, and caches it per session.
 *  2. `message_sending` — when the outgoing message looks like an error
 *     (starts with "⚠️" or matches known OpenClaw error patterns), checks
 *     for a cached error code and replaces the message with the localised
 *     version. Falls back to pattern-matching the message content directly.
 *
 * Locale is read from `nexu-credit-guard-state.json` (written by the
 * controller alongside `nexu-runtime-model.json`) so changes take effect
 * without an OpenClaw restart.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Locale state (file-based, hot-reloadable) ──────────────────────

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(
  pluginDir,
  "..",
  "..",
  "nexu-credit-guard-state.json",
);

let cachedMtimeMs = null;
let cachedState = null;

function loadState() {
  try {
    const nextMtimeMs = statSync(statePath).mtimeMs;
    if (cachedState && cachedMtimeMs === nextMtimeMs) {
      return cachedState;
    }
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    cachedMtimeMs = nextMtimeMs;
    cachedState = parsed;
    return parsed;
  } catch {
    // Default to "en" when the state file is missing or unreadable so we
    // stay aligned with the controller's own default locale (also "en"
    // when desktop.locale is unset). Returning "zh-CN" here would mean
    // English users get Chinese error replacements during the brief
    // window before the controller writes the state file for the first
    // time.
    return cachedState ?? { locale: "en" };
  }
}

// ── i18n messages ───────────────────────────────────────────────────

const CONTACT_LABEL = { "zh-CN": "联系我们", en: "Contact us" };

function t(locale, zhMsg, enMsg, contactUrl) {
  const msg = locale === "en" ? enMsg : zhMsg;
  const contactLabel = CONTACT_LABEL[locale] || CONTACT_LABEL["en"];
  if (contactUrl) {
    return msg.replace("{contact}", `[${contactLabel}](${contactUrl})`);
  }
  return msg.replace("{contact}", contactLabel);
}

// Each entry: [zhMessage, enMessage]
// {contact} placeholder is replaced with the localised "联系我们" / "Contact us" link.
const ERROR_MESSAGES = {
  missing_api_key: [
    "⚠️ 未检测到访问凭证，暂时无法继续使用。请先检查是否已经完成账号登录，或是否已经填写访问密钥（用于连接模型服务的凭证）。如仍无法解决，请查看 {contact}。",
    "⚠️ No access credentials detected. Please check that you are logged in or that you have entered your API key. If the issue persists, see {contact}.",
  ],
  invalid_api_key: [
    "⚠️ 你填写的访问密钥无效，暂时无法使用。请检查是否复制完整、是否填错，或换一个新的密钥后再试。如仍无法解决，请查看 {contact}。",
    "⚠️ The API key you entered is invalid. Please check it for typos or try a different key. If the issue persists, see {contact}.",
  ],
  forbidden_api_key: [
    "⚠️ 当前访问密钥不可用，可能已经过期、被停用或被撤销。请更换一个可用的密钥后再试。如仍无法解决，请查看 {contact}。",
    "⚠️ Your API key is no longer usable — it may have expired or been revoked. Please replace it and try again. If the issue persists, see {contact}.",
  ],
  insufficient_credits: [
    "⚠️ 当前可用积分不足，暂时无法继续使用。你可以购买 nexu 的会员补充积分，或切换到自带密钥的方式继续使用。如仍无法解决，请查看 {contact}。",
    "⚠️ Insufficient credits. You can purchase a nexu plan to top up, or switch to using your own API key. If the issue persists, see {contact}.",
  ],
  usage_limit_exceeded: [
    "⚠️ 当前请求过于频繁，已达到本时段的使用上限，请稍后再试。如仍无法解决，请查看 {contact}。",
    "⚠️ You've reached the usage limit for this period. Please try again later. If the issue persists, see {contact}.",
  ],
  invalid_json: [
    "⚠️ 提交的内容格式不正确，系统暂时无法识别。请检查后重新提交。如仍无法解决，请查看 {contact}。",
    "⚠️ The submitted content has an invalid format. Please check and resubmit. If the issue persists, see {contact}.",
  ],
  invalid_model: [
    "⚠️ 当前模型暂不可用，请稍后重试。如仍无法解决，请查看 {contact}。",
    "⚠️ The current model is temporarily unavailable. Please try again later. If the issue persists, see {contact}.",
  ],
  invalid_request: [
    "⚠️ 本次提交的内容有误，系统暂时无法处理。请检查填写内容是否完整、格式是否正确，然后再试一次。如仍无法解决，请查看 {contact}。",
    "⚠️ The request is invalid. Please check that all fields are filled in correctly and try again. If the issue persists, see {contact}.",
  ],
  model_not_found: [
    "⚠️ 你选择的模型当前不可用，可能尚未配置成功，或暂时无法访问。请更换其他模型，或检查相关设置后重试。如仍无法解决，请查看 {contact}。",
    "⚠️ The selected model is not available. It may not be configured yet or is temporarily inaccessible. Please switch to another model or check your settings. If the issue persists, see {contact}.",
  ],
  request_too_large: [
    "⚠️ 本次提交的内容过多，系统暂时无法处理。请缩短消息内容、减少附件或分几次发送后再试。如仍无法解决，请查看 {contact}。",
    "⚠️ The request is too large. Please shorten your message, reduce attachments, or split into multiple messages. If the issue persists, see {contact}.",
  ],
  internal_error: [
    "⚠️ 服务暂时出了点问题，请稍后再试一次。如多次出现同样的问题，请查看 {contact}。",
    "⚠️ Something went wrong on our end. Please try again later. If this keeps happening, see {contact}.",
  ],
  streaming_unsupported: [
    "⚠️ 当前暂不支持这种返回方式，请换一种方式再试，或稍后重试。如仍无法解决，请查看 {contact}。",
    "⚠️ Streaming is not supported for this request. Please try a different approach or try again later. If the issue persists, see {contact}.",
  ],
  upstream_error: [
    "⚠️ 当前连接的模型服务暂时不可用，请稍后重试，或更换其他模型后再试。如仍无法解决，请查看 {contact}。",
    "⚠️ The upstream model service is temporarily unavailable. Please try again later or switch to a different model. If the issue persists, see {contact}.",
  ],
};

// ── Error code extraction from raw LLM error ───────────────────────

const KNOWN_ERROR_CODES = new Set(Object.keys(ERROR_MESSAGES));

/**
 * Try to extract a link error code from the raw assistant error payload.
 * The link service returns JSON like:
 *   {"error":{"code":"insufficient_credits","message":"insufficient credits"}}
 * OpenClaw stores the stringified error in lastAssistant.errorMessage.
 */
function extractErrorCode(lastAssistant) {
  if (!lastAssistant) return null;

  const errorMessage =
    typeof lastAssistant === "string"
      ? lastAssistant
      : lastAssistant.errorMessage ?? lastAssistant.error ?? "";

  if (!errorMessage) return null;

  const str = typeof errorMessage === "string" ? errorMessage : String(errorMessage);

  // Direct code match (e.g. the raw JSON or text contains the error code)
  for (const code of KNOWN_ERROR_CODES) {
    if (str.includes(code)) {
      return code;
    }
  }

  // Try parsing embedded JSON
  try {
    const jsonMatch = str.match(/\{[\s\S]*"code"\s*:\s*"([^"]+)"[\s\S]*\}/);
    if (jsonMatch?.[1] && KNOWN_ERROR_CODES.has(jsonMatch[1])) {
      return jsonMatch[1];
    }
  } catch {
    // ignore
  }

  return null;
}

// ── Fallback: pattern-match the formatted message content ───────────

const CONTENT_PATTERNS = [
  { pattern: /insufficient.credit/i, code: "insufficient_credits" },
  { pattern: /billing.error/i, code: "insufficient_credits" },
  { pattern: /run out of credits/i, code: "insufficient_credits" },
  { pattern: /credit balance.+too low/i, code: "insufficient_credits" },
  { pattern: /insufficient.balance/i, code: "insufficient_credits" },
  { pattern: /payment.required/i, code: "insufficient_credits" },
  { pattern: /insufficient.quota/i, code: "insufficient_credits" },
  { pattern: /rate.limit/i, code: "usage_limit_exceeded" },
  { pattern: /too many requests/i, code: "usage_limit_exceeded" },
  { pattern: /missing.api.key/i, code: "missing_api_key" },
  { pattern: /invalid.api.key/i, code: "invalid_api_key" },
  { pattern: /api key.+invalid/i, code: "invalid_api_key" },
  { pattern: /forbidden.+api.key/i, code: "forbidden_api_key" },
  { pattern: /model.not.found/i, code: "model_not_found" },
  { pattern: /request.too.large/i, code: "request_too_large" },
  { pattern: /content.too.large/i, code: "request_too_large" },
  { pattern: /upstream.error/i, code: "upstream_error" },
];

function matchErrorCodeFromContent(content) {
  for (const { pattern, code } of CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      return code;
    }
  }
  return null;
}

// ── Plugin ──────────────────────────────────────────────────────────

const DEFAULT_CONTACT_URL = "https://nexu.app/contact";

/**
 * Cache of recent LLM error codes, keyed by `channelId` (the only correlation
 * field shared between `llm_output` and `message_sending` contexts in the
 * OpenClaw plugin API). This is intentionally narrow to reduce the chance of
 * applying an error code from one conversation to a different conversation's
 * outgoing reply. The TTL is short for the same reason: an llm_output and the
 * follow-up error reply should be milliseconds apart in the normal path, so a
 * 5s window is more than enough while keeping the cross-talk window small.
 */
const channelErrorCache = new Map();
const CACHE_TTL_MS = 5_000;

const plugin = {
  id: "nexu-credit-guard",
  name: "Nexu Credit Guard",
  description:
    "Replaces generic error replies with Nexu-specific localised messages.",
  register(api) {
    const contactUrl = api.pluginConfig?.contactUrl || DEFAULT_CONTACT_URL;

    // Phase 1: capture the raw error code from the LLM response
    api.on("llm_output", async (event, ctx) => {
      const code = extractErrorCode(event.lastAssistant);
      if (!code || !ctx.channelId) return;

      channelErrorCache.set(ctx.channelId, { code, ts: Date.now() });

      // Evict stale entries periodically
      if (channelErrorCache.size > 500) {
        const now = Date.now();
        for (const [key, val] of channelErrorCache) {
          if (now - val.ts > CACHE_TTL_MS) channelErrorCache.delete(key);
        }
      }
    });

    // Phase 2: replace the outgoing error message
    api.on(
      "message_sending",
      async (event, ctx) => {
        // Only intercept messages that look like errors
        if (
          !event.content.startsWith("⚠️") &&
          !event.content.includes("error") &&
          !event.content.includes("Error") &&
          !event.content.includes("failed") &&
          !event.content.includes("API") &&
          !event.content.includes("limit") &&
          !event.content.includes("credit")
        ) {
          return;
        }

        // Try cached error code first (from llm_output), then pattern-match.
        // Cache lookup is keyed by channelId (the only correlation field
        // shared between llm_output and message_sending contexts), so we
        // never apply a cross-channel error code, and within a channel we
        // only consume entries that are within the short TTL window.
        let errorCode = null;
        if (ctx?.channelId) {
          const entry = channelErrorCache.get(ctx.channelId);
          if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
            errorCode = entry.code;
            channelErrorCache.delete(ctx.channelId);
          } else if (entry) {
            // Stale — discard so it can't pollute a future unrelated reply.
            channelErrorCache.delete(ctx.channelId);
          }
        }

        if (!errorCode) {
          errorCode = matchErrorCodeFromContent(event.content);
        }

        if (!errorCode) return;

        const messages = ERROR_MESSAGES[errorCode];
        if (!messages) return;

        const state = loadState();
        const locale = state?.locale || "en";
        const localised = t(locale, messages[0], messages[1], contactUrl);

        api.logger.info(
          `Replaced error reply: code=${errorCode} locale=${locale}`,
        );
        return { content: localised };
      },
      { priority: 100 },
    );
  },
};

export default plugin;
