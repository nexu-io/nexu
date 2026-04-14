# OAuth Model Race Condition Diagnosis

> Date: 2026-04-10
> Branch: `refactor/openclaw-skills-watcher-nudge`
> Status: Root cause identified, fix not yet applied

## Problem Statement

After completing OpenAI OAuth flow in the desktop app, the UI model dropdown shows "No model configured" (with a green connected dot). Models appear after ~3+ seconds or a manual refresh.

## Symptoms

1. User clicks "Connect OpenAI" → browser OAuth flow completes successfully
2. UI returns to the model selector
3. Model dropdown shows "No model configured" despite OAuth being complete
4. Green dot indicates the provider connection is active
5. After waiting or refreshing, GPT models appear correctly

## Root Cause: Settling Mode Blocks Post-OAuth Sync

### Background: Settling Mode

The controller enters a 3-second "settling" period during bootstrap (`SETTLING_MS = 3000`) to prevent OpenClaw restart-looping when multiple config changes fire in rapid succession (cloud connect, model selection, bot creation, etc.).

During this window, **all `syncAll()` calls are deferred** — queued but not executed until settling ends.

### The Race

```
T0      Controller bootstrap starts
T0+100  syncAllImmediate() → writes initial config (no OAuth data)
T0+150  beginSettling() → settling=true for 3 seconds
          ┌─────────────────────────────────────────────┐
          │         SETTLING WINDOW (3 seconds)         │
          │                                             │
T0+~ms   │  User completes OpenAI OAuth in browser     │
T0+~ms   │  OAuth callback:                            │
T0+~ms   │    1. mergeOAuthProfile() → writes           │
T0+~ms   │       auth-profiles.json ✓                   │
T0+~ms   │    2. upsertProvider() → saves models        │
T0+~ms   │       to NexuConfig (DB) ✓                   │
T0+~ms   │    3. syncAll() → DEFERRED ✗                 │
T0+~ms   │                                             │
T0+~ms   │  UI queries GET /api/v1/models               │
T0+~ms   │    → config not yet synced to OpenClaw       │
T0+~ms   │    → "No model configured" ✗                 │
          │                                             │
          └─────────────────────────────────────────────┘
T0+3150 Settling ends → deferred sync fires → config updated
T0+3200 Models now visible (too late — UI already rendered empty)
```

### Why Settling Affects This

The OAuth status handler at `provider-oauth-routes.ts:75-82` calls `syncAll()` after saving the provider. But `syncAll()` checks settling state first:

```typescript
// openclaw-sync-service.ts:185-192
async syncAll(): Promise<{ configPushed: boolean }> {
  if (this.settling) {
    this.settlingDirty = true;
    logger.debug({}, "syncAll deferred (settling mode)");
    return new Promise((resolve, reject) => {
      this.settlingResolvers.push({ resolve, reject });
    });
  }
  // ... actual sync logic
}
```

The promise resolves when settling ends, but the caller (`provider-oauth-routes.ts`) awaits it — meaning the HTTP response is also delayed. However, the UI may have already rendered the model selector from a separate query before this resolves.

## Code Path

| Step | File | Lines | What happens |
|---|---|---|---|
| Bootstrap settling | `apps/controller/src/app/bootstrap.ts` | 47 | `beginSettling()` — 3s window |
| OAuth callback | `apps/controller/src/services/openclaw-auth-service.ts` | 330-430 | Exchange code, write auth-profiles.json |
| OAuth status poll | `apps/controller/src/routes/provider-oauth-routes.ts` | 63-87 | Frontend polls status, triggers upsert + sync |
| upsertProvider | `apps/controller/src/routes/provider-oauth-routes.ts` | 75-80 | Save models to DB config |
| syncAll (deferred) | `apps/controller/src/services/openclaw-sync-service.ts` | 185-192 | Queued, not executed |
| Settling flush | `apps/controller/src/services/openclaw-sync-service.ts` | 157-178 | Fires after 3s, runs deferred sync |
| Model list query | `apps/controller/src/services/model-provider-service.ts` | 369-420 | Reads from config — stale if sync hasn't run |

## Proposed Fix

Use `syncAllImmediate()` in the OAuth status route to bypass settling:

```typescript
// apps/controller/src/routes/provider-oauth-routes.ts:81
// Before:
await container.openclawSyncService.syncAll();

// After:
await container.openclawSyncService.syncAllImmediate();
```

### Why this is safe

- OAuth completion is a **user-initiated, one-time critical path** — not a rapid-fire event that settling protects against.
- `syncAllImmediate()` already exists and is used during bootstrap (`bootstrap.ts:42`).
- The settling guard exists to prevent restart-looping from rapid cloud-connect / model-selection / bot-creation cascades. OAuth completion is a single discrete event that should not be deferred.

### Alternative approaches considered

| Approach | Verdict |
|---|---|
| UI retry/poll after OAuth | Works but adds latency and complexity to the frontend |
| Shorten settling window | Risky — could re-introduce the restart-looping that settling prevents |
| Exempt specific sync reasons | Over-engineered — `syncAllImmediate()` already exists for this purpose |

## Verification Plan

1. Apply fix (one-line change in `provider-oauth-routes.ts`)
2. Build unsigned package
3. Clean state: `rm -rf ~/.nexu/runtime/ ~/Library/Application\ Support/@nexu/desktop/`
4. Launch app, complete OpenAI OAuth
5. Verify model dropdown shows GPT models immediately (no "No model configured" flash)
6. Check controller log for `doSync` firing immediately after OAuth (not deferred)
