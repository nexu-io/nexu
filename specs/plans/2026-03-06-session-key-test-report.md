# Session Key Alignment — Test Report

Date: 2026-03-06
Branch: `main` (uncommitted changes)
Plan: `specs/plans/2026-03-06-session-key-alignment-plan.md`

## Summary

| Category | Pass | Fail | Skip |
|----------|------|------|------|
| Typecheck | 1 | 0 | 0 |
| Unit tests (new) | 21 | 0 | 0 |
| Lint (changed files) | 1 | 0 | 0 |
| Pre-existing failures | — | 5 | — |

## Typecheck

```
pnpm --filter @nexu/api typecheck → PASS
```

No type errors in the API package.

## Unit Tests

### `src/routes/__tests__/artifact-routes.test.ts` — 17 tests, all pass

Covers verification plan items 7–13:

| # | Test | Plan Item | Result |
|---|------|-----------|--------|
| 1 | Direct canonical sessionKey stored after lowercase normalization | #7 | PASS |
| 2 | DM artifact via `chatId: "user:..."` resolves to `agent:{botId}:main` | #8 | PASS |
| 3 | Channel artifact via `chatId: "channel:..."` resolves to matching session | #9 | PASS |
| 4 | Thread artifact via `chatId` + `threadId` resolves to thread key | #10 | PASS |
| 5 | Ambiguous lookup returns 400 | #11 | PASS |
| 6 | Malformed sessionKey (non `agent:` prefix) rejected with 400 | #12 | PASS |
| 7 | Fallback with botId only (no sessionKey, no chatId) | #13 | PASS |
| 8–17 | Additional edge cases (empty chatId, empty channelId, etc.) | — | PASS |

### `src/routes/__tests__/slack-events.test.ts` — 4 tests, all pass

Covers verification plan items 1–5:

| # | Test | Plan Item | Result |
|---|------|-----------|--------|
| 1 | Slack channel message → `agent:{botId}:slack:channel:{channelId}` lowercase | #1 | PASS |
| 2 | Slack channel thread → `agent:{botId}:slack:channel:{channelId}:thread:{ts}` | #2 | PASS |
| 3 | Slack DM → `agent:{botId}:main` | #3 | PASS |
| 4 | Slack DM thread → `agent:{botId}:main:thread:{ts}` | #4 | PASS |

All keys are lowercase (plan item #5 implicitly covered by all tests).

## Lint

No lint errors in changed files:
- `apps/api/src/routes/artifact-routes.ts`
- `apps/api/src/routes/slack-events.ts`
- `apps/api/src/routes/session-routes.ts`
- `packages/shared/src/schemas/artifact.ts`
- `apps/api/src/routes/__tests__/artifact-routes.test.ts`
- `apps/api/src/routes/__tests__/slack-events.test.ts`

200 pre-existing lint errors are unrelated.

## Pre-existing Failures

5 failures in `src/lib/__tests__/config-generator.test.ts` — all expect `acme-bot` but get `bot-1`. These are pre-existing and unrelated to this change.

## Not Yet Verified (requires deployment)

| # | Plan Item | Status |
|---|-----------|--------|
| 6 | Migration collision handling | Needs prod migration script |
| 14 | Artifact/session join via real Slack flow | Needs deployment |
| 15 | UI verification | Needs deployment |

## Changed Files

| File | Change |
|------|--------|
| `apps/api/src/routes/slack-events.ts` | Export `buildSlackSessionKey()`, use `is_im` to route DMs to `agent:{botId}:main` |
| `apps/api/src/routes/artifact-routes.ts` | Add `resolveArtifactSessionKey()` — resolves from `chatId`/`threadId`, rejects non-`agent:` keys |
| `apps/api/src/routes/session-routes.ts` | Lowercase normalization |
| `packages/shared/src/schemas/artifact.ts` | Add optional `chatId` and `threadId` fields |
| `apps/api/src/routes/__tests__/artifact-routes.test.ts` | 17 tests for resolution logic |
| `apps/api/src/routes/__tests__/slack-events.test.ts` | 4 tests for key construction |
| `.nexu-dev/skills/static-deploy/scripts/session-search.sh` | Reverted to CommonJS (user edit) |
