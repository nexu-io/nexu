# Composio Pipeline Remediation Plan

## Goal

Fix the current Composio skill pipeline issues discovered in review:

1. Shared `composio-exec.js` picks an arbitrary bot from the pool context.
2. Partial fetch failures can remove skills from the next published snapshot.
3. Composio skills can fail during sidecar bootstrap because `nexu-context.json` starts with empty `agents`.
4. Seeded SKILL.md files currently expose a low-signal alphabetical subset of actions.

This document is implementation guidance only. No code changes are included here.

## Problem Summary

### 1. Wrong bot routing in shared executor

`apps/api/src/scripts/composio-exec.js` currently resolves `botId` by taking the first entry from `nexu-context.json.agents`.

That is unsafe in a multi-bot pool because the skill execution becomes dependent on object entry order rather than the bot/workspace that invoked the skill.

### 2. Fetch failure can silently remove skills

`fetch-composio-actions.ts` writes `actions: []` when a toolkit fetch fails.
`seed-composio-skills.ts` then skips those toolkits and still publishes a fresh snapshot.

This means a transient Composio/API problem can cause a previously working skill to disappear from the active snapshot.

### 3. Bootstrap race on initial context

`apps/gateway/src/config.ts` writes an initial `nexu-context.json` with empty `agents` until the first poll cycle completes.

During that window, `composio-exec.js` cannot resolve a bot and exits immediately.

### 4. Current action curation is low-signal

The fetch script currently loads Composio actions without curation.
The cached JSON shows many toolkits capped at 20 actions and biased toward alphabetical/admin operations.
The seed script then renders the cached list directly into SKILL.md.

## Proposed Solution

## A. Make bot resolution explicit and per-workspace

### Desired outcome

Each Composio skill invocation must execute against the exact bot that owns the current workspace/session.

### Implementation direction

Prefer one of these approaches, in order:

1. Put the active `botId` directly into each bot workspace context and read it from `composio-exec.js`.
2. If workspace-level context already exists elsewhere, pass `botId` into the executor environment from the runtime and treat it as required.
3. Only keep `agents` as fallback metadata for diagnostics, not as the primary runtime source of truth.

### Concrete changes

- Update gateway/sidecar context writing so each workspace-visible context includes a single authoritative `botId`.
- Update `apps/api/src/scripts/composio-exec.js` to read that explicit `botId`.
- Remove the current "first entry from agents map" behavior.
- Fail with a clear error if the explicit `botId` is missing.

### Acceptance criteria

- In a pool with multiple active bots, the same Composio skill invoked from bot A always sends bot A's id.
- Invocation from bot B always sends bot B's id.
- Behavior does not depend on object key order in `agents`.

## B. Preserve last known-good action data on partial fetch failure

### Desired outcome

A failed toolkit fetch must not remove an already-working skill from the next published snapshot.

### Implementation direction

Treat the cached JSON as last known-good data and only overwrite a toolkit's actions when a fresh fetch succeeds with a valid result.

### Concrete changes

- Load the existing `apps/api/src/scripts/data/composio-actions.json` before fetch begins, if it exists.
- For each toolkit:
  - If fetch succeeds with valid actions, replace that toolkit entry.
  - If fetch returns no usable data or throws, retain the previous cached entry if one exists.
  - Only write an empty action list for a toolkit that has never had cached data and is genuinely unsupported.
- Emit a clear summary of:
  - updated toolkits
  - preserved toolkits
  - failed toolkits
- Add a strict mode or non-zero exit when fetch quality drops below an expected threshold.

### Acceptance criteria

- A single toolkit fetch failure does not reduce the number of seeded Composio skills when prior cached data exists.
- Snapshot publication cannot silently remove a skill because of one transient upstream failure.

## C. Remove the bootstrap race for `nexu-context.json`

### Desired outcome

Composio skills should work immediately after sidecar startup, without waiting for a later poll cycle.

### Implementation direction

The initial context written during bootstrap must already contain enough data for skills to resolve the current bot.

### Concrete changes

- Extend the initial config/bootstrap path so it can write an authoritative bot identifier into workspace-visible context immediately.
- Do not rely on a later poll to fill in required runtime fields for skill execution.
- If the architecture cannot provide full per-bot metadata on initial bootstrap, block Composio skill execution with an explicit transient-state error rather than a generic missing-bot failure.

### Acceptance criteria

- Immediately after gateway startup, a Composio skill can resolve its `botId` without waiting for a subsequent config poll.
- If the system is still initializing, the error is explicit and retryable.

## D. Curate action lists without increasing prompt bloat

### Desired outcome

Generated SKILL.md files should contain a compact, high-signal action list that improves action selection rather than merely changing which 20 actions are shown.

### Implementation direction

Use Composio's `important: true` support, but add safety rails.

### Concrete changes

- Update `fetch-composio-actions.ts` to try:
  - `important: true`
  - higher fetch limit only for discovery, not for final prompt size
- If `important: true` fails or returns unusable results:
  - fall back to unfiltered fetch
  - preserve previous cache if the fallback is also poor
- Store additional metadata such as `tags` if useful for future ranking.
- Add a final render cap in `seed-composio-skills.ts` so SKILL.md stays compact even if fetch returns many actions.
- Prefer ranking logic such as:
  - `important: true` results first
  - then common CRUD/user-facing verbs
  - then hard cap to a prompt-safe count per toolkit

### Acceptance criteria

- Gmail/Google Calendar/Slack skills show common user-facing actions near the top.
- SKILL.md size does not grow materially beyond the current budget.
- Execution still works for valid Composio actions not listed in the curated table.

## Verification Plan

## 1. Bot routing verification

Set up a pool with at least two active bots and different Composio integration states.

Checks:

1. Invoke the same Composio skill from bot A.
2. Verify the internal execute request carries bot A's id.
3. Invoke the same skill from bot B.
4. Verify the internal execute request carries bot B's id.
5. Repeat after reordering the `agents` object or adding/removing a third bot.

Expected result:

- Routing remains stable and always matches the invoking bot.

## 2. Partial fetch failure verification

Simulate one toolkit failing during `fetch-composio-actions`.

Checks:

1. Start with a known-good cached JSON.
2. Force one toolkit fetch to throw or return invalid data.
3. Run fetch.
4. Confirm that toolkit's previous cached actions remain intact.
5. Run seed.
6. Confirm the corresponding skill is still present and active after snapshot publication.

Expected result:

- No skill disappears because of a single fetch failure.

## 3. Bootstrap verification

Check behavior immediately after sidecar/gateway restart.

Checks:

1. Restart the runtime.
2. Invoke a Composio skill before the first poll cycle completes.
3. Confirm bot resolution succeeds, or a clear retryable initialization error is returned.

Expected result:

- No generic "No botId found" failure during normal startup.

## 4. Action curation verification

Checks:

1. Run fetch with the new curation logic.
2. Inspect cached action data for representative toolkits:
   - gmail
   - googlecalendar
   - slack
   - github
3. Run seed.
4. Inspect generated SKILL.md content in DB/files payload.
5. Confirm common actions are visible and low-level admin noise is reduced.
6. Confirm action table length stays within the chosen cap.

Expected result:

- Higher-signal actions are listed.
- Prompt size remains bounded.

## 5. Regression verification

Checks:

1. Run API tests covering Composio routes.
2. Run any executor/unit tests added for bot resolution.
3. Validate that `executeAction()` still works with an action slug not present in the curated SKILL.md.
4. Confirm OAuth handoff still returns `connectUrl` correctly for disconnected integrations.

Expected result:

- Curation changes do not break execution, auth handoff, or route behavior.

## Recommended Test Additions

Add automated coverage for:

- `composio-exec.js` bot resolution with multi-bot context
- startup context behavior with missing vs present `botId`
- fetch cache preservation on toolkit-level failure
- seed output cap and ordering for representative toolkits
- execution of valid but non-listed action slugs

## Suggested Execution Order

1. Fix explicit bot resolution first.
2. Fix bootstrap context so the runtime source of truth is available immediately.
3. Add cache-preservation logic to fetch/seed.
4. Add action curation and final render cap.
5. Run the verification plan above.

## Deliverable Definition

This remediation is complete when:

- Composio execution is bound to the correct bot in multi-bot pools.
- Startup no longer produces missing-bot failures for Composio skills.
- Transient fetch failures do not remove existing skills from published snapshots.
- Curated SKILL.md action tables become more useful without becoming larger and noisier.
