# Session Key Alignment Plan

Date: 2026-03-06

## Background

Nexu currently constructs and stores session keys independently from OpenClaw:

- Slack webhook ingestion writes `agent:{botId}:slack:channel:{channelId}` or `agent:{botId}:slack:thread:{threadTs}` in `apps/api/src/routes/slack-events.ts`.
- Discord sync writes `agent:{botId}:discord:channel:{guildId}` in `apps/api/src/routes/session-routes.ts`, even though the identifier currently comes from the guild list API.
- Artifact creation stores whatever `sessionKey` the caller sends and does not resolve OpenClaw-style routing server-side in `apps/api/src/routes/artifact-routes.ts`.
- `sessions.session_key` is unique, while `artifacts.session_key` is free-form text with no FK. Any canonicalization must therefore update both tables consistently.

This causes mismatches between Nexu session rows, artifact attachment, and the canonical session keys used by OpenClaw.

## Goals

1. Make newly written Nexu session keys match OpenClaw key shapes for the cases Nexu can infer reliably today.
2. Make artifact creation resolve to a canonical Nexu/OpenClaw session key when the caller supplies enough structured context.
3. Canonicalize valid existing production-shaped rows without touching malformed or test-only data.

## Non-Goals

- Do not attempt to infer arbitrary OpenClaw config from Nexu alone.
- Do not rewrite malformed placeholder data that does not map cleanly to a canonical OpenClaw key.
- Do not use fuzzy `ILIKE '%...%'` matching in write paths.

## Problem 1: Align Nexu-written session keys with OpenClaw

### Current Nexu behavior

- `apps/api/src/routes/slack-events.ts`
  - channel message: `agent:{botId}:slack:channel:{channelId}`
  - thread reply: `agent:{botId}:slack:thread:{threadTs}`
- `apps/api/src/routes/session-routes.ts`
  - Discord sync: `agent:{botId}:discord:channel:{guildId}`

### Target behavior

Use OpenClaw-compatible key construction for the cases Nexu can determine from the inbound event itself:

| Scenario | Current Nexu | Target |
|----------|--------------|--------|
| Slack channel message | `agent:{botId}:slack:channel:{channelId}` | `agent:{botId}:slack:channel:{channelId}` |
| Slack channel thread | `agent:{botId}:slack:thread:{threadTs}` | `agent:{botId}:slack:channel:{channelId}:thread:{threadTs}` |
| Slack DM message | `agent:{botId}:slack:channel:{dmChannelId}` | `agent:{botId}:main` |
| Slack DM thread | `agent:{botId}:slack:thread:{threadTs}` | `agent:{botId}:main:thread:{threadTs}` |
| Discord sync row | `agent:{botId}:discord:channel:{guildId}` | keep canonical lowercase key, but only when the upstream identifier is actually the target conversation identifier |

### Important constraint

OpenClaw supports non-default DM layouts (`per-peer`, `per-channel-peer`, `per-account-channel-peer`) and custom `mainKey`. Nexu cannot infer those from the current API surface. For this phase, Nexu aligns to the OpenClaw default DM behavior only:

- DM base session key: `agent:{botId}:main`
- Thread suffix: `:thread:{threadId}`
- All keys lowercase

If we later need full parity with per-bot OpenClaw config, that requires Nexu to read the bot's generated OpenClaw config or receive canonical session keys directly from the gateway.

### Required code changes

- `apps/api/src/routes/slack-events.ts`
  - Inspect `conversations.info` result already being fetched.
  - If `is_im=true`, write base key `agent:{botId}:main`.
  - If the DM event has `thread_ts`, append `:thread:{threadTs}`.
  - If `is_im=false`, keep channel base key `agent:{botId}:slack:channel:{channelId}` and append `:thread:{threadTs}` when present.
  - Normalize final key to lowercase before upsert.

- `apps/api/src/routes/session-routes.ts`
  - Keep lowercase normalization.
  - Stop describing the current Discord sync as “correct by construction” unless the source API provides the actual target conversation identifier.
  - For this plan, only fix the casing/canonicalization issue in Nexu storage. Any guild-vs-channel semantic correction must be backed by the actual upstream event source, not by relabeling guild IDs as channel IDs.

### Migration strategy

Canonicalize existing rows only when the old value can be transformed deterministically.

Safe rewrite set:

- Slack thread rows shaped like `agent:{botId}:slack:thread:{threadTs}` where Nexu also has `channel_type='slack'` and `channel_id` populated:
  - rewrite to either:
    - `agent:{botId}:main:thread:{threadTs}` for DM channels
    - `agent:{botId}:slack:channel:{channelId}:thread:{threadTs}` for non-DM channels
- Slack DM rows shaped like `agent:{botId}:slack:channel:{channelId}` where the channel is known to be a DM:
  - rewrite to `agent:{botId}:main`
- Any canonicalizable key with uppercase letters:
  - lowercase rewrite

Do not rewrite:

- Rows whose shape is malformed or not recognized
- Rows created only for tests or fixtures
- Rows where Nexu cannot tell whether the backing Slack channel was DM vs non-DM
- Rows that would require guessing OpenClaw non-default `dmScope` behavior

### Collision handling

Because `sessions.session_key` is unique, multiple legacy rows may collapse to one canonical key.

For every canonical target key:

1. Pick one survivor session row.
   - Prefer the row with the newest `last_message_at`.
   - Break ties by newest `updated_at`, then newest `created_at`.
2. Rewrite all `artifacts.session_key` values pointing at any merged legacy key to the survivor key.
3. Merge session counters into the survivor conservatively:
   - `message_count`: use max or summed value only if semantics are confirmed; default to max to avoid inflating counts.
   - `last_message_at`: max timestamp.
   - `title`: prefer the survivor title unless the survivor is empty.
4. Delete the redundant legacy `sessions` rows after artifact remap succeeds.

Malformed/test-only rows that do not map cleanly are left alone.

## Problem 2: Resolve artifact session keys server-side from structured context

### Current Nexu behavior

`apps/api/src/routes/artifact-routes.ts` stores `input.sessionKey` directly. There is currently no server-side resolution path. The caller must already know the exact OpenClaw/Nexu session key.

### Changes

- `packages/shared/src/schemas/artifact.ts`
  - add optional structured fields for server-side resolution
- `apps/api/src/routes/artifact-routes.ts`
  - resolve canonical session key from exact inputs before insert
  - keep `sessionKey` optional

### Proposed request shape

Add optional fields:

- `chatId?: string`
- `threadId?: string`

Meaning:

- `sessionKey` supplied and canonical-looking:
  - use it as-is after lowercase normalization
- `chatId` supplied without `threadId`:
  - resolve exact base session
- `chatId` supplied with `threadId`:
  - resolve exact thread session
- neither supplied:
  - preserve existing fallback to latest active session for that bot only if product wants that behavior

### Resolution rules

Deterministic, exact-match only. No `ILIKE '%...%'`.

1. `sessionKey` provided and starts with `agent:`
   - normalize to lowercase
   - store directly

2. `chatId` starts with `user:`
   - resolve DM base key to `agent:{botId}:main`
   - if `threadId` exists, append `:thread:{threadId}`

3. `chatId` starts with `channel:`
   - extract the concrete channel ID
   - normalize lowercase
   - look up `sessions` by exact structured columns:
     - `bot_id = {botId}`
     - `channel_id = {channelId}`
     - optionally `channel_type = {caller channelType}` if available
   - if `threadId` exists, target exact key `agent:{botId}:{provider}:channel:{channelId}:thread:{threadId}`
   - if multiple sessions match, fail the request as ambiguous

4. Invalid `sessionKey` that does not start with `agent:`
   - do not silently reinterpret arbitrary strings as session locators
   - either:
     - reject with 400, or
     - only allow fallback when structured fields are also present and unambiguous

5. Fallback with only `botId`
   - keep as an explicit product choice, not as silent heuristic recovery from malformed inputs
   - if retained, use latest active session for that bot exactly as today

### Why this is safer

- `sessions.session_key` is unique, but `artifacts.session_key` is not constrained.
- Exact structured lookup keeps artifact attachment deterministic.
- Thread routing becomes implementable because the API carries `threadId` explicitly.
- Malformed test data remains untouched because the resolver does not try to “fix” unknown strings.

## Verification Plan

### Problem 1: Session key alignment

1. **Slack channel message**
   - Send a Slack channel message.
   - Verify Nexu writes `agent:{botId}:slack:channel:{channelId}` in lowercase.

2. **Slack channel thread**
   - Reply inside a Slack channel thread.
   - Verify Nexu writes `agent:{botId}:slack:channel:{channelId}:thread:{threadTs}`.

3. **Slack DM**
   - Send a Slack DM to the bot.
   - Verify Nexu writes `agent:{botId}:main`.

4. **Slack DM thread**
   - Reply in a DM thread.
   - Verify Nexu writes `agent:{botId}:main:thread:{threadTs}`.

5. **Case normalization**
   - Verify all newly written session keys are lowercase.

6. **Migration collision**
   - Seed multiple legacy rows that collapse to the same canonical key.
   - Verify one survivor remains, artifacts are remapped to it, and malformed/test-only rows are untouched.

### Problem 2: Artifact resolution

7. **Direct canonical sessionKey**
   - POST artifact with `sessionKey: "agent:{botId}:slack:channel:c0ajkg60h6d"`.
   - Verify it is stored exactly after lowercase normalization.

8. **DM artifact via chatId**
   - POST with `chatId: "user:U0AHLMC6C8G"`.
   - Verify `artifacts.session_key = agent:{botId}:main`.

9. **Channel artifact via chatId**
   - POST with `chatId: "channel:C0AJKG60H6D"` and enough provider context to resolve the exact session row.
   - Verify the stored key matches the exact existing session.

10. **Thread artifact**
   - POST with `chatId: "channel:C0AJKG60H6D"` and `threadId`.
   - Verify stored key is the exact thread session key.

11. **Ambiguous lookup**
   - Create multiple candidate session rows for the same lookup input.
   - Verify API returns 400 instead of choosing one heuristically.

12. **Malformed/test-only input**
   - POST with `sessionKey: "slack-xxx:user:yyy"` and no structured context.
   - Verify API rejects or preserves existing fallback behavior explicitly; it must not silently rewrite the value to an unrelated active session.

13. **Fallback with botId only**
   - If fallback is retained, verify it still chooses the latest active session for that bot.

### Integration E2E

14. **Artifact/session join**
   - Trigger a real Slack flow that creates an artifact.
   - Verify `artifacts.session_key` matches an existing `sessions.session_key`.

15. **UI**
   - Verify artifacts appear under the intended session in Nexu UI.

## Implementation Notes

- Prefer exact rewrites over heuristic search.
- Canonicalize only recognized production-shaped keys.
- Leave malformed or test-only data alone.
- If full OpenClaw `dmScope` parity is required later, add a separate phase that imports canonical session-key config from the gateway instead of inferring it locally.
