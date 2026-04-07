# OpenClaw Error Handling & Compaction Internals

This document captures technical findings from investigating OpenClaw's error propagation, compaction architecture, and channel delivery paths. Useful for debugging bot silence, error message customization, and compaction behavior.

## Error Propagation Chain

```
LLM Provider returns HTTP error (e.g. 429 insufficient_credits)
  → pi-ai SDK: output.errorMessage = error.message (error.code is LOST)
    → OpenClaw agent runner: lastAssistant.errorMessage = "429 insufficient credits"
      → formatAssistantErrorText() → user-facing error text
        → Channel delivery (feishu streaming, slack, etc.)
```

**Key limitation**: The original `error.code` from the provider is discarded by pi-ai's catch block (`openai-completions.js`). Only `error.message` survives into `errorMessage`. To recover the code, the link service prefixes `error.message` with `[code=xxx]`.

### Error text formatting priority

In `pi-embedded-runner/run.ts`, the error text for delivery is resolved as:

1. `formattedAssistantErrorText` (from `formatAssistantErrorText()`) — preferred
2. `lastAssistant.errorMessage.trim()` — raw provider error
3. Fallback: "LLM request failed."

Our patch swaps priority so `formattedAssistantErrorText` (which contains our localized text) takes precedence.

## Compaction Architecture

### Two compaction triggers

| Trigger | When | Code path | Events |
|---------|------|-----------|--------|
| **Pi auto-compaction** | Pi framework detects prompt approaching context window limit | Built into pi-agent-core session manager | Emits `compaction: start/end` via `onAgentEvent` |
| **Emergency compaction** | LLM returns context overflow error (413, etc.) | `pi-embedded-runner/run.ts` explicitly calls `contextEngine.compact()` | Emits events via `pi-embedded-subscribe.handlers.compaction.ts` |

### Pi auto-compaction disable guard

`applyPiAutoCompactionGuard()` in `pi-settings.ts` disables Pi's built-in auto-compaction when `contextEngineInfo.ownsCompaction === true`. Currently **no context engine sets this flag**, so Pi auto-compaction remains active.

### Safeguard extension (`compaction-safeguard.ts`)

When `compaction.mode === "safeguard"`, the `compactionSafeguardExtension` registers on the `session_before_compact` event (pi-coding-agent extension API). It:

1. Checks `isRealConversationMessage()` — cancels if no user/assistant/toolResult messages
2. Resolves model + API key — cancels if unavailable
3. Splits messages: `messagesToSummarize` + `preservedRecentMessages` (based on `recentTurnsPreserve`)
4. Calls `summarizeInStages()` to generate a structured summary via LLM
5. Quality guard: optionally retries summarization for better results

**Cancel reasons**:
- "no real conversation messages to summarize" — session only has system/error messages
- "no API key available" — can't call LLM for summarization
- Both ctx.model and runtime.model undefined

### Pi auto-compaction trigger mechanism

Pi framework uses its **internal tokenizer** to estimate prompt token count before each LLM call. If the estimate approaches the model's `contextWindow`, it triggers compaction. Key findings:

- **Provider-reported usage is ignored** — mock server's `usage.prompt_tokens` has no effect on compaction decisions
- **Provider catalog context window takes priority** — link provider's model catalog overrides locally-set `contextWindow` values
- **BYOK provider context windows** can be overridden via `openclaw.json` and survive hot-reload (if not overwritten by `doSync()`)
- **`doSync()` overwrites `openclaw.json`** — manual config changes lost on next sync. To persist, inject values in `openclaw-sync-service.ts` after `compileOpenClawConfig()`

### Critical: onAgentEvent execution context separation

The subscriber handler's `ctx.params.onAgentEvent` and `agent-runner-execution.ts`'s `onAgentEvent` are **different execution contexts**. Compaction events emitted by `handleAutoCompactionStart` via subscriber don't reach `agent-runner-execution.ts`'s handler. Solution: emit `NEXU_EVENT` via `console.error()` → controller captures from stderr → sends channel message via `gatewayService.sendChannelMessage()`.

### Compaction config parameters

| Parameter | Default | Effect |
|-----------|---------|--------|
| `mode` | `"safeguard"` | Use safeguard extension for compaction |
| `maxHistoryShare` | `0.5` | Max fraction of context for retained history |
| `keepRecentTokens` | `20000` | Tokens to keep in recent messages |
| `recentTurnsPreserve` | `5` | Recent turns excluded from summarization |
| `reserveTokensFloor` | `20000` | Min reserved tokens for prompt + response |
| `qualityGuard.enabled` | `true` | Retry summarization for quality |
| `timeoutSeconds` | `600` (10min) | Agent-level LLM call timeout |

### Compaction safety timeout

`EMBEDDED_COMPACTION_TIMEOUT_MS = 300_000` (5 min) — independent of agent `timeoutSeconds`.

## Channel Delivery Paths

### Feishu

Feishu uses **Card Kit streaming** for replies. The reply text is streamed chunk-by-chunk directly to a feishu card via `streaming-card.ts`. This path:

- **Does NOT go through `deliverOutboundPayloads()`** — so `message_sending` plugin hook doesn't fire
- **Does NOT read from session JSONL** — so `before_message_write` hook modifications don't affect delivery
- Text comes directly from the agent's `replyItems` built by `buildEmbeddedRunPayloads()`

### Other channels (Slack, WeChat, etc.)

Use `deliverOutboundPayloads()` which fires `message_sending` plugin hook.

### Implications for error text customization

The only way to customize error text for **all channels** (including feishu streaming) is to patch `formatRawAssistantErrorForUi()` or `formatAssistantErrorText()` — these are the source functions that generate the text before it enters any delivery path.

## Retry & Failover Architecture

### Inner loop: `pi-embedded-runner/run.ts`

`while(true)` loop with up to `MAX_RUN_RETRY_ITERATIONS` iterations (32-160, based on auth profile count).

On each LLM failure:
1. Classify: auth / billing / rate-limit / failover / timeout
2. Try rotating auth profiles (`advanceAuthProfile()`)
3. Try fallback model if configured
4. Backoff with `OVERLOAD_FAILOVER_BACKOFF_POLICY` (250ms → 1500ms)

### Outer loop: `agent-runner-execution.ts`

`for(;;)` loop that calls `runWithModelFallback()`. Retries on:
- Context overflow → session reset → continue
- Compaction failure → session reset → continue
- Transient HTTP error → single retry with delay

### Followup runner

After session reset, if `finalizeWithFollowup()` is called with empty payloads, it can trigger additional followup turns — potentially causing infinite loops when all LLM calls fail.

## Known Issues & Patches

### Bot silence after session reset

**Root cause**: After context overflow → session reset, the new session's agent run fails → `payloadArray` is empty → `finalizeWithFollowup(void 0, ...)` triggers another followup turn → infinite loop.

**Patches applied**:
1. Fast-exit: break inner failover loop after 2 consecutive failures
2. Empty payloads fallback: push error text instead of silently returning
3. Stop followup on empty payloads: `return` instead of `finalizeWithFollowup()`

### LLM timeout

Default `timeoutSeconds: 600` (10 min) is too long. Set to `120` (2 min) in Nexu config.

### Locale for error messages

Locale is read from `nexu-credit-guard-state.json` (written by controller `doSync()`). Uses mtime-based cache via `globalThis.__nexuCgLocale`. Falls back to `"zh-CN"`.

## File References

| Component | Source | Bundle |
|-----------|--------|--------|
| Error formatting | `src/agents/pi-embedded-helpers/errors.ts` | `pi-embedded-helpers-*.js` |
| Agent runner execution | `src/auto-reply/reply/agent-runner-execution.ts` | `reply-*.js` |
| Failover loop | `src/agents/pi-embedded-runner/run.ts` | `reply-*.js` |
| Compaction safeguard | `src/agents/pi-extensions/compaction-safeguard.ts` | `compact-*.js` |
| Followup runner | `src/auto-reply/reply/followup-runner.ts` | `compact-*.js` |
| Feishu streaming | `extensions/feishu/src/streaming-card.ts` | feishu extension |
| Feishu reply dispatch | `extensions/feishu/src/reply-dispatcher.ts` | feishu extension |
| Timeout resolution | `src/agents/timeout.ts` | various |
| Pi auto-compaction guard | `src/agents/pi-settings.ts` | various |
| Plugin hooks | `src/plugins/hooks.ts` | `subsystem-*.js` |
| Patch script | `apps/desktop/scripts/prepare-openclaw-sidecar.mjs` | N/A |
