import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  electronRoot,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  repoRoot,
  resetDir,
  shouldCopyRuntimeDependencies,
} from "./lib/sidecar-paths.mjs";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";

const openclawRuntimeRoot = resolve(repoRoot, "openclaw-runtime");
const openclawRuntimeNodeModules = resolve(openclawRuntimeRoot, "node_modules");
const openclawRoot = resolve(openclawRuntimeNodeModules, "openclaw");
const openclawRuntimePatchesRoot = resolve(
  repoRoot,
  "openclaw-runtime-patches",
);
const openclawPackagePatchRoot = resolve(
  openclawRuntimePatchesRoot,
  "openclaw",
);
const buildCacheRoot = resolve(
  process.env.NEXU_DEV_CACHE_DIR ?? resolve(repoRoot, ".cache", "nexu-dev"),
);
const openclawSidecarCacheRoot = resolve(buildCacheRoot, "openclaw-sidecar");
const OPENCLAW_SIDECAR_CACHE_VERSION = "2026-04-08-openclaw-sidecar-signing-v3";
const OPENCLAW_SIDECAR_ARCHIVE_FORMAT =
  resolveBuildTargetPlatform({
    env: process.env,
    platform: process.platform,
  }) === "win"
    ? "zip"
    : "tar.gz";
const OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME =
  OPENCLAW_SIDECAR_ARCHIVE_FORMAT === "zip" ? "payload.zip" : "payload.tar.gz";
const REPLY_OUTCOME_HELPER_SEARCH = `
const sessionKey = ctx.SessionKey;
	const startTime = diagnosticsEnabled ? Date.now() : 0;
`.trim();
const REPLY_OUTCOME_HELPER_REPLACEMENT = `
const sessionKey = ctx.SessionKey;
	const emitReplyOutcome = (status, reasonCode, error) => {
		try {
			console.log("NEXU_EVENT channel.reply_outcome " + JSON.stringify({
				channel,
				status,
				reasonCode,
				accountId: ctx.AccountId,
				to: chatId,
				chatId,
				threadId: ctx.MessageThreadId,
				replyToMessageId: messageId,
				sessionKey,
				messageId,
				error,
				ts: (/* @__PURE__ */ new Date()).toISOString()
			}));
		} catch {}
	};
	const startTime = diagnosticsEnabled ? Date.now() : 0;
`.trim();
const REPLY_OUTCOME_SILENT_SEARCH = `
const counts = dispatcher.getQueuedCounts();
		counts.final += routedFinalCount;
		recordProcessed("completed");
`.trim();
const REPLY_OUTCOME_SILENT_REPLACEMENT = `
const counts = dispatcher.getQueuedCounts();
		counts.final += routedFinalCount;
		if (!queuedFinal) emitReplyOutcome("silent", "no_final_reply");
		recordProcessed("completed");
`.trim();
const REPLY_OUTCOME_ERROR_SEARCH = `
recordProcessed("error", { error: String(err) });
		markIdle("message_error");
`.trim();
const REPLY_OUTCOME_ERROR_REPLACEMENT = `
emitReplyOutcome("failed", "dispatch_threw", err instanceof Error ? err.message : String(err));
		recordProcessed("error", { error: String(err) });
		markIdle("message_error");
`.trim();
const FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH = `
const genericErrorText = "The AI service returned an error. Please try again.";
	const suppressErrorTextReply = params.messageChannel === "feishu" && lastAssistantErrored;
	if (errorText && !suppressErrorTextReply) replyItems.push({
`.trim();
const FEISHU_ERROR_REPLY_SUPPRESS_GUARD_REPLACEMENT = `
const genericErrorText = "The AI service returned an error. Please try again.";
	const suppressErrorTextReply = (params.messageChannel === "feishu" || params.messageProvider === "feishu") && lastAssistantErrored;
	if (errorText && !suppressErrorTextReply) replyItems.push({
`.trim();
const CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH = `
toolResultFormat: resolvedToolResultFormat,
					messageChannel: params.messageChannel,
					suppressToolErrorWarnings: params.suppressToolErrorWarnings,
					inlineToolResultsAllowed: false,
`.trim();
const CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_REPLACEMENT = `
toolResultFormat: resolvedToolResultFormat,
					messageChannel: params.messageChannel,
					messageProvider: params.messageProvider,
					suppressToolErrorWarnings: params.suppressToolErrorWarnings,
					inlineToolResultsAllowed: false,
`.trim();
const FEISHU_PRE_REPLY_FINAL_SEARCH = [
  "defaultRuntime.error(`Embedded agent failed before reply: ${message}`);",
  '\t\tconst trimmedMessage = (isTransientHttp ? sanitizeUserFacingText(message, { errorContext: true }) : message).replace(/\\.\\s*$/, "");',
  "\t\treturn {",
  '\t\t\tkind: "final",',
  '\t\t\tpayload: { text: isContextOverflow ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model." : isRoleOrderingError ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session." : `⚠️ Agent failed before reply: ${trimmedMessage}.\\nLogs: openclaw logs --follow` }',
  "\t\t};",
].join("\n");
const FEISHU_PRE_REPLY_FINAL_REPLACEMENT = [
  "defaultRuntime.error(`Embedded agent failed before reply: ${message}`);",
  '\t\tconst trimmedMessage = (isTransientHttp ? sanitizeUserFacingText(message, { errorContext: true }) : message).replace(/\\.\\s*$/, "");',
  '\t\tif (resolveMessageChannel(params.sessionCtx.Surface, params.sessionCtx.Provider) === "feishu") return {',
  '\t\t\tkind: "success",',
  "\t\t\trunId,",
  "\t\t\trunResult: { payloads: [] },",
  "\t\t\tfallbackProvider,",
  "\t\t\tfallbackModel,",
  "\t\t\tfallbackAttempts,",
  "\t\t\tdidLogHeartbeatStrip,",
  "\t\t\tautoCompactionCompleted,",
  "\t\t\tdirectlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : void 0",
  "\t\t};",
  "\t\treturn {",
  '\t\t\tkind: "final",',
  '\t\t\tpayload: { text: isContextOverflow ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model." : isRoleOrderingError ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session." : `⚠️ Agent failed before reply: ${trimmedMessage}.\\nLogs: openclaw logs --follow` }',
  "\t\t};",
].join("\n");
const CONTEXT_OVERFLOW_PATCHES = [
  {
    search:
      "⚠️ Context limit exceeded. I've reset our conversation to start fresh - please try again.\\n\\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
    zhReplace:
      "⚠️ 当前对话内容已超出模型处理上限，自动整理未能成功，已为你重置会话。请重新发送消息继续使用。如反复出现，请尝试缩短单条消息或开启新对话。",
    enReplace:
      "⚠️ Conversation too long for this model. Auto-compaction failed, session has been reset. Please resend your message. If this keeps happening, try shorter messages or start a new conversation.",
  },
  {
    search:
      "⚠️ Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.\\n\\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
    zhReplace:
      "⚠️ 当前对话内容已超出模型处理上限，自动整理未能成功，已为你重置会话。请重新发送消息继续使用。如反复出现，请尝试缩短单条消息或开启新对话。",
    enReplace:
      "⚠️ Conversation too long for this model. Auto-compaction failed, session has been reset. Please resend your message. If this keeps happening, try shorter messages or start a new conversation.",
  },
];
const FORMATTED_ASSISTANT_ERROR_PRIORITY_SEARCH =
  'const assistantErrorText = lastAssistant?.stopReason === "error" ? lastAssistant.errorMessage?.trim() || formattedAssistantErrorText : void 0;';
const FORMATTED_ASSISTANT_ERROR_PRIORITY_REPLACEMENT =
  'const assistantErrorText = lastAssistant?.stopReason === "error" ? formattedAssistantErrorText || lastAssistant.errorMessage?.trim() : void 0;';
const FAILOVER_ERROR_PRIORITY_SEARCH =
  '}) : void 0) || lastAssistant?.errorMessage?.trim() || (timedOut ? "LLM request timed out." : rateLimitFailure ? "LLM request rate limited." : billingFailure ? formatBillingErrorMessage(activeErrorContext.provider, activeErrorContext.model) : authFailure ? "LLM request unauthorized." : "LLM request failed.");';
const FAILOVER_ERROR_PRIORITY_REPLACEMENT =
  '}) : void 0) || (timedOut ? "LLM request timed out." : rateLimitFailure ? "LLM request rate limited." : billingFailure ? formatBillingErrorMessage(activeErrorContext.provider, activeErrorContext.model) : authFailure ? "LLM request unauthorized." : lastAssistant?.errorMessage?.trim() || "LLM request failed.");';
// Fast-exit patch: when billing/auth errors repeat 3+ times in the failover
// loop, break immediately instead of continuing to rotate through profiles.
// These errors won't resolve by retrying — the account/key is the problem.
// The counter uses a property on the params object (available in scope)
// to survive across loop iterations without needing a new variable declaration.
// Universal fast-exit: break after 3 consecutive failures of ANY type.
const FAST_EXIT_BILLING_AUTH_SEARCH =
  "const authFailure = isAuthAssistantError(lastAssistant);";
const FAST_EXIT_BILLING_AUTH_REPLACEMENT =
  "const authFailure = isAuthAssistantError(lastAssistant);\n\t\t\t\tparams.__nexuNrCount = (params.__nexuNrCount || 0) + 1; if (params.__nexuNrCount >= 2) break;";
// Fallback reply patch: when the outer agent-runner loop exits with
// kind "success" but runResult has no payloads (all LLM calls failed),
// convert to a "final" reply so the user always gets feedback.
const EMPTY_PAYLOADS_FALLBACK_SEARCH =
  '\treturn {\n\t\tkind: "success",\n\t\trunId,\n\t\trunResult,';
const EMPTY_PAYLOADS_FALLBACK_REPLACEMENT =
  '\tif (!runResult?.payloads?.length && runResult?.meta?.error) {\n\t\tconst _errMsg = runResult.meta.error.message || runResult.meta.error;\n\t\treturn {\n\t\t\tkind: "final",\n\t\t\tpayload: { text: typeof _errMsg === "string" ? _errMsg : "⚠️ An error occurred. Please try again." }\n\t\t};\n\t}\n\treturn {\n\t\tkind: "success",\n\t\trunId,\n\t\trunResult,';
// Compaction NEXU_EVENT: emit a NEXU_EVENT from handleAutoCompactionStart
// so the controller can send an independent channel message.
// Compaction HTTP notify: when compaction starts, POST to controller
// so it can send a status message to the user's channel.
// Uses HTTP because in launchd mode controller can't read OpenClaw stderr.
const COMPACTION_NEXU_EVENT_SEARCH =
  "function handleAutoCompactionStart(ctx) {";
const COMPACTION_NEXU_EVENT_REPLACEMENT =
  'function handleAutoCompactionStart(ctx) {\n\tfetch("http://127.0.0.1:" + (process.env.CONTROLLER_PORT || "50800") + "/api/internal/compaction-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionKey: ctx.params.sessionKey, channel: ctx.params.messageChannel, runId: ctx.params.runId }) }).catch(() => {});';
// Compaction status feedback: send a typing delta to the channel when
// compaction starts so the user sees "⏳ Compacting..." instead of silence.
const COMPACTION_FEEDBACK_SEARCH =
  'if ((typeof evt.data.phase === "string" ? evt.data.phase : "") === "end") autoCompactionCompleted = true;';
const COMPACTION_FEEDBACK_REPLACEMENT =
  '{ const _cp = typeof evt.data.phase === "string" ? evt.data.phase : ""; if (_cp === "start") { const _cl = globalThis.__nexuCgLocale || "zh-CN"; params.typingSignals.signalTextDelta(_cl === "en" ? "\\u23f3 Compacting conversation history..." : "\\u23f3 \\u6b63\\u5728\\u6574\\u7406\\u5bf9\\u8bdd\\u8bb0\\u5f55...").catch(() => {}); } if (_cp === "end") autoCompactionCompleted = true; }';
// Dispatcher empty payloads patch: when payloadArray is empty but there's
// an error in meta, push the error text as a fallback payload instead of
// silently returning (which causes the bot to go silent).
const EMPTY_PAYLOAD_ARRAY_SEARCH =
  "const payloadArray = runResult.payloads ?? [];\n\t\t\tif (payloadArray.length === 0) return;";
const EMPTY_PAYLOAD_ARRAY_REPLACEMENT =
  'const payloadArray = runResult.payloads ?? [];\n\t\t\tif (payloadArray.length === 0) {\n\t\t\t\tconst _fallbackErr = runResult.meta?.error?.message || runResult.meta?.error;\n\t\t\t\tif (_fallbackErr) {\n\t\t\t\t\tpayloadArray.push({ text: typeof _fallbackErr === "string" ? _fallbackErr : "\\u26a0\\ufe0f An error occurred. Please try again.", isError: true });\n\t\t\t\t} else {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t}';
// Compaction independent message: when compaction starts in the followup
// runner, send an independent message via sendFollowupPayloads so ALL
// channels (including WeChat) see the status, not just streaming channels.
const FOLLOWUP_COMPACTION_FEEDBACK_SEARCH =
  'if (evt.stream === "compaction") {\n\t\t\t\t\t\t\tif ((typeof evt.data.phase === "string" ? evt.data.phase : "") === "end") memoryCompactionCompleted = true;\n\t\t\t\t\t\t}';
const FOLLOWUP_COMPACTION_FEEDBACK_REPLACEMENT =
  'if (evt.stream === "compaction") {\n\t\t\t\t\t\t\tconst _phase = typeof evt.data.phase === "string" ? evt.data.phase : "";\n\t\t\t\t\t\t\tif (_phase === "start") { const _l = globalThis.__nexuCgLocale || "zh-CN"; sendFollowupPayloads([{ text: _l === "en" ? "\\u23f3 Compacting conversation, estimated ~30s..." : "\\u23f3 \\u6b63\\u5728\\u6574\\u7406\\u5bf9\\u8bdd\\u8bb0\\u5f55\\uff0c\\u9884\\u8ba130\\u79d2\\u5185\\u5b8c\\u6210..." }], queued).catch(() => {}); }\n\t\t\t\t\t\t\tif (_phase === "end") memoryCompactionCompleted = true;\n\t\t\t\t\t\t}';
// Make compaction complete message always visible (remove verbose gate)
// and replace with localized text.
const COMPACTION_COMPLETE_VERBOSE_SEARCH =
  'if (queued.run.verboseLevel && queued.run.verboseLevel !== "off") {\n\t\t\t\t\tconst suffix = typeof count === "number" ? ` (count ${count})` : "";\n\t\t\t\t\tfinalPayloads.unshift({ text: `🧹 Auto-compaction complete${suffix}.` });\n\t\t\t\t}';
const COMPACTION_COMPLETE_VERBOSE_REPLACEMENT =
  '{ const _l = globalThis.__nexuCgLocale || "zh-CN"; finalPayloads.unshift({ text: _l === "en" ? "\\u2705 Conversation compacted successfully." : "\\u2705 \\u5bf9\\u8bdd\\u8bb0\\u5f55\\u6574\\u7406\\u5b8c\\u6210\\u3002" }); }';
// Stop followup turn on empty payloads: when all LLM calls fail and
// payloads are empty, just return instead of triggering a followup turn
// which causes an infinite retry loop.
const STOP_FOLLOWUP_ON_EMPTY_SEARCH =
  "if (payloadArray.length === 0) return finalizeWithFollowup(void 0, queueKey, runFollowupTurn);";
const STOP_FOLLOWUP_ON_EMPTY_REPLACEMENT =
  "if (payloadArray.length === 0) return;";
// Locale reader: reads nexu-credit-guard-state.json from OPENCLAW_STATE_DIR.
// Cached by mtime. Falls back to "zh-CN" if file missing or unreadable.
const LOCALE_READER_LINES = [
  'const _nexuLocale = (() => { try { const _fs = require("node:fs"); const _path = require("node:path"); const _stateDir = process.env.OPENCLAW_STATE_DIR; if (!_stateDir) return "zh-CN"; const _fp = _path.join(_stateDir, "nexu-credit-guard-state.json"); const _mt = _fs.statSync(_fp).mtimeMs; if (globalThis.__nexuCgMt === _mt) return globalThis.__nexuCgLocale || "zh-CN"; const _d = JSON.parse(_fs.readFileSync(_fp, "utf8")); globalThis.__nexuCgMt = _mt; globalThis.__nexuCgLocale = _d.locale || "zh-CN"; return globalThis.__nexuCgLocale; } catch { return globalThis.__nexuCgLocale || "zh-CN"; } })();',
];
// i18n error messages: each line checks error code and returns localised text.
// _nexuLocale is resolved above; "en" → English, anything else → Chinese.
const KNOWN_LINK_ERROR_MAPPING_LINES = [
  ...LOCALE_READER_LINES,
  "const lowered = trimmed.toLowerCase();",
  'if (lowered.includes("[code=missing_api_key]") || lowered.includes("missing api key")) return _nexuLocale === "en" ? "⚠️ No access credentials detected. Please check that you are logged in or that you have entered your API key. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 未检测到访问凭证，暂时无法继续使用。请先检查是否已经完成账号登录，或是否已经填写访问密钥（用于连接模型服务的凭证）。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=invalid_api_key]") || lowered.includes("invalid api key")) return _nexuLocale === "en" ? "⚠️ The API key you entered is invalid. Please check it for typos or try a different key. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 你填写的访问密钥无效，暂时无法使用。请检查是否复制完整、是否填错，或换一个新的密钥后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=forbidden_api_key]") || lowered.includes("api key is forbidden")) return _nexuLocale === "en" ? "⚠️ Your API key is no longer usable — it may have expired or been revoked. Please replace it and try again. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 当前访问密钥不可用，可能已经过期、被停用或被撤销。请更换一个可用的密钥后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=insufficient_credits]") || lowered.includes("insufficient credits")) return _nexuLocale === "en" ? "⚠️ Insufficient credits. You can earn credits by completing tasks, or switch to using your own API key (BYOK). If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 当前可用积分不足，暂时无法继续使用。你可以通过完成任务赚取积分，或切换到自带密钥（BYOK）的方式继续使用。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=usage_limit_exceeded]") || lowered.includes("usage limit")) return _nexuLocale === "en" ? "⚠️ You\\u2019ve reached the usage limit for this period. Please try again later. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 当前请求过于频繁，已达到本时段的使用上限，请稍后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=invalid_json]") || lowered.includes("request body is not valid json")) return _nexuLocale === "en" ? "⚠️ The submitted content has an invalid format. Please check and resubmit. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 提交的内容格式不正确，系统暂时无法识别。请检查后重新提交。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=invalid_model]") || lowered.includes("model field is missing or empty")) return _nexuLocale === "en" ? "⚠️ The current model is temporarily unavailable. Please try again later. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 当前模型暂不可用，请稍后重试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=invalid_request]") || lowered.includes("invalid request parameters")) return _nexuLocale === "en" ? "⚠️ The request is invalid. Please check that all fields are filled in correctly and try again. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 本次提交的内容有误，系统暂时无法处理。请检查填写内容是否完整、格式是否正确，然后再试一次。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=model_not_found]") || lowered.includes("the requested model was not found")) return _nexuLocale === "en" ? "⚠️ The selected model is not available. It may not be configured yet or is temporarily inaccessible. Please switch to another model or check your settings. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 你选择的模型当前不可用，可能尚未配置成功，或暂时无法访问。请更换其他模型，或检查相关设置后重试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=request_too_large]") || lowered.includes("request body exceeds maximum size") || lowered.includes("request is too large")) return _nexuLocale === "en" ? "⚠️ The request is too large. Please shorten your message, reduce attachments, or split into multiple messages. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 本次提交的内容过多，系统暂时无法处理。请缩短消息内容、减少附件或分几次发送后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=internal_error]") || lowered.includes("internal error")) return _nexuLocale === "en" ? "⚠️ Something went wrong on our end. Please try again later. If this keeps happening, see https://docs.nexu.io/guide/contact" : "⚠️ 服务暂时出了点问题，请稍后再试一次。如多次出现同样的问题，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=streaming_unsupported]") || lowered.includes("streaming unsupported")) return _nexuLocale === "en" ? "⚠️ Streaming is not supported for this request. Please try a different approach or try again later. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 当前暂不支持这种返回方式，请换一种方式再试，或稍后重试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
  'if (lowered.includes("[code=upstream_error]") || lowered.includes("upstream provider is unavailable") || lowered.includes("upstream_error")) return _nexuLocale === "en" ? "⚠️ The upstream model service is temporarily unavailable. Please try again later or switch to a different model. If the issue persists, see https://docs.nexu.io/guide/contact" : "⚠️ 当前连接的模型服务暂时不可用，请稍后重试，或更换其他模型后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact";',
];
const HELPER_BUNDLE_PATTERNS = [/^pi-embedded-helpers-.*\.js$/u];
const PLUGIN_SDK_BUNDLE_PATTERNS = [/^reply-.*\.js$/u, /^dispatch-.*\.js$/u];
const CORE_DIST_REPLY_BUNDLE_PATTERNS = [/^reply-.*\.js$/u];
const FEISHU_PRE_LLM_SINGLE_AGENT_SEARCH = `
      // --- Single-agent dispatch (existing behavior) ---
      const ctxPayload = buildCtxPayloadForAgent(
        route.sessionKey,
        route.accountId,
        ctx.mentionedBot,
      );
`.trim();
const FEISHU_SYNTHETIC_PRE_LLM_LINES = [
  "      const syntheticFailureTriggerPrefix = process.env.NEXU_FEISHU_TEST_TRIGGER_PREFIX?.trim();",
  "      if (syntheticFailureTriggerPrefix && ctx.content.includes(syntheticFailureTriggerPrefix)) {",
  "        const syntheticInput = ctx.content.slice(ctx.content.indexOf(syntheticFailureTriggerPrefix) + syntheticFailureTriggerPrefix.length).trim();",
  "        // TODO: Trace the actual runtime execution path for synthetic failures; the staged src patch is applied, but the live fallback path still appears to bypass this exact branch in some runs.",
  "        runtime.log?.(`NEXU_EVENT channel.reply_outcome ${JSON.stringify({",
  '          channel: "feishu",',
  '          status: "failed",',
  '          reasonCode: "synthetic_pre_llm_failure",',
  "          accountId: account.accountId,",
  "          chatId: ctx.chatId,",
  "          replyToMessageId: replyTargetMessageId,",
  "          threadId: ctx.rootId,",
  "          sessionKey: route.sessionKey,",
  "          syntheticInput,",
  '          error: "synthetic pre-llm failure",',
  "          ts: new Date().toISOString(),",
  "        })}`);",
  "        log(",
  "          `feishu[${account.accountId}]: synthetic pre-llm failure triggered (session=${route.sessionKey})`,",
  "        );",
  "        return;",
  "      }",
];
const FEISHU_SYNTHETIC_PRE_LLM_BLOCK =
  FEISHU_SYNTHETIC_PRE_LLM_LINES.join("\n");
const FEISHU_PRE_LLM_SINGLE_AGENT_REPLACEMENT = [
  "      // --- Single-agent dispatch (existing behavior) ---",
  "      const ctxPayload = buildCtxPayloadForAgent(",
  "        route.sessionKey,",
  "        route.accountId,",
  "        ctx.mentionedBot,",
  "      );",
  ...FEISHU_SYNTHETIC_PRE_LLM_LINES,
].join("\n");
const LEGACY_FEISHU_TRIGGER_CALLSITE = `
        accountId: account.accountId,
        syntheticFailureTriggerText: ctx.content,
        messageCreateTimeMs,
`.trim();
const LEGACY_FEISHU_TRIGGER_CALLSITE_REPLACEMENT = `
        accountId: account.accountId,
        messageCreateTimeMs,
`.trim();
const LEGACY_FEISHU_PRE_LLM_BLOCK = [
  '                if (ctx.content.includes("__fail_reply__")) {',
  "        runtime.log?.(`NEXU_EVENT channel.reply_outcome ${JSON.stringify({",
  '          channel: "feishu",',
  '          status: "failed",',
  '          reasonCode: "synthetic_pre_llm_failure",',
  "          accountId: account.accountId,",
  "          chatId: ctx.chatId,",
  "          replyToMessageId: replyTargetMessageId,",
  "          threadId: ctx.rootId,",
  "          sessionKey: route.sessionKey,",
  '          error: "synthetic pre-llm failure",',
  "          ts: new Date().toISOString(),",
  "        })}`);",
  "        log(",
  "          `feishu[${account.accountId}]: synthetic pre-llm failure triggered (session=${route.sessionKey})`,",
  "        );",
  "        return;",
  "      }",
  "",
].join("\n");
const LEGACY_FEISHU_SINGLE_AGENT_TRIGGER_BLOCK = [
  '      if (ctx.content.includes("__fail_reply__")) {',
  "        runtime.log?.(`NEXU_EVENT channel.reply_outcome ${JSON.stringify({",
  '          channel: "feishu",',
  '          status: "failed",',
  '          reasonCode: "synthetic_pre_llm_failure",',
  "          accountId: account.accountId,",
  "          chatId: ctx.chatId,",
  "          replyToMessageId: replyTargetMessageId,",
  "          threadId: ctx.rootId,",
  "          sessionKey: route.sessionKey,",
  '          error: "synthetic pre-llm failure",',
  "          ts: new Date().toISOString(),",
  "        })}`);",
  "        log(",
  "          `feishu[${account.accountId}]: synthetic pre-llm failure triggered (session=${route.sessionKey})`,",
  "        );",
  "        return;",
  "      }",
].join("\n");
const sidecarRoot = getSidecarRoot("openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const packagedOpenclawEntry = resolve(
  sidecarNodeModules,
  "openclaw/openclaw.mjs",
);
const inheritEntitlementsPath = resolve(
  electronRoot,
  "build/entitlements.mac.inherit.plist",
);
const shouldArchiveOpenclawSidecar =
  process.env.NEXU_DESKTOP_ARCHIVE_OPENCLAW_SIDECAR !== "0" &&
  process.env.NEXU_DESKTOP_ARCHIVE_OPENCLAW_SIDECAR?.toLowerCase() !== "false";
const shouldDisableOpenclawSidecarCache =
  process.env.NEXU_DEV_DISABLE_CACHE === "1" ||
  process.env.NEXU_DEV_DISABLE_CACHE?.toLowerCase() === "true";
const shouldLogOpenclawSidecarProbes =
  process.env.NEXU_DESKTOP_SIDECAR_PROBES === "1" ||
  process.env.NEXU_DESKTOP_SIDECAR_PROBES?.toLowerCase() === "true";

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

async function timedStep(stepName, fn) {
  const startedAt = performance.now();
  console.log(`[openclaw-sidecar][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    console.log(
      `[openclaw-sidecar][timing] done ${stepName} duration=${formatDurationMs(
        performance.now() - startedAt,
      )}`,
    );
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function runAndCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}. ${stderr}`,
        ),
      );
    });
  });
}

async function collectFiles(rootPath) {
  const files = [];
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function collectDirectoryStats(rootPath) {
  let fileCount = 0;
  let totalBytes = 0;
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      const childStats = await collectDirectoryStats(entryPath);
      fileCount += childStats.fileCount;
      totalBytes += childStats.totalBytes;
      continue;
    }

    if (entry.isFile()) {
      const entryStats = await stat(entryPath);
      fileCount += 1;
      totalBytes += entryStats.size;
    }
  }

  return { fileCount, totalBytes };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

async function hashFingerprintInputs(files) {
  const hash = createHash("sha256");
  hash.update(`${OPENCLAW_SIDECAR_CACHE_VERSION}\n`);

  for (const filePath of [...files].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (!(await pathExists(filePath))) {
      continue;
    }

    hash.update(`${relative(repoRoot, filePath)}\n`);
    hash.update(await readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function collectOpenclawSidecarFingerprintInputs() {
  const files = [
    resolve(openclawRuntimeRoot, ".postinstall-cache.json"),
    resolve(openclawRuntimeRoot, "package.json"),
    resolve(openclawRoot, "package.json"),
    resolve(electronRoot, "package.json"),
    fileURLToPath(import.meta.url),
    resolve(electronRoot, "scripts", "lib", "sidecar-paths.mjs"),
    resolve(electronRoot, "scripts", "platforms", "desktop-platform.mjs"),
    resolve(electronRoot, "scripts", "platforms", "platform-resolver.mjs"),
    resolve(electronRoot, "scripts", "platforms", "filesystem-compat.mjs"),
  ];

  if (await pathExists(openclawPackagePatchRoot)) {
    files.push(...(await collectFiles(openclawPackagePatchRoot)));
  }

  return files;
}

async function computeOpenclawSidecarFingerprint() {
  return hashFingerprintInputs(await collectOpenclawSidecarFingerprintInputs());
}

function getOpenclawSidecarCacheEntryRoot(fingerprint) {
  return resolve(openclawSidecarCacheRoot, fingerprint);
}

async function tryRestoreCachedArchivedOpenclawSidecar(fingerprint) {
  if (shouldDisableOpenclawSidecarCache || !shouldArchiveOpenclawSidecar) {
    console.log(
      `[openclaw-sidecar][cache] bypass fingerprint=${fingerprint} disableCache=${shouldDisableOpenclawSidecarCache} archive=${shouldArchiveOpenclawSidecar}`,
    );
    return false;
  }

  const cacheEntryRoot = getOpenclawSidecarCacheEntryRoot(fingerprint);
  const cachedSidecarRoot = resolve(cacheEntryRoot, "sidecar");

  const archiveMetadataPath = resolve(cachedSidecarRoot, "archive.json");
  const cachedPackageJsonPath = resolve(cachedSidecarRoot, "package.json");
  const cacheManifestPath = resolve(cacheEntryRoot, "manifest.json");
  const hasArchiveMetadata = await pathExists(archiveMetadataPath);
  const hasCachedPackageJson = await pathExists(cachedPackageJsonPath);
  const hasCacheManifest = await pathExists(cacheManifestPath);

  if (!hasArchiveMetadata || !hasCachedPackageJson || !hasCacheManifest) {
    console.log(
      `[openclaw-sidecar][cache] miss fingerprint=${fingerprint} reason=incomplete-cache-entry root=${cacheEntryRoot} archiveJson=${hasArchiveMetadata} packageJson=${hasCachedPackageJson} manifest=${hasCacheManifest}`,
    );
    return false;
  }

  let archiveMetadata;
  try {
    archiveMetadata = JSON.parse(await readFile(archiveMetadataPath, "utf8"));
  } catch {
    console.log(
      `[openclaw-sidecar][cache] miss fingerprint=${fingerprint} reason=invalid-archive-metadata path=${archiveMetadataPath}`,
    );
    return false;
  }

  const archivePayloadPath =
    archiveMetadata && typeof archiveMetadata.path === "string"
      ? resolve(cachedSidecarRoot, archiveMetadata.path)
      : null;

  if (
    !archiveMetadata ||
    typeof archiveMetadata.path !== "string" ||
    !archivePayloadPath ||
    !(await pathExists(archivePayloadPath))
  ) {
    console.log(
      `[openclaw-sidecar][cache] miss fingerprint=${fingerprint} reason=missing-archive-payload path=${archivePayloadPath ?? "<invalid>"}`,
    );
    return false;
  }

  await resetDir(sidecarRoot);
  await cp(cachedSidecarRoot, sidecarRoot, {
    recursive: true,
    dereference: true,
  });
  console.log(
    `[openclaw-sidecar][cache] hit fingerprint=${fingerprint} source=${cacheEntryRoot}`,
  );
  return true;
}

async function writeOpenclawSidecarCacheEntry(fingerprint) {
  if (shouldDisableOpenclawSidecarCache || !shouldArchiveOpenclawSidecar) {
    return;
  }

  const cacheEntryRoot = getOpenclawSidecarCacheEntryRoot(fingerprint);
  const cacheStageRoot = resolve(
    openclawSidecarCacheRoot,
    `.stage-${fingerprint}`,
  );
  const payloadPath = resolve(sidecarRoot, OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME);
  const payloadStats = await stat(payloadPath);

  await removePathIfExists(cacheStageRoot);
  await mkdir(cacheStageRoot, { recursive: true });
  const cacheSidecarRoot = resolve(cacheStageRoot, "sidecar");
  await mkdir(cacheSidecarRoot, { recursive: true });
  await Promise.all([
    cp(
      resolve(sidecarRoot, "archive.json"),
      resolve(cacheSidecarRoot, "archive.json"),
    ),
    cp(
      resolve(sidecarRoot, "package.json"),
      resolve(cacheSidecarRoot, "package.json"),
    ),
    cp(
      payloadPath,
      resolve(cacheSidecarRoot, OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME),
    ),
  ]);
  await writeFile(
    resolve(cacheStageRoot, "manifest.json"),
    `${JSON.stringify(
      {
        fingerprint,
        format: OPENCLAW_SIDECAR_ARCHIVE_FORMAT,
        payloadBytes: payloadStats.size,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  await removePathIfExists(cacheEntryRoot);
  await rename(cacheStageRoot, cacheEntryRoot);
  console.log(
    `[openclaw-sidecar][cache] stored fingerprint=${fingerprint} payload=${formatBytes(payloadStats.size)}`,
  );
}

async function resolve7ZipCommand() {
  const candidates =
    process.platform === "win32" ? ["7z.exe", "7z"] : ["7zz", "7z"];

  for (const candidate of candidates) {
    try {
      await runAndCapture(candidate, ["i"]);
      return candidate;
    } catch {}
  }

  return null;
}

async function createOpenclawSidecarArchive(archivePath) {
  if (OPENCLAW_SIDECAR_ARCHIVE_FORMAT === "zip") {
    const sevenZipCommand = await resolve7ZipCommand();

    if (sevenZipCommand) {
      await run(sevenZipCommand, ["a", "-tzip", "-mx=1", archivePath, "."], {
        cwd: sidecarRoot,
      });
      return;
    }

    const quotedSidecarRoot = sidecarRoot.replace(/'/gu, "''");
    const quotedArchivePath = archivePath.replace(/'/gu, "''");
    await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; if (Test-Path -LiteralPath '${quotedArchivePath}') { Remove-Item -LiteralPath '${quotedArchivePath}' -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory('${quotedSidecarRoot}', '${quotedArchivePath}', [System.IO.Compression.CompressionLevel]::Fastest, $false)`,
    ]);
    return;
  }

  await run("tar", ["-czf", archivePath, "-C", sidecarRoot, "."]);
}

async function resolveCodesignIdentity() {
  const { stdout } = await runAndCapture("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const identityLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.includes("Developer ID Application:"));

  if (!identityLine) {
    throw new Error(
      "Unable to locate a Developer ID Application signing identity.",
    );
  }

  const match = identityLine.match(/"([^"]+)"/u);
  if (!match) {
    throw new Error(`Unable to parse signing identity from: ${identityLine}`);
  }

  return match[1];
}

function getSigningCertificatePath() {
  const link = process.env.CSC_LINK;

  if (!link) {
    return null;
  }

  return link.startsWith("file://") ? fileURLToPath(link) : link;
}

async function ensureCodesignIdentity() {
  try {
    return await resolveCodesignIdentity();
  } catch {
    const certificatePath = getSigningCertificatePath();
    const certificatePassword = process.env.CSC_KEY_PASSWORD;

    if (!certificatePath || !certificatePassword) {
      throw new Error(
        "Unable to locate a Developer ID Application signing identity.",
      );
    }

    const keychainPath = resolve(tmpdir(), "nexu-openclaw-signing.keychain-db");
    const keychainPassword = "nexu-openclaw-signing";

    await run("security", [
      "create-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]).catch(() => null);
    await run("security", [
      "set-keychain-settings",
      "-lut",
      "21600",
      keychainPath,
    ]);
    await run("security", [
      "unlock-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]);
    await run("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    await run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath,
    ]);

    const { stdout: keychainsOutput } = await runAndCapture("security", [
      "list-keychains",
      "-d",
      "user",
    ]);
    const keychains = keychainsOutput
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^"|"$/gu, ""))
      .filter(Boolean);
    if (!keychains.includes(keychainPath)) {
      await run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        keychainPath,
        ...keychains,
      ]);
    }

    return await resolveCodesignIdentity();
  }
}

async function signOpenclawNativeBinaries() {
  if (
    resolveBuildTargetPlatform({
      env: process.env,
      platform: process.platform,
    }) !== "mac"
  ) {
    return;
  }

  const unsignedMode =
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "true";

  if (unsignedMode || !shouldCopyRuntimeDependencies()) {
    return;
  }

  const startedAt = Date.now();
  const identity = await ensureCodesignIdentity();
  const files = await collectFiles(sidecarRoot);
  const candidateFiles = files.filter((filePath) => {
    const baseName = basename(filePath);
    return (
      baseName.endsWith(".node") ||
      baseName.endsWith(".dylib") ||
      baseName === "spawn-helper"
    );
  });
  let signedCount = 0;

  console.log(
    `[openclaw-sidecar] scanning ${candidateFiles.length} native-binary candidates out of ${files.length} files`,
  );

  for (const filePath of candidateFiles) {
    const { stdout } = await runAndCapture("file", ["-b", filePath]);
    const description = stdout.trim();

    const isExecutable =
      description.includes("executable") || description.includes("bundle");
    const args = [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      "--entitlements",
      inheritEntitlementsPath,
      ...(isExecutable ? ["--options", "runtime"] : []),
      filePath,
    ];
    console.log(
      `[openclaw-sidecar] codesigning native binary: ${relative(sidecarRoot, filePath)} (${description})`,
    );
    await run("codesign", args);
    signedCount += 1;
  }

  console.log(
    `[openclaw-sidecar] signed ${signedCount} native binaries in ${formatDurationMs(
      Date.now() - startedAt,
    )}`,
  );
}

async function applyOpenclawRuntimePatches() {
  const patchedFiles = new Map();

  if (!(await pathExists(openclawPackagePatchRoot))) {
    return patchedFiles;
  }

  const patchFiles = await collectFiles(openclawPackagePatchRoot);

  for (const patchFilePath of patchFiles) {
    const patchFileRelativePath = relative(
      openclawPackagePatchRoot,
      patchFilePath,
    );
    patchedFiles.set(
      patchFileRelativePath,
      await readFile(patchFilePath, "utf8"),
    );
  }

  if (patchFiles.length > 0) {
    console.log(
      `[openclaw-sidecar] prepared ${patchFiles.length} runtime patch overlay(s) from ${openclawPackagePatchRoot}`,
    );
  }

  return patchedFiles;
}

function applyExactReplacement(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Unable to locate patch anchor for ${label}.`);
  }
  return source.replace(search, replacement);
}

function countOccurrences(source, search) {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (true) {
    const nextIndex = source.indexOf(search, index);
    if (nextIndex === -1) {
      return count;
    }
    count += 1;
    index = nextIndex + search.length;
  }
}

function injectKnownLinkErrorMappings(source, bundleName) {
  if (source.includes("https://docs.nexu.io/zh/guide/contact")) {
    return source;
  }

  const helperPrefixPattern =
    /function formatRawAssistantErrorForUi\(raw\) \{\n([\t ]*)const trimmed = \(raw \?\? ""\)\.trim\(\);\n\1if \(!trimmed\) return "LLM request failed with an unknown error\.";/u;

  const match = source.match(helperPrefixPattern);
  if (!match) {
    throw new Error(
      `Unable to locate helper formatter anchor for ${bundleName}.`,
    );
  }

  const indent = match[1] ?? "\t";
  const injectedBlock = [
    "function formatRawAssistantErrorForUi(raw) {",
    `${indent}const trimmed = (raw ?? "").trim();`,
    `${indent}if (!trimmed) return "LLM request failed with an unknown error.";`,
    ...KNOWN_LINK_ERROR_MAPPING_LINES.map((line) => `${indent}${line}`),
  ].join("\n");

  return source.replace(helperPrefixPattern, injectedBlock);
}

async function patchReplyOutcomeBridge(openclawPackageRoot) {
  const patchedFiles = new Map();
  const feishuBotPath = resolve(
    openclawPackageRoot,
    "extensions",
    "feishu",
    "src",
    "bot.ts",
  );
  let feishuBotSource = await readFile(feishuBotPath, "utf8");

  if (feishuBotSource.includes(LEGACY_FEISHU_PRE_LLM_BLOCK)) {
    feishuBotSource = feishuBotSource.replaceAll(
      LEGACY_FEISHU_PRE_LLM_BLOCK,
      "",
    );
  }

  if (feishuBotSource.includes(LEGACY_FEISHU_SINGLE_AGENT_TRIGGER_BLOCK)) {
    feishuBotSource = feishuBotSource.replaceAll(
      LEGACY_FEISHU_SINGLE_AGENT_TRIGGER_BLOCK,
      FEISHU_PRE_LLM_SINGLE_AGENT_REPLACEMENT,
    );
  }

  if (feishuBotSource.includes(LEGACY_FEISHU_TRIGGER_CALLSITE)) {
    feishuBotSource = feishuBotSource.replaceAll(
      LEGACY_FEISHU_TRIGGER_CALLSITE,
      LEGACY_FEISHU_TRIGGER_CALLSITE_REPLACEMENT,
    );
  }

  if (feishuBotSource.includes(FEISHU_SYNTHETIC_PRE_LLM_BLOCK)) {
    feishuBotSource = feishuBotSource.replaceAll(
      FEISHU_SYNTHETIC_PRE_LLM_BLOCK,
      "",
    );
  }

  if (feishuBotSource.includes(FEISHU_PRE_LLM_SINGLE_AGENT_SEARCH)) {
    feishuBotSource = feishuBotSource.replace(
      FEISHU_PRE_LLM_SINGLE_AGENT_SEARCH,
      FEISHU_PRE_LLM_SINGLE_AGENT_REPLACEMENT,
    );
    console.log(
      "[openclaw-sidecar] patched feishu single-agent pre-llm trigger",
    );
  }

  if (countOccurrences(feishuBotSource, FEISHU_SYNTHETIC_PRE_LLM_BLOCK) !== 1) {
    throw new Error(
      "Feishu bot patch did not converge to a single synthetic pre-llm block.",
    );
  }

  if (feishuBotSource.includes("return;\n      }\n        route.sessionKey,")) {
    throw new Error(
      "Feishu bot patch left a dangling buildCtxPayloadForAgent argument tail.",
    );
  }

  patchedFiles.set(
    relative(openclawPackageRoot, feishuBotPath),
    feishuBotSource,
  );

  const patchBundleGroup = async (bundleDir, patterns, label) => {
    const entries = await readdir(bundleDir);
    const bundleNames = entries.filter((entry) =>
      patterns.some((pattern) => pattern.test(entry)),
    );

    if (bundleNames.length === 0) {
      throw new Error(`Unable to locate OpenClaw ${label} bundles.`);
    }

    for (const bundleName of bundleNames) {
      const bundlePath = resolve(bundleDir, bundleName);
      let source = await readFile(bundlePath, "utf8");

      if (!source.includes("NEXU_EVENT channel.reply_outcome")) {
        source = applyExactReplacement(
          source,
          REPLY_OUTCOME_HELPER_SEARCH,
          REPLY_OUTCOME_HELPER_REPLACEMENT,
          `${bundleName}: reply outcome helper`,
        );

        source = applyExactReplacement(
          source,
          REPLY_OUTCOME_SILENT_SEARCH,
          REPLY_OUTCOME_SILENT_REPLACEMENT,
          `${bundleName}: silent outcome emit`,
        );

        source = applyExactReplacement(
          source,
          REPLY_OUTCOME_ERROR_SEARCH,
          REPLY_OUTCOME_ERROR_REPLACEMENT,
          `${bundleName}: error outcome emit`,
        );

        console.log(
          `[openclaw-sidecar] patched reply outcome bridge in ${bundleName}`,
        );
      }

      if (source.includes(FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH)) {
        source = applyExactReplacement(
          source,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_REPLACEMENT,
          `${bundleName}: feishu error reply suppress guard`,
        );

        console.log(
          `[openclaw-sidecar] patched feishu error final suppression in ${bundleName}`,
        );
      }

      if (source.includes(CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH)) {
        source = applyExactReplacement(
          source,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_REPLACEMENT,
          `${bundleName}: core embedded payload message provider`,
        );

        console.log(
          `[openclaw-sidecar] patched embedded payload message provider in ${bundleName}`,
        );
      }

      if (
        !source.includes("runResult: { payloads: [] }") &&
        source.includes(FEISHU_PRE_REPLY_FINAL_SEARCH)
      ) {
        source = applyExactReplacement(
          source,
          FEISHU_PRE_REPLY_FINAL_SEARCH,
          FEISHU_PRE_REPLY_FINAL_REPLACEMENT,
          `${bundleName}: feishu pre-reply final suppression`,
        );

        console.log(
          `[openclaw-sidecar] patched feishu pre-reply final suppression in ${bundleName}`,
        );
      }

      if (source.includes(FORMATTED_ASSISTANT_ERROR_PRIORITY_SEARCH)) {
        source = applyExactReplacement(
          source,
          FORMATTED_ASSISTANT_ERROR_PRIORITY_SEARCH,
          FORMATTED_ASSISTANT_ERROR_PRIORITY_REPLACEMENT,
          `${bundleName}: formatted assistant error priority`,
        );

        console.log(
          `[openclaw-sidecar] patched formatted assistant error priority in ${bundleName}`,
        );
      }

      if (source.includes(FAILOVER_ERROR_PRIORITY_SEARCH)) {
        source = applyExactReplacement(
          source,
          FAILOVER_ERROR_PRIORITY_SEARCH,
          FAILOVER_ERROR_PRIORITY_REPLACEMENT,
          `${bundleName}: failover error priority`,
        );

        console.log(
          `[openclaw-sidecar] patched failover error priority in ${bundleName}`,
        );
      }

      if (
        source.includes(COMPACTION_NEXU_EVENT_SEARCH) &&
        !source.includes("NEXU_EVENT compaction.started")
      ) {
        source = applyExactReplacement(
          source,
          COMPACTION_NEXU_EVENT_SEARCH,
          COMPACTION_NEXU_EVENT_REPLACEMENT,
          `${bundleName}: compaction NEXU_EVENT`,
        );
        console.log(
          `[openclaw-sidecar] patched compaction NEXU_EVENT in ${bundleName}`,
        );
      }

      if (source.includes(COMPACTION_FEEDBACK_SEARCH)) {
        source = applyExactReplacement(
          source,
          COMPACTION_FEEDBACK_SEARCH,
          COMPACTION_FEEDBACK_REPLACEMENT,
          `${bundleName}: compaction status feedback`,
        );

        console.log(
          `[openclaw-sidecar] patched compaction status feedback in ${bundleName}`,
        );
      }

      if (source.includes(COMPACTION_COMPLETE_VERBOSE_SEARCH)) {
        source = applyExactReplacement(
          source,
          COMPACTION_COMPLETE_VERBOSE_SEARCH,
          COMPACTION_COMPLETE_VERBOSE_REPLACEMENT,
          `${bundleName}: always-visible compaction complete`,
        );

        console.log(
          `[openclaw-sidecar] patched compaction complete visibility in ${bundleName}`,
        );
      }

      if (source.includes(FOLLOWUP_COMPACTION_FEEDBACK_SEARCH)) {
        source = applyExactReplacement(
          source,
          FOLLOWUP_COMPACTION_FEEDBACK_SEARCH,
          FOLLOWUP_COMPACTION_FEEDBACK_REPLACEMENT,
          `${bundleName}: followup compaction independent message`,
        );

        console.log(
          `[openclaw-sidecar] patched followup compaction feedback in ${bundleName}`,
        );
      }

      if (source.includes(FAST_EXIT_BILLING_AUTH_SEARCH)) {
        source = applyExactReplacement(
          source,
          FAST_EXIT_BILLING_AUTH_SEARCH,
          FAST_EXIT_BILLING_AUTH_REPLACEMENT,
          `${bundleName}: fast-exit billing/auth retry`,
        );

        console.log(
          `[openclaw-sidecar] patched fast-exit billing/auth retry in ${bundleName}`,
        );
      }

      if (source.includes(EMPTY_PAYLOADS_FALLBACK_SEARCH)) {
        source = applyExactReplacement(
          source,
          EMPTY_PAYLOADS_FALLBACK_SEARCH,
          EMPTY_PAYLOADS_FALLBACK_REPLACEMENT,
          `${bundleName}: empty payloads fallback reply`,
        );

        console.log(
          `[openclaw-sidecar] patched empty payloads fallback in ${bundleName}`,
        );
      }

      if (source.includes(EMPTY_PAYLOAD_ARRAY_SEARCH)) {
        source = applyExactReplacement(
          source,
          EMPTY_PAYLOAD_ARRAY_SEARCH,
          EMPTY_PAYLOAD_ARRAY_REPLACEMENT,
          `${bundleName}: empty payload array fallback`,
        );

        console.log(
          `[openclaw-sidecar] patched empty payload array fallback in ${bundleName}`,
        );
      }

      if (source.includes(STOP_FOLLOWUP_ON_EMPTY_SEARCH)) {
        source = applyExactReplacement(
          source,
          STOP_FOLLOWUP_ON_EMPTY_SEARCH,
          STOP_FOLLOWUP_ON_EMPTY_REPLACEMENT,
          `${bundleName}: stop followup on empty payloads`,
        );

        console.log(
          `[openclaw-sidecar] patched stop followup on empty payloads in ${bundleName}`,
        );
      }

      for (const overflow of CONTEXT_OVERFLOW_PATCHES) {
        if (source.includes(overflow.search)) {
          source = source.replaceAll(overflow.search, overflow.zhReplace);
          console.log(
            `[openclaw-sidecar] patched context overflow message in ${bundleName}`,
          );
        }
      }

      patchedFiles.set(relative(openclawPackageRoot, bundlePath), source);
    }
  };

  await patchBundleGroup(
    resolve(openclawPackageRoot, "dist", "plugin-sdk"),
    PLUGIN_SDK_BUNDLE_PATTERNS,
    "plugin-sdk reply/dispatch",
  );
  await patchBundleGroup(
    resolve(openclawPackageRoot, "dist"),
    CORE_DIST_REPLY_BUNDLE_PATTERNS,
    "core dist reply",
  );

  const patchHelperBundleGroup = async (bundleDir, label) => {
    const entries = await readdir(bundleDir);
    const bundleNames = entries.filter((entry) =>
      HELPER_BUNDLE_PATTERNS.some((pattern) => pattern.test(entry)),
    );

    if (bundleNames.length === 0) {
      throw new Error(`Unable to locate OpenClaw ${label} helper bundles.`);
    }

    for (const bundleName of bundleNames) {
      const bundlePath = resolve(bundleDir, bundleName);
      const source = await readFile(bundlePath, "utf8");
      const patchedSource = injectKnownLinkErrorMappings(source, bundleName);

      if (patchedSource !== source) {
        console.log(
          `[openclaw-sidecar] patched known link error formatter in ${bundleName}`,
        );
      }

      patchedFiles.set(
        relative(openclawPackageRoot, bundlePath),
        patchedSource,
      );
    }
  };

  await patchHelperBundleGroup(
    resolve(openclawPackageRoot, "dist"),
    "core dist",
  );
  await patchHelperBundleGroup(
    resolve(openclawPackageRoot, "dist", "plugin-sdk"),
    "plugin-sdk",
  );

  // Patch context overflow messages in ALL dist bundles that contain them.
  const allDistFiles = await readdir(resolve(openclawPackageRoot, "dist"));
  for (const fileName of allDistFiles) {
    if (!fileName.endsWith(".js")) continue;
    const filePath = resolve(openclawPackageRoot, "dist", fileName);
    let source = patchedFiles.get(relative(openclawPackageRoot, filePath));
    if (!source) {
      source = await readFile(filePath, "utf8");
    }
    let patched = false;
    for (const overflow of CONTEXT_OVERFLOW_PATCHES) {
      if (source.includes(overflow.search)) {
        source = source.replaceAll(overflow.search, overflow.zhReplace);
        patched = true;
      }
    }
    if (patched) {
      patchedFiles.set(relative(openclawPackageRoot, filePath), source);
      console.log(
        `[openclaw-sidecar] patched context overflow message in ${fileName}`,
      );
    }
  }

  return patchedFiles;
}

async function stagePatchedOpenclawPackage() {
  await mkdir(dirname(sidecarRoot), { recursive: true });
  const stageRoot = await mkdtemp(
    resolve(dirname(sidecarRoot), ".openclaw-package-stage-"),
  );
  const stagedOpenclawRoot = resolve(stageRoot, "openclaw");

  await cp(openclawRoot, stagedOpenclawRoot, {
    recursive: true,
    dereference: true,
  });

  const overlayFiles = await applyOpenclawRuntimePatches();
  const bridgePatchedFiles = await patchReplyOutcomeBridge(stagedOpenclawRoot);
  const patchedFiles = new Map([...overlayFiles, ...bridgePatchedFiles]);

  for (const [patchRelativePath, patchedSource] of patchedFiles) {
    await writeFile(
      resolve(stagedOpenclawRoot, patchRelativePath),
      patchedSource,
      "utf8",
    );
  }

  console.log(
    `[openclaw-sidecar] staged transactional OpenClaw package with ${patchedFiles.size} patched file(s)`,
  );

  return { stageRoot, stagedOpenclawRoot };
}

async function prepareOpenclawSidecar() {
  if (!(await pathExists(openclawRoot))) {
    throw new Error(
      `OpenClaw runtime dependency not found at ${openclawRoot}. Run pnpm openclaw-runtime:install first.`,
    );
  }

  const cacheFingerprint = await timedStep(
    "compute sidecar cache fingerprint",
    async () => computeOpenclawSidecarFingerprint(),
  );

  if (await tryRestoreCachedArchivedOpenclawSidecar(cacheFingerprint)) {
    return;
  }

  await timedStep("reset sidecar root", async () => {
    await resetDir(sidecarRoot);
    await mkdir(sidecarBinDir, { recursive: true });
  });
  const { stageRoot, stagedOpenclawRoot } = await timedStep(
    "stage patched openclaw package",
    async () => stagePatchedOpenclawPackage(),
  );
  try {
    await timedStep("copy openclaw runtime node_modules", async () => {
      await linkOrCopyDirectory(
        openclawRuntimeNodeModules,
        sidecarNodeModules,
        {
          excludeNames: ["openclaw"],
        },
      );
      await rename(stagedOpenclawRoot, resolve(sidecarNodeModules, "openclaw"));
      if (shouldLogOpenclawSidecarProbes) {
        const copyStats = await collectDirectoryStats(sidecarNodeModules);
        console.log(
          `[openclaw-sidecar][probe] node_modules files=${copyStats.fileCount} bytes=${copyStats.totalBytes} (${formatBytes(copyStats.totalBytes)})`,
        );
      }
    });
  } finally {
    await removePathIfExists(stageRoot);
  }

  await removePathIfExists(resolve(sidecarNodeModules, "electron"));
  await removePathIfExists(resolve(sidecarNodeModules, "electron-builder"));
  await chmod(packagedOpenclawEntry, 0o755).catch(() => null);
  await writeFile(
    resolve(sidecarRoot, "package.json"),
    '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
  );
  await writeFile(
    resolve(sidecarRoot, "metadata.json"),
    `${JSON.stringify(
      {
        strategy: "sidecar-node-modules",
        openclawEntry: packagedOpenclawEntry,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(sidecarBinDir, "openclaw.cmd"),
    `@echo off\r\nnode "${packagedOpenclawEntry}" %*\r\n`,
  );

  const wrapperPath = resolve(sidecarBinDir, "openclaw");
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu

case "$0" in
  */*) script_parent="\${0%/*}" ;;
  *) script_parent="." ;;
esac

script_dir="$(CDPATH= cd -- "$script_parent" && pwd)"
sidecar_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
entry="$sidecar_root/node_modules/openclaw/openclaw.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$entry" "$@"
fi

if [ -n "\${OPENCLAW_ELECTRON_EXECUTABLE:-}" ] && [ -x "$OPENCLAW_ELECTRON_EXECUTABLE" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$OPENCLAW_ELECTRON_EXECUTABLE" "$entry" "$@"
fi

contents_dir="$(CDPATH= cd -- "$sidecar_root/../../.." && pwd)"
macos_dir="$contents_dir/MacOS"

if [ -d "$macos_dir" ]; then
  for candidate in "$macos_dir"/*; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      ELECTRON_RUN_AS_NODE=1 exec "$candidate" "$entry" "$@"
    fi
  done
fi

echo "openclaw launcher could not find node or a bundled Electron executable" >&2
exit 127
`,
  );
  await chmod(wrapperPath, 0o755);
  await timedStep("sign native binaries", async () =>
    signOpenclawNativeBinaries(),
  );

  if (shouldCopyRuntimeDependencies() && shouldArchiveOpenclawSidecar) {
    const archivePath = resolve(
      dirname(sidecarRoot),
      `openclaw-sidecar.${OPENCLAW_SIDECAR_ARCHIVE_FORMAT}`,
    );
    await timedStep("archive openclaw sidecar", async () => {
      await removePathIfExists(archivePath);
      let preArchiveStats = null;
      if (shouldLogOpenclawSidecarProbes) {
        preArchiveStats = await collectDirectoryStats(sidecarRoot);
        console.log(
          `[openclaw-sidecar][probe] pre-archive files=${preArchiveStats.fileCount} bytes=${preArchiveStats.totalBytes} (${formatBytes(preArchiveStats.totalBytes)})`,
        );
      }
      await createOpenclawSidecarArchive(archivePath);
      if (shouldLogOpenclawSidecarProbes) {
        const archiveStats = await stat(archivePath);
        console.log(
          `[openclaw-sidecar][probe] archive bytes=${archiveStats.size} (${formatBytes(archiveStats.size)}) ratio=${(archiveStats.size / Math.max(preArchiveStats?.totalBytes ?? 1, 1)).toFixed(3)}`,
        );
      }
      await resetDir(sidecarRoot);
      await writeFile(
        resolve(sidecarRoot, "archive.json"),
        `${JSON.stringify(
          {
            format: OPENCLAW_SIDECAR_ARCHIVE_FORMAT,
            path: OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME,
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        resolve(sidecarRoot, "package.json"),
        '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
      );
      await rename(
        archivePath,
        resolve(sidecarRoot, OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME),
      );
      await writeOpenclawSidecarCacheEntry(cacheFingerprint);
    });
  } else if (shouldCopyRuntimeDependencies()) {
    console.log(
      "[openclaw-sidecar] skipping archive packaging for fast CI mode",
    );
  }
}

await prepareOpenclawSidecar();
