# Skill Hot-Reload: Debug Verification Plan

Verification methodology: `/debug-mode` — hypothesis-driven, evidence first.

---

## Context

This plan verifies the `skill-sync-poll-loop` implementation end-to-end against a live
environment: Nexu API on `:3000`, Nexu Gateway connecting to it, and OpenClaw running
at `localhost:18789`.

**The behavior being proved:**

```
PUT /api/internal/skills/:name
  → DB snapshot created with new hash
    → Gateway poll (≤2.3s) detects hash change
      → SKILL.md written atomically to ~/.openclaw/skills/<name>/
        → OpenClaw reads updated file on next agent turn (no restart)
```

---

## Task List

- [ ] Set up environment (Nexu API, debug server, gateway)
- [ ] Seed initial skill via API
- [ ] Instrument gateway `skills.ts` and API `skills-service.ts`
- [ ] Verify Phase 1 — startup sync (initial write + first poll no-op)
- [ ] Verify Phase 2 — hot-reload (content update detected and written within 2s)
- [ ] Verify Phase 3 — OpenClaw reads updated skill on next agent turn
- [ ] Verify Phase 4 — reconciliation (removed skill deleted from disk)
- [ ] Analyze logs and evaluate all hypotheses
- [ ] Cleanup instrumentation and debug server

---

## Hypotheses

```
H1: API creates a new snapshot with a new hash when skill content changes,
    and returns the same version when content is unchanged (idempotent).

H2: Gateway detects the hash change within one poll cycle (≤ POLL_INTERVAL + JITTER = 2.3s)
    and calls writeSkillFiles exactly once.

H3: fetchInitialSkills sets state.lastSkillsHash so the immediately following
    poll cycle returns false (no redundant disk write on startup).

H4: writeSkillFiles writes each SKILL.md atomically (temp file → rename) with no
    observable .tmp file left on disk.

H5: OpenClaw at localhost:18789 reads the updated SKILL.md on the next agent turn
    without requiring a process restart.

H6: When a skill is removed from the snapshot (status set to inactive), the gateway
    deletes its directory from OPENCLAW_SKILLS_DIR within one poll cycle.
```

---

## Environment Setup

### Step 1 — Start debug server

```bash
cd /Users/alche/Documents/digit-sutando/nexu

mkdir -p .debug-mode && cp ~/.claude/debug-mode/server.js .debug-mode/server.js
grep -qxF '.debug-mode/' .gitignore 2>/dev/null || echo '.debug-mode/' >> .gitignore
node .debug-mode/server.js 9742 &
curl -s http://localhost:9742/health   # → "ok"
```

### Step 2 — Start Nexu API

In a dedicated terminal:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
export INTERNAL_API_TOKEN=local-debug-token
pnpm --filter @nexu/api dev
# Verify: curl -s http://localhost:3000/health → {"status":"ok"}
```

Use the same token value for all internal API calls in this plan.

### Step 3 — Start Nexu Gateway (dev mode, pointing to local API)

In a dedicated terminal:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
RUNTIME_API_BASE_URL=http://localhost:3000 \
INTERNAL_API_TOKEN=local-debug-token \
RUNTIME_POOL_ID=local-debug \
OPENCLAW_STATE_DIR=~/.openclaw \
  pnpm --filter @nexu/gateway dev
```

> `OPENCLAW_STATE_DIR=~/.openclaw` ensures the gateway writes skills to the same
> `~/.openclaw/skills/` directory that OpenClaw at port 18789 reads from.

Environment is ready when gateway log shows:
```
pool registered { poolId: 'local-debug' }
initial skills synced { event: 'startup_skills_sync', status: 'success', version: 1 }
```

---

## Instrumentation

Add the following `fetch()` calls **before running any phases**. Track both files for cleanup.
These calls are intentionally fire-and-forget (`.catch(()=>{})`) and may arrive slightly out of order.
Evaluate by event presence + timestamps, not strict line order.

### `apps/gateway/src/skills.ts`

```typescript
// --- DEBUG INSTRUMENTATION (remove after verification) ---
// pollLatestSkills — after schema parse, before hash compare
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H2", location:"pollLatestSkills:hash-check",
    message:"comparing hashes",
    data:{ incoming: payload.skillsHash, stored: state.lastSkillsHash,
           willWrite: payload.skillsHash !== state.lastSkillsHash }
  })
}).catch(()=>{});

// pollLatestSkills — if hash matches, before returning false
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H3", location:"pollLatestSkills:noop",
    message:"hash unchanged, skipping write",
    data:{ hash: payload.skillsHash }
  })
}).catch(()=>{});

// pollLatestSkills — after writeSkillFiles succeeds
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H2", location:"pollLatestSkills:written",
    message:"skills written to disk",
    data:{ version: payload.version, skillNames: Object.keys(payload.skills),
           writtenAt: new Date().toISOString() }
  })
}).catch(()=>{});

// fetchInitialSkills — after state.lastSkillsHash is set
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H3", location:"fetchInitialSkills:state-set",
    message:"initial hash stored in state",
    data:{ hash: payload.skillsHash, version: payload.version,
           skillNames: Object.keys(payload.skills) }
  })
}).catch(()=>{});

// writeSkillFiles — inside reconciliation loop, before rm
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H6", location:"writeSkillFiles:reconcile",
    message:"removing stale skill directory",
    data:{ name: entry.name }
  })
}).catch(()=>{});

// writeSkillFiles — after rename (atomic write complete), inside for-of loop
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H4", location:"writeSkillFiles:atomic-write",
    message:"SKILL.md written atomically",
    data:{ name, target, tempUsed: temp }
  })
}).catch(()=>{});
// --- END DEBUG INSTRUMENTATION ---
```

### `apps/api/src/services/runtime/skills-service.ts`

```typescript
// --- DEBUG INSTRUMENTATION (remove after verification) ---
// publishSkillsSnapshot — after hash is computed
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H1", location:"publishSkillsSnapshot:hash-computed",
    message:"skills hash computed",
    data:{ hash: configHash, skillCount: Object.keys(skillsMap).length }
  })
}).catch(()=>{});

// publishSkillsSnapshot — hash collision path (existing reused)
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H1", location:"publishSkillsSnapshot:hash-hit",
    message:"snapshot already exists for this hash — returning existing",
    data:{ existingVersion: existingByHash.version, hash: configHash }
  })
}).catch(()=>{});

// publishSkillsSnapshot — new snapshot inserted
fetch("http://localhost:9742/debug", { method:"POST",
  headers:{"Content-Type":"application/json"},
  body: JSON.stringify({
    hypothesisId:"H1", location:"publishSkillsSnapshot:new-snapshot",
    message:"new snapshot created",
    data:{ version: nextVersion, hash: configHash }
  })
}).catch(()=>{});
// --- END DEBUG INSTRUMENTATION ---
```

---

## Verification Phases

### Phase 1 — Startup Sync (H3 + H4)

**Goal:** Prove `fetchInitialSkills` sets state hash so the first poll is a no-op.

```bash
# Clear any existing log
> .debug-mode/debug.log

# Seed one skill before gateway starts (or restart gateway with one skill already in DB)
curl -s -X PUT http://localhost:3000/api/internal/skills/static-deploy \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Static Deploy\nInitial content."}'

# (Re)start gateway — watch logs for startup_skills_sync message, then wait 3s
# Read debug log
cat .debug-mode/debug.log
```

**Expected log sequence:**
```
[T+0.0s] [H3] fetchInitialSkills:state-set | initial hash stored in state | {"hash":"<hash-A>","version":1,"skillNames":["static-deploy"]}
[T+0.0s] [H4] writeSkillFiles:atomic-write  | SKILL.md written atomically  | {"name":"static-deploy","target":"~/.openclaw/skills/static-deploy/SKILL.md"}
[T+2.Xs] [H2] pollLatestSkills:hash-check   | comparing hashes             | {"incoming":"<hash-A>","stored":"<hash-A>","willWrite":false}
[T+2.Xs] [H3] pollLatestSkills:noop         | hash unchanged, skipping write
```

**H3 confirmed** if: `hash-check` shows `incoming === stored` and no `pollLatestSkills:written` follows.
**H4 confirmed** if: `atomic-write` appears and `find ~/.openclaw/skills -name "*.tmp"` returns empty.

---

### Phase 2 — Hot-Reload (H1 + H2 + H4)

**Goal:** Prove API creates new snapshot and gateway writes updated file within 2.3s.

```bash
# Clear log
> .debug-mode/debug.log

# Record the current time
node -e 'console.log("PUT sent at:", new Date().toISOString())'

# Update skill content
curl -s -X PUT http://localhost:3000/api/internal/skills/static-deploy \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Static Deploy v2\nUpdated content — hot-reload test."}'

# Wait 3s, then read logs
sleep 3 && cat .debug-mode/debug.log
```

**Expected log sequence:**
```
# API side (from publishSkillsSnapshot)
[H1] publishSkillsSnapshot:hash-computed   | skills hash computed       | {"hash":"<hash-B>","skillCount":1}
[H1] publishSkillsSnapshot:new-snapshot    | new snapshot created       | {"version":2,"hash":"<hash-B>"}

# Gateway side (within 2.3s of PUT)
[H2] pollLatestSkills:hash-check           | comparing hashes           | {"incoming":"<hash-B>","stored":"<hash-A>","willWrite":true}
[H2] pollLatestSkills:written              | skills written to disk     | {"version":2,"skillNames":["static-deploy"],"writtenAt":"<timestamp>"}
[H4] writeSkillFiles:atomic-write          | SKILL.md written atomically | {"name":"static-deploy",...}
```

**Timing check:**
```bash
# Extract PUT time and written time from logs, compare delta
grep "pollLatestSkills:written" .debug-mode/debug.log
# writtenAt timestamp minus PUT timestamp should be ≤ 2300ms
```

**H1 confirmed** if: `hash-computed` shows new hash, `new-snapshot` shows version 2.
**H2 confirmed** if: `pollLatestSkills:written` appears within 2.3s of PUT, `willWrite: true`.
**H4 confirmed** if: `atomic-write` appears, no `.tmp` files on disk.

**Idempotency check for H1 — PUT same content again:**
```bash
> .debug-mode/debug.log
curl -s -X PUT http://localhost:3000/api/internal/skills/static-deploy \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Static Deploy v2\nUpdated content — hot-reload test."}'
sleep 1 && cat .debug-mode/debug.log
```
Must see `publishSkillsSnapshot:hash-hit` (version unchanged), no `pollLatestSkills:written`.

---

### Phase 3 — OpenClaw Reads Updated Skill (H5)

**Goal:** Prove OpenClaw at `:18789` uses the updated `SKILL.md` on the next agent turn without restart.

```bash
# Confirm the file was written
cat ~/.openclaw/skills/static-deploy/SKILL.md
# Should contain "Static Deploy v2" from Phase 2

# Verify file timestamp is recent (within last 10s)
stat ~/.openclaw/skills/static-deploy/SKILL.md | grep Modify
```

**Send an agent turn to OpenClaw at :18789 using your known-good local interface:**

Do not assume a fixed route like `/api/gateway/route`. First verify which request path
your local OpenClaw runtime accepts (from your existing local runbook or OpenClaw logs),
then send a turn through that exact interface.

Example (only if your local OpenClaw exposes OpenAI-compatible chat completions):

```bash
curl -s -X POST http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [
      { "role": "user", "content": "What is your static-deploy skill capable of?" }
    ]
  }'
```

**H5 confirmed** if: Agent response references content from the updated `SKILL.md` (e.g., "Static Deploy v2" or whatever distinguishing content was inserted), without having restarted OpenClaw.

The key evidence is that file content written in Phase 2 is reflected in the next agent response without restart.

---

### Phase 4 — Reconciliation (H6)

**Goal:** Prove gateway removes a skill directory when that skill is no longer in the snapshot.

```bash
# Add a second skill so we can remove it
curl -s -X PUT http://localhost:3000/api/internal/skills/temp-skill \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Temp Skill\nThis will be deleted."}'

sleep 3
ls ~/.openclaw/skills/   # should show both static-deploy and temp-skill

# Clear log, then mark temp-skill inactive
> .debug-mode/debug.log

# Contract preflight: confirm route supports status updates.
curl -s -X PUT http://localhost:3000/api/internal/skills/temp-skill \
  -H "x-internal-token: $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Temp Skill","status":"inactive"}'

# If this returns 400 due to route schema, use the DB fallback below once:
# psql "$DATABASE_URL" -c "UPDATE skills SET status='inactive', updated_at=NOW()::text WHERE name='temp-skill';"

sleep 3
cat .debug-mode/debug.log
ls ~/.openclaw/skills/   # should show only static-deploy
```

**Expected log:**
```
[H6] writeSkillFiles:reconcile | removing stale skill directory | {"name":"temp-skill"}
[H2] pollLatestSkills:written  | skills written to disk         | {"version":4,"skillNames":["static-deploy"]}
```

**H6 confirmed** if: `reconcile` log appears for `temp-skill` and `ls ~/.openclaw/skills/` no longer shows it.

---

## Hypothesis Evaluation Table

Fill in after running all phases:

| Hypothesis | Status | Evidence |
|------------|--------|----------|
| H1: API creates new snapshot on content change, reuses on same content | — | |
| H2: Gateway detects change within 2.3s, writes once | — | |
| H3: fetchInitialSkills prevents redundant write on first poll | — | |
| H4: writeSkillFiles uses atomic temp+rename, no .tmp artifacts | — | |
| H5: OpenClaw reads updated skill on next agent turn (no restart) | — | |
| H6: Removed skill directory is deleted within one poll cycle | — | |

---

## Cleanup

After all phases are complete and hypotheses evaluated:

```bash
# 1. Remove all fetch("http://localhost:9742/debug"...) calls from:
#    - apps/gateway/src/skills.ts
#    - apps/api/src/services/runtime/skills-service.ts

# 2. Stop debug server
pkill -f ".debug-mode/server.js" 2>/dev/null

# 3. Remove debug directory
rm -rf .debug-mode/

# 4. Revert .gitignore debug entry (if added during setup)
sed -i.bak '/^\.debug-mode\/$/d' .gitignore && rm -f .gitignore.bak

# 5. Verify no .tmp files left
find ~/.openclaw/skills -name "*.tmp"   # expect no output

# 6. Run typecheck to confirm instrumentation removal is clean
pnpm --filter @nexu/api typecheck
pnpm --filter @nexu/gateway typecheck
```

---

## Quick Reference

| Service | URL | Start command |
|---------|-----|---------------|
| Nexu API | `http://localhost:3000` | `pnpm --filter @nexu/api dev` |
| Nexu Gateway | — | `pnpm --filter @nexu/gateway dev` |
| Debug server | `http://localhost:9742` | `node .debug-mode/server.js 9742 &` |
| OpenClaw | `http://localhost:18789` | already running |
| Skills dir | `~/.openclaw/skills/` | written by gateway |
