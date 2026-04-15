import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

const OPENCLAW_PACKAGE_PATCH_DIRNAME = "openclaw";
const STAGE_MANIFEST_FILENAME = "manifest.json";
const STAGE_PATCH_VERSION = "2026-04-09-slimclaw-runtime-stage-v1";
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
  },
  {
    search:
      "⚠️ Context limit exceeded during compaction. I've reset our conversation to start fresh - please try again.\\n\\nTo prevent this, increase your compaction buffer by setting `agents.defaults.compaction.reserveTokensFloor` to 20000 or higher in your config.",
    zhReplace:
      "⚠️ 当前对话内容已超出模型处理上限，自动整理未能成功，已为你重置会话。请重新发送消息继续使用。如反复出现，请尝试缩短单条消息或开启新对话。",
  },
] as const;
const FORMATTED_ASSISTANT_ERROR_PRIORITY_SEARCH =
  'const assistantErrorText = lastAssistant?.stopReason === "error" ? lastAssistant.errorMessage?.trim() || formattedAssistantErrorText : void 0;';
const FORMATTED_ASSISTANT_ERROR_PRIORITY_REPLACEMENT =
  'const assistantErrorText = lastAssistant?.stopReason === "error" ? formattedAssistantErrorText || lastAssistant.errorMessage?.trim() : void 0;';
const FAILOVER_ERROR_PRIORITY_SEARCH =
  '}) : void 0) || lastAssistant?.errorMessage?.trim() || (timedOut ? "LLM request timed out." : rateLimitFailure ? "LLM request rate limited." : billingFailure ? formatBillingErrorMessage(activeErrorContext.provider, activeErrorContext.model) : authFailure ? "LLM request unauthorized." : "LLM request failed.");';
const FAILOVER_ERROR_PRIORITY_REPLACEMENT =
  '}) : void 0) || (timedOut ? "LLM request timed out." : rateLimitFailure ? "LLM request rate limited." : billingFailure ? formatBillingErrorMessage(activeErrorContext.provider, activeErrorContext.model) : authFailure ? "LLM request unauthorized." : lastAssistant?.errorMessage?.trim() || "LLM request failed.");';
const FAST_EXIT_BILLING_AUTH_SEARCH =
  "const authFailure = isAuthAssistantError(lastAssistant);";
const FAST_EXIT_BILLING_AUTH_REPLACEMENT =
  "const authFailure = isAuthAssistantError(lastAssistant);\n\t\t\t\tparams.__nexuNrCount = (params.__nexuNrCount || 0) + 1; if (params.__nexuNrCount >= 2) break;";
const EMPTY_PAYLOADS_FALLBACK_SEARCH =
  '\treturn {\n\t\tkind: "success",\n\t\trunId,\n\t\trunResult,';
const EMPTY_PAYLOADS_FALLBACK_REPLACEMENT =
  '\tif (!runResult?.payloads?.length && runResult?.meta?.error) {\n\t\tconst _errMsg = runResult.meta.error.message || runResult.meta.error;\n\t\treturn {\n\t\t\tkind: "final",\n\t\t\tpayload: { text: typeof _errMsg === "string" ? _errMsg : "⚠️ An error occurred. Please try again." }\n\t\t};\n\t}\n\treturn {\n\t\tkind: "success",\n\t\trunId,\n\t\trunResult,';
const COMPACTION_NEXU_EVENT_SEARCH =
  "function handleAutoCompactionStart(ctx) {";
const COMPACTION_NEXU_EVENT_REPLACEMENT =
  'function handleAutoCompactionStart(ctx) {\n\tfetch("http://127.0.0.1:" + (process.env.CONTROLLER_PORT || "50800") + "/api/internal/compaction-notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionKey: ctx.params.sessionKey, channel: ctx.params.messageChannel, runId: ctx.params.runId }) }).catch(() => {});';
const COMPACTION_FEEDBACK_SEARCH =
  'if ((typeof evt.data.phase === "string" ? evt.data.phase : "") === "end") autoCompactionCompleted = true;';
const COMPACTION_FEEDBACK_REPLACEMENT =
  '{ const _cp = typeof evt.data.phase === "string" ? evt.data.phase : ""; if (_cp === "start") { const _cl = globalThis.__nexuCgLocale || "zh-CN"; params.typingSignals.signalTextDelta(_cl === "en" ? "\\u23f3 Compacting conversation history..." : "\\u23f3 \\u6b63\\u5728\\u6574\\u7406\\u5bf9\\u8bdd\\u8bb0\\u5f55...").catch(() => {}); } if (_cp === "end") autoCompactionCompleted = true; }';
const EMPTY_PAYLOAD_ARRAY_SEARCH =
  "const payloadArray = runResult.payloads ?? [];\n\t\t\tif (payloadArray.length === 0) return;";
const EMPTY_PAYLOAD_ARRAY_REPLACEMENT =
  'const payloadArray = runResult.payloads ?? [];\n\t\t\tif (payloadArray.length === 0) {\n\t\t\t\tconst _fallbackErr = runResult.meta?.error?.message || runResult.meta?.error;\n\t\t\t\tif (_fallbackErr) {\n\t\t\t\t\tpayloadArray.push({ text: typeof _fallbackErr === "string" ? _fallbackErr : "\\u26a0\\ufe0f An error occurred. Please try again.", isError: true });\n\t\t\t\t} else {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t}';
const FOLLOWUP_COMPACTION_FEEDBACK_SEARCH =
  'if (evt.stream === "compaction") {\n\t\t\t\t\t\t\tif ((typeof evt.data.phase === "string" ? evt.data.phase : "") === "end") memoryCompactionCompleted = true;\n\t\t\t\t\t\t}';
const FOLLOWUP_COMPACTION_FEEDBACK_REPLACEMENT =
  'if (evt.stream === "compaction") {\n\t\t\t\t\t\t\tconst _phase = typeof evt.data.phase === "string" ? evt.data.phase : "";\n\t\t\t\t\t\t\tif (_phase === "start") { const _l = globalThis.__nexuCgLocale || "zh-CN"; sendFollowupPayloads([{ text: _l === "en" ? "\\u23f3 Compacting conversation, estimated ~30s..." : "\\u23f3 \\u6b63\\u5728\\u6574\\u7406\\u5bf9\\u8bdd\\u8bb0\\u5f55\\uff0c\\u9884\\u8ba130\\u79d2\\u5185\\u5b8c\\u6210..." }], queued).catch(() => {}); }\n\t\t\t\t\t\t\tif (_phase === "end") memoryCompactionCompleted = true;\n\t\t\t\t\t\t}';
const COMPACTION_COMPLETE_VERBOSE_SEARCH =
  'if (queued.run.verboseLevel && queued.run.verboseLevel !== "off") {\n\t\t\t\t\tconst suffix = typeof count === "number" ? ` (count ${count})` : "";\n\t\t\t\t\tfinalPayloads.unshift({ text: `🧹 Auto-compaction complete${suffix}.` });\n\t\t\t\t}';
const COMPACTION_COMPLETE_VERBOSE_REPLACEMENT =
  '{ const _l = globalThis.__nexuCgLocale || "zh-CN"; finalPayloads.unshift({ text: _l === "en" ? "\\u2705 Conversation compacted successfully." : "\\u2705 \\u5bf9\\u8bdd\\u8bb0\\u5f55\\u6574\\u7406\\u5b8c\\u6210\\u3002" }); }';
const STOP_FOLLOWUP_ON_EMPTY_SEARCH =
  "if (payloadArray.length === 0) return finalizeWithFollowup(void 0, queueKey, runFollowupTurn);";
const STOP_FOLLOWUP_ON_EMPTY_REPLACEMENT =
  "if (payloadArray.length === 0) return;";
const LOCALE_READER_LINES = [
  'const _nexuLocale = (() => { try { const _fs = require("node:fs"); const _path = require("node:path"); const _stateDir = process.env.OPENCLAW_STATE_DIR; if (!_stateDir) return "zh-CN"; const _fp = _path.join(_stateDir, "nexu-credit-guard-state.json"); const _mt = _fs.statSync(_fp).mtimeMs; if (globalThis.__nexuCgMt === _mt) return globalThis.__nexuCgLocale || "zh-CN"; const _d = JSON.parse(_fs.readFileSync(_fp, "utf8")); globalThis.__nexuCgMt = _mt; globalThis.__nexuCgLocale = _d.locale || "zh-CN"; return globalThis.__nexuCgLocale; } catch { return globalThis.__nexuCgLocale || "zh-CN"; } })();',
] as const;
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
] as const;
const HELPER_BUNDLE_PATTERNS = [/^pi-embedded-helpers-.*\.js$/u] as const;
const PLUGIN_SDK_BUNDLE_PATTERNS = [
  /^reply-.*\.js$/u,
  /^dispatch-.*\.js$/u,
] as const;
const CORE_DIST_REPLY_BUNDLE_PATTERNS = [/^reply-.*\.js$/u] as const;
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
] as const;
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

type StageLog = (message: string) => void;

type StageManifest = {
  fingerprint: string;
  patchedFileCount: number;
  createdAt: string;
};

export type ComputeSlimclawRuntimeStageFingerprintOptions = {
  sourceOpenclawRoot: string;
  patchRoot: string;
};

export type PrepareSlimclawRuntimeStageInternalOptions = {
  sourceOpenclawRoot: string;
  patchRoot: string;
  targetStageRoot: string;
  log?: StageLog;
};

export type PrepareSlimclawRuntimeStageResult = {
  stagedOpenclawRoot: string;
  patchedFileCount: number;
  reused: boolean;
  fingerprint: string;
};

function emitLog(log: StageLog | undefined, message: string): void {
  log?.(message);
}

function createStageTimer(log: StageLog | undefined): {
  mark: (message: string) => void;
  elapsedMs: () => number;
} {
  const startedAt = Date.now();

  return {
    mark(message: string): void {
      emitLog(log, `${message} (${Date.now() - startedAt}ms)`);
    },
    elapsedMs(): number {
      return Date.now() - startedAt;
    },
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    await readdir(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
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

async function readOverlayFiles(
  patchRoot: string,
  log?: StageLog,
): Promise<Map<string, string>> {
  const patchedFiles = new Map<string, string>();
  const openclawPackagePatchRoot = resolve(
    patchRoot,
    OPENCLAW_PACKAGE_PATCH_DIRNAME,
  );

  if (!(await directoryExists(openclawPackagePatchRoot))) {
    return patchedFiles;
  }

  const patchFiles = await collectFiles(openclawPackagePatchRoot);

  for (const patchFilePath of patchFiles) {
    patchedFiles.set(
      relative(openclawPackagePatchRoot, patchFilePath),
      await readFile(patchFilePath, "utf8"),
    );
  }

  if (patchFiles.length > 0) {
    emitLog(
      log,
      `[slimclaw-runtime-stage] prepared ${patchFiles.length} overlay patch file(s) from ${openclawPackagePatchRoot}`,
    );
  }

  return patchedFiles;
}

function applyExactReplacement(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) {
    throw new Error(`Unable to locate patch anchor for ${label}.`);
  }

  return source.replace(search, replacement);
}

function countOccurrences(source: string, search: string): number {
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

function injectKnownLinkErrorMappings(
  source: string,
  bundleName: string,
): string {
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

async function patchReplyOutcomeBridge(
  openclawPackageRoot: string,
  log?: StageLog,
): Promise<Map<string, string>> {
  const patchedFiles = new Map<string, string>();
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
    emitLog(
      log,
      "[slimclaw-runtime-stage] patched feishu single-agent pre-llm trigger",
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

  const patchBundleGroup = async (
    bundleDir: string,
    patterns: readonly RegExp[],
    label: string,
  ) => {
    const entries = await readdir(bundleDir);
    const bundleNames = entries
      .filter((entry) => patterns.some((pattern) => pattern.test(entry)))
      .sort((left, right) => left.localeCompare(right));

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
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched reply outcome bridge in ${bundleName}`,
        );
      }

      if (source.includes(FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH)) {
        source = applyExactReplacement(
          source,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_REPLACEMENT,
          `${bundleName}: feishu error reply suppress guard`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched feishu error final suppression in ${bundleName}`,
        );
      }

      if (source.includes(CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH)) {
        source = applyExactReplacement(
          source,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_REPLACEMENT,
          `${bundleName}: core embedded payload message provider`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched embedded payload message provider in ${bundleName}`,
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
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched feishu pre-reply final suppression in ${bundleName}`,
        );
      }

      if (source.includes(FORMATTED_ASSISTANT_ERROR_PRIORITY_SEARCH)) {
        source = applyExactReplacement(
          source,
          FORMATTED_ASSISTANT_ERROR_PRIORITY_SEARCH,
          FORMATTED_ASSISTANT_ERROR_PRIORITY_REPLACEMENT,
          `${bundleName}: formatted assistant error priority`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched formatted assistant error priority in ${bundleName}`,
        );
      }

      if (source.includes(FAILOVER_ERROR_PRIORITY_SEARCH)) {
        source = applyExactReplacement(
          source,
          FAILOVER_ERROR_PRIORITY_SEARCH,
          FAILOVER_ERROR_PRIORITY_REPLACEMENT,
          `${bundleName}: failover error priority`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched failover error priority in ${bundleName}`,
        );
      }

      if (
        source.includes(COMPACTION_NEXU_EVENT_SEARCH) &&
        !source.includes("/api/internal/compaction-notify")
      ) {
        source = applyExactReplacement(
          source,
          COMPACTION_NEXU_EVENT_SEARCH,
          COMPACTION_NEXU_EVENT_REPLACEMENT,
          `${bundleName}: compaction notify bridge`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched compaction notify bridge in ${bundleName}`,
        );
      }

      if (source.includes(COMPACTION_FEEDBACK_SEARCH)) {
        source = applyExactReplacement(
          source,
          COMPACTION_FEEDBACK_SEARCH,
          COMPACTION_FEEDBACK_REPLACEMENT,
          `${bundleName}: compaction status feedback`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched compaction status feedback in ${bundleName}`,
        );
      }

      if (source.includes(COMPACTION_COMPLETE_VERBOSE_SEARCH)) {
        source = applyExactReplacement(
          source,
          COMPACTION_COMPLETE_VERBOSE_SEARCH,
          COMPACTION_COMPLETE_VERBOSE_REPLACEMENT,
          `${bundleName}: always-visible compaction complete`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched compaction complete visibility in ${bundleName}`,
        );
      }

      if (source.includes(FOLLOWUP_COMPACTION_FEEDBACK_SEARCH)) {
        source = applyExactReplacement(
          source,
          FOLLOWUP_COMPACTION_FEEDBACK_SEARCH,
          FOLLOWUP_COMPACTION_FEEDBACK_REPLACEMENT,
          `${bundleName}: followup compaction independent message`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched followup compaction feedback in ${bundleName}`,
        );
      }

      if (source.includes(FAST_EXIT_BILLING_AUTH_SEARCH)) {
        source = applyExactReplacement(
          source,
          FAST_EXIT_BILLING_AUTH_SEARCH,
          FAST_EXIT_BILLING_AUTH_REPLACEMENT,
          `${bundleName}: fast-exit billing/auth retry`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched fast-exit billing/auth retry in ${bundleName}`,
        );
      }

      if (source.includes(EMPTY_PAYLOADS_FALLBACK_SEARCH)) {
        source = applyExactReplacement(
          source,
          EMPTY_PAYLOADS_FALLBACK_SEARCH,
          EMPTY_PAYLOADS_FALLBACK_REPLACEMENT,
          `${bundleName}: empty payloads fallback reply`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched empty payloads fallback in ${bundleName}`,
        );
      }

      if (source.includes(EMPTY_PAYLOAD_ARRAY_SEARCH)) {
        source = applyExactReplacement(
          source,
          EMPTY_PAYLOAD_ARRAY_SEARCH,
          EMPTY_PAYLOAD_ARRAY_REPLACEMENT,
          `${bundleName}: empty payload array fallback`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched empty payload array fallback in ${bundleName}`,
        );
      }

      if (source.includes(STOP_FOLLOWUP_ON_EMPTY_SEARCH)) {
        source = applyExactReplacement(
          source,
          STOP_FOLLOWUP_ON_EMPTY_SEARCH,
          STOP_FOLLOWUP_ON_EMPTY_REPLACEMENT,
          `${bundleName}: stop followup on empty payloads`,
        );
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched stop followup on empty payloads in ${bundleName}`,
        );
      }

      for (const overflow of CONTEXT_OVERFLOW_PATCHES) {
        if (source.includes(overflow.search)) {
          source = source.replaceAll(overflow.search, overflow.zhReplace);
          emitLog(
            log,
            `[slimclaw-runtime-stage] patched context overflow message in ${bundleName}`,
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

  const patchHelperBundleGroup = async (bundleDir: string, label: string) => {
    const entries = await readdir(bundleDir);
    const bundleNames = entries
      .filter((entry) =>
        HELPER_BUNDLE_PATTERNS.some((pattern) => pattern.test(entry)),
      )
      .sort((left, right) => left.localeCompare(right));

    if (bundleNames.length === 0) {
      throw new Error(`Unable to locate OpenClaw ${label} helper bundles.`);
    }

    for (const bundleName of bundleNames) {
      const bundlePath = resolve(bundleDir, bundleName);
      const source = await readFile(bundlePath, "utf8");
      const patchedSource = injectKnownLinkErrorMappings(source, bundleName);

      if (patchedSource !== source) {
        emitLog(
          log,
          `[slimclaw-runtime-stage] patched known link error formatter in ${bundleName}`,
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

  const allDistFiles = await readdir(resolve(openclawPackageRoot, "dist"));
  for (const fileName of allDistFiles.sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (!fileName.endsWith(".js")) {
      continue;
    }

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
      emitLog(
        log,
        `[slimclaw-runtime-stage] patched context overflow message in ${fileName}`,
      );
    }
  }

  return patchedFiles;
}

async function collectFingerprintFiles(
  sourceOpenclawRoot: string,
  patchRoot: string,
): Promise<Array<{ label: string; path: string }>> {
  const files: Array<{ label: string; path: string }> = [];
  const sourceCandidates = [
    resolve(sourceOpenclawRoot, "package.json"),
    resolve(sourceOpenclawRoot, "extensions", "feishu", "src", "bot.ts"),
  ];

  for (const sourceFilePath of sourceCandidates) {
    if (await pathExists(sourceFilePath)) {
      files.push({
        label: `source:${relative(sourceOpenclawRoot, sourceFilePath)}`,
        path: sourceFilePath,
      });
    }
  }

  const bundleTargets = [
    { dir: resolve(sourceOpenclawRoot, "dist"), patterns: [/\.js$/u] },
    {
      dir: resolve(sourceOpenclawRoot, "dist", "plugin-sdk"),
      patterns: [/\.js$/u],
    },
  ] as const;

  for (const target of bundleTargets) {
    if (!(await directoryExists(target.dir))) {
      continue;
    }

    const entries = await readdir(target.dir);
    for (const entry of entries
      .filter((name) => target.patterns.some((pattern) => pattern.test(name)))
      .sort((left, right) => left.localeCompare(right))) {
      const bundlePath = resolve(target.dir, entry);
      files.push({
        label: `source:${relative(sourceOpenclawRoot, bundlePath)}`,
        path: bundlePath,
      });
    }
  }

  const openclawPackagePatchRoot = resolve(
    patchRoot,
    OPENCLAW_PACKAGE_PATCH_DIRNAME,
  );
  if (await directoryExists(openclawPackagePatchRoot)) {
    for (const patchFilePath of await collectFiles(openclawPackagePatchRoot)) {
      files.push({
        label: `patch:${relative(openclawPackagePatchRoot, patchFilePath)}`,
        path: patchFilePath,
      });
    }
  }

  return files;
}

export async function computeSlimclawRuntimeStageFingerprint(
  options: ComputeSlimclawRuntimeStageFingerprintOptions,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`${STAGE_PATCH_VERSION}\n`);

  for (const file of await collectFingerprintFiles(
    options.sourceOpenclawRoot,
    options.patchRoot,
  )) {
    hash.update(`${file.label}\n`);
    hash.update(await readFile(file.path));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function readStageManifest(
  stageRoot: string,
): Promise<StageManifest | null> {
  const manifestPath = resolve(stageRoot, STAGE_MANIFEST_FILENAME);

  if (!(await pathExists(manifestPath))) {
    return null;
  }

  return JSON.parse(await readFile(manifestPath, "utf8")) as StageManifest;
}

export async function prepareSlimclawRuntimeStageInternal(
  options: PrepareSlimclawRuntimeStageInternalOptions,
): Promise<PrepareSlimclawRuntimeStageResult> {
  const stageTimer = createStageTimer(options.log);

  stageTimer.mark(
    `[slimclaw-runtime-stage] computing runtime stage fingerprint for ${options.targetStageRoot}`,
  );
  const fingerprint = await computeSlimclawRuntimeStageFingerprint({
    sourceOpenclawRoot: options.sourceOpenclawRoot,
    patchRoot: options.patchRoot,
  });
  stageTimer.mark(
    `[slimclaw-runtime-stage] computed runtime stage fingerprint for ${options.targetStageRoot}`,
  );
  const existingManifest = await readStageManifest(options.targetStageRoot);
  const existingOpenclawRoot = resolve(options.targetStageRoot, "openclaw");

  if (
    existingManifest?.fingerprint === fingerprint &&
    (await directoryExists(existingOpenclawRoot))
  ) {
    emitLog(
      options.log,
      `[slimclaw-runtime-stage] reusing staged OpenClaw package at ${options.targetStageRoot}`,
    );
    return {
      stagedOpenclawRoot: existingOpenclawRoot,
      patchedFileCount: existingManifest.patchedFileCount,
      reused: true,
      fingerprint,
    };
  }

  await mkdir(dirname(options.targetStageRoot), { recursive: true });
  const stageRoot = await mkdtemp(
    resolve(
      dirname(options.targetStageRoot),
      `.${basename(options.targetStageRoot)}-stage-`,
    ),
  );
  const stagedOpenclawRoot = resolve(stageRoot, "openclaw");

  stageTimer.mark(
    `[slimclaw-runtime-stage] copying runtime into candidate stage at ${stageRoot}`,
  );
  await cp(options.sourceOpenclawRoot, stagedOpenclawRoot, {
    recursive: true,
    dereference: true,
  });
  stageTimer.mark(
    `[slimclaw-runtime-stage] copied runtime into candidate stage at ${stageRoot}`,
  );

  stageTimer.mark(
    `[slimclaw-runtime-stage] applying overlay and compatibility patches inside ${stageRoot}`,
  );
  const overlayFiles = await readOverlayFiles(options.patchRoot, options.log);
  const bridgePatchedFiles = await patchReplyOutcomeBridge(
    stagedOpenclawRoot,
    options.log,
  );
  const patchedFiles = new Map([...overlayFiles, ...bridgePatchedFiles]);

  for (const [patchRelativePath, patchedSource] of patchedFiles) {
    await writeFile(
      resolve(stagedOpenclawRoot, patchRelativePath),
      patchedSource,
      "utf8",
    );
  }
  stageTimer.mark(
    `[slimclaw-runtime-stage] applied ${patchedFiles.size} patched file(s) inside ${stageRoot}`,
  );

  const manifest: StageManifest = {
    fingerprint,
    patchedFileCount: patchedFiles.size,
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    resolve(stageRoot, STAGE_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  stageTimer.mark(
    `[slimclaw-runtime-stage] switching staged runtime into place at ${options.targetStageRoot}`,
  );
  await rm(options.targetStageRoot, { recursive: true, force: true });
  await rename(stageRoot, options.targetStageRoot);

  emitLog(
    options.log,
    `[slimclaw-runtime-stage] staged OpenClaw package with ${patchedFiles.size} patched file(s) at ${options.targetStageRoot} (${stageTimer.elapsedMs()}ms)`,
  );

  return {
    stagedOpenclawRoot: resolve(options.targetStageRoot, "openclaw"),
    patchedFileCount: patchedFiles.size,
    reused: false,
    fingerprint,
  };
}
