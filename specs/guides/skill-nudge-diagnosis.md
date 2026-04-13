# Skill Nudge & Model Race Condition Diagnosis

> Date: 2026-04-10
> Branch: `refactor/openclaw-skills-watcher-nudge`
> Status: Fix applied (PATH + gateway restart); OAuth race identified, not yet fixed

## Problem Statement

Two related issues surfaced during desktop packaged app testing:

1. **Installed skills not visible to the agent** — skills installed via SkillHub don't appear in the agent's tool list until the app is restarted.
2. **"No model configured" after OAuth** — completing OpenAI OAuth shows no model options in the UI dropdown.

Both share a root pattern: the controller updates state correctly, but downstream consumers (OpenClaw gateway, UI) read stale data due to timing gaps.

---

## Issue 1: Skills Not Visible After Install

### Symptoms

- User installs a skill (e.g. `ontology`) via SkillHub UI.
- Controller logs confirm: install complete, config pushed (`configPushed: true`), nudge fired.
- Agent responds: "I don't see an ontology skill."

### Root Causes (3 layers)

#### Layer 1: Packaged app PATH too narrow

**Component:** `apps/desktop/main/services/launchd-bootstrap.ts`

The packaged Electron app launches without a shell profile, so `process.env.PATH` is the bare macOS default (`/usr/bin:/bin:/usr/sbin:/sbin`). This PATH is baked into the launchd plist for both controller and OpenClaw services.

OpenClaw filters skills at load time via `metadata.openclaw.requires.bins` — if a required binary isn't on PATH, the skill is excluded from `resolvedSkills`. Homebrew, NVM, pyenv binaries are all invisible.

**Affected skills:**

| Skill | Missing binary | Actually installed? |
|---|---|---|
| `obsidian` | `obsidian-cli` | No (not on machine) |
| `clawhub` | `clawhub` | No (bundled in app, not on PATH) |
| `libtv-video`, `medeo-video` | `python3` | Yes (`/opt/homebrew/bin/python3`) |
| `imap-smtp-email` | `node`, `npm` | Yes (NVM `~/.nvm/versions/node/v24.0.0/bin/`) |
| `nano-banana-one-shop` | `node` | Yes (NVM) |
| `find-skill` | No `requires.bins` | Different issue (see below) |
| `listenhub-ai` | No `requires.bins` | Different issue (see below) |

**Fix applied:** `resolveUserShellPath()` in `launchd-bootstrap.ts` — spawns the user's login shell (`$SHELL -ilc 'echo "$PATH"'`) at bootstrap to capture the full PATH. Falls back to `process.env.PATH` on error. No-op on Windows (GUI apps already inherit full PATH from registry).

**Verification:** After fix, `launchctl print` shows full PATH including `/opt/homebrew/bin`, NVM node path, etc. `imap-smtp-email` (requires `node`/`npm`) now resolves correctly.

#### Layer 2: Stale session skill snapshots

**Component:** `apps/controller/src/runtime/openclaw-watch-trigger.ts`

Each OpenClaw session stores a `skillsSnapshot` in `sessions.json`. When skills change, existing sessions keep their stale snapshot. The nudge mechanism touches `.controller-nudge` to bump `snapshotVersion`, but sessions only rebuild on the next agent turn.

**Fix applied (on this branch):** `nudgeSkillsWatcher()` now:
1. Walks every agent's `sessions.json`
2. Strips `skillsSnapshot` from all session entries
3. Then touches the `.controller-nudge` marker with explicit `utimes()` (APFS mtime workaround)

#### Layer 3: OpenClaw doesn't hot-reload agent skill allowlist

**Component:** OpenClaw's config hot-reload (`[reload]` in openclaw.log)

This is the critical finding. When the controller pushes a new `openclaw.json` with an updated `agents.list[].skills` array:

1. OpenClaw detects the config change: `[reload] config change detected; evaluating reload (agents.list)` ✓
2. OpenClaw does NOT apply it — no `[reload] config hot reload applied` line follows ✗

OpenClaw treats `agents.list` skill changes as kind `"none"` (no hot-reload action). The agent's skill filter remains the stale in-memory version until the process restarts.

**Evidence:**
```
# Runtime config (openclaw.json) — 35 skills, includes ontology:
Agent: nexu Assistant → skills: [..., "ontology"]

# Session snapshot — 34 skills, ontology missing:
skillFilter: ["obsidian", "playwright-skill", ...] // no ontology

# OpenClaw log — detected but not applied:
[reload] config change detected; evaluating reload (agents.list)
// NO "config hot reload applied" line
```

**Fix applied:** `nudgeSkillsWatcher()` now restarts the OpenClaw gateway after invalidating sessions. Handles both modes:
- Orchestrator mode: `processManager.stop()` → `enableAutoRestart()` → `start()`
- Launchd mode: `launchctl kickstart -k gui/{uid}/{label}`

### Complete nudge pipeline after fixes

```
Skill install/uninstall
  → controller doSync() with configPushed: true
    → nudgeSkillsWatcher(reason)
      1. invalidateSessionSkillSnapshots()  — clear stale snapshots
      2. touch .controller-nudge marker     — bump snapshotVersion
      3. restartGateway(reason)             — force config re-read
    → next message rebuilds snapshot with correct skill list
```

### Data flow diagram

```
Controller                           OpenClaw Gateway
─────────                           ────────────────

compiled-openclaw.json
  agents.list[0].skills = [35]
        │
        ▼
openclaw.json (runtime config)
  agents.list[0].skills = [35]
        │                            Process restart (new)
        ▼                                    │
                                             ▼
                                    Read config from disk
                                    agents.list[0].skills = [35]
                                             │
                                             ▼
                                    Session build (per chat):
                                      skillFilter = [35] (from config)
                                             │
                                             ▼
                                      For each skill in skillFilter:
                                        - SKILL.md exists on disk?
                                        - evaluateRuntimeEligibility()
                                          - requires.bins on PATH?
                                          - requires.env set?
                                             │
                                             ▼
                                      resolvedSkills = [N] (passed checks)
                                      Stored as skillsSnapshot
```

### Key terminology

| Concept | Owner | Meaning |
|---|---|---|
| **skillFilter** (allowlist) | OpenClaw (from config) | "These N skills are assigned to this agent" |
| **resolvedSkills** | OpenClaw (runtime check) | "Of those N, these M actually work right now" |
| **snapshotVersion** | OpenClaw | Counter — when bumped, sessions rebuild their snapshot |
| **nudge** | Controller | Touch `.controller-nudge` to trigger snapshotVersion bump |

---

## Issue 2: "No Model Configured" After OAuth

### Symptoms

- User completes OpenAI OAuth flow in browser.
- UI model dropdown shows "No model configured" with green dot (connected).
- After waiting ~3+ seconds or refreshing, models appear.

### Root Cause: Settling Mode Blocks Sync

**Component:** `apps/controller/src/services/openclaw-sync-service.ts`

The controller enters a 3-second "settling" period during bootstrap to prevent restart-looping during initial setup. During this window, all `syncAll()` calls are deferred.

**Timeline:**

```
T0      Controller bootstrap starts
T0+100  syncAllImmediate() writes initial config (no OAuth data yet)
T0+150  beginSettling() → settling=true, SETTLING_MS=3000
T0+~ms  User completes OpenAI OAuth in browser
T0+~ms  OAuth callback: writes auth-profiles.json ✓
T0+~ms  upsertProvider() saves models to NexuConfig (DB) ✓
T0+~ms  syncAll() called → DEFERRED (settling active) ✗
T0+~ms  UI queries GET /api/v1/models → sees no configured model ✗
  ...
T0+3150 Settling ends → deferred sync fires → config updated
T0+3200 Models now visible (too late if UI already rendered)
```

**Code path:**

| File | Lines | Role |
|---|---|---|
| `apps/controller/src/app/bootstrap.ts` | 47 | `beginSettling()` enters 3s window |
| `apps/controller/src/routes/provider-oauth-routes.ts` | 75-82 | OAuth status handler calls `upsertProvider()` + `syncAll()` |
| `apps/controller/src/services/openclaw-sync-service.ts` | 185-192 | `syncAll()` deferred if settling active |
| `apps/controller/src/services/openclaw-sync-service.ts` | 157-178 | Settling ends → deferred sync finally fires |

### Proposed Fix (not yet applied)

Use `syncAllImmediate()` in the OAuth status route instead of `syncAll()`. OAuth completion is a user-initiated critical path, not a rapid-fire event. It should bypass settling.

```typescript
// provider-oauth-routes.ts:81
// Before:
await container.openclawSyncService.syncAll();
// After:
await container.openclawSyncService.syncAllImmediate();
```

---

## Files Changed (this branch)

| File | Change |
|---|---|
| `apps/desktop/main/services/launchd-bootstrap.ts` | Added `resolveUserShellPath()` for full user PATH |
| `apps/controller/src/runtime/openclaw-watch-trigger.ts` | Added gateway restart to nudge; session invalidation |
| `apps/controller/src/app/container.ts` | Wire `setProcessManager()` on watch trigger |
| `apps/controller/src/services/openclaw-sync-service.ts` | Use `nudgeSkillsWatcher()` instead of `touchAnySkillMarker()` |

## Open Items

- [ ] OAuth race fix (use `syncAllImmediate()` in provider-oauth-routes.ts)
- [ ] Verify `find-skill` and `listenhub-ai` filtering (no `requires.bins` declared — may be filtered by other gates)
- [ ] `obsidian` and `clawhub` remain filtered because the binaries genuinely aren't installed — expected behavior
- [ ] Smoke test the full install → nudge → gateway restart → session rebuild flow in packaged app
