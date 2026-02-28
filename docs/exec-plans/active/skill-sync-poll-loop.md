# Skill Sync via Gateway Poll Loop

Related debug verification plan: `docs/exec-plans/active/skill-sync-debug-verification.md`

## Context

Nexu's gateway pod syncs OpenClaw config from the API using a poll loop every 2 seconds. Skills (`~/.openclaw/skills/<name>/SKILL.md`) are loaded from disk on every agent turn by OpenClaw, but there is currently **no mechanism to push skill files into a running pod**. This means updating the `static-deploy` skill (or any future skill) requires rebuilding/redeploying the pod image.

**Goal:** Mirror the config poll loop for skills — store skills in the DB, expose a versioned API endpoint, and have the gateway write skill files to disk when the snapshot changes.

---

## Architecture

```
Admin/API → PUT /api/internal/skills/:name  (upsert skill content)
                ↓
          skills + skills_snapshots tables
                ↓
GET /api/internal/skills/latest → { version, skillsHash, skills: {name: content} }
                ↓  (gateway polls every 2s)
    writeFile: OPENCLAW_SKILLS_DIR/<name>/SKILL.md
                ↓  (OpenClaw reads on every agent turn — no restart needed)
```

Skills are **global** (not pool-scoped) — one skill set for all pools. The endpoint does not take a `poolId` param for simplicity.

## Safety Constraints

1. Skill names must be strictly validated (e.g. `^[a-z0-9][a-z0-9-]{0,63}$`) to prevent path traversal and invalid directory names.
2. Skill file writes must be atomic (`write temp` + `rename`) to avoid partial reads by OpenClaw.
3. Disk state must be reconciled with snapshot state (remove stale skill folders/files not present in latest snapshot).
4. Snapshot version assignment must be concurrency-safe.

---

## Implementation Steps

### Step 1 — DB Schema
**File:** `apps/api/src/db/schema/index.ts`

Add two new tables:

```typescript
export const skills = pgTable("skills", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  name: text("name").notNull().unique(),     // "static-deploy"
  content: text("content").notNull(),        // SKILL.md text
  status: text("status").default("active"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const skillsSnapshots = pgTable("skills_snapshots", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  version: integer("version").notNull().unique(),
  skillsHash: text("skills_hash").notNull().unique(),  // SHA256 of skillsJson
  skillsJson: text("skills_json").notNull(),           // JSON: {name: content, ...}
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});
```

Run: `pnpm --filter @nexu/api db:push`

---

### Step 2 — Shared Zod Schema
**File:** `packages/shared/src/schemas/runtime-internal.ts`

Add:

```typescript
export const runtimeSkillsResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  skillsHash: z.string(),
  skills: z.record(z.string()),   // { "static-deploy": "# ..." }
  createdAt: z.string().datetime(),
});

export type RuntimeSkillsResponse = z.infer<typeof runtimeSkillsResponseSchema>;
```

---

### Step 3 — API Service
**New file:** `apps/api/src/services/runtime/skills-service.ts`

Pattern mirrors `pool-config-service.ts`:

- `toSkillsHash(skills: Record<string, string>): string` — SHA256 of `JSON.stringify(skills)` (keys sorted)
- `publishSkillsSnapshot(db): Promise<SnapshotRecord>` — fetch all active skills → sort by name → compute hash → check `skillsSnapshots` for existing hash → if same, return existing; otherwise insert new snapshot with concurrency-safe version allocation (transaction + unique retry, or DB sequence-backed version)
- `getLatestSkillsSnapshot(db): Promise<SnapshotRecord>` — get latest by version; if none, call `publishSkillsSnapshot`

---

### Step 4 — API Routes
**New file:** `apps/api/src/routes/skill-routes.ts`

Two routes using `createRoute` + `requireInternalToken` pattern:

```
GET  /api/internal/skills/latest
     → runtimeSkillsResponseSchema (200)
     → 401 if missing/invalid x-internal-token

PUT  /api/internal/skills/:name
     body: { content: string, status?: "active" | "inactive" }
     → upsert skill by name (validated slug); triggers publishSkillsSnapshot
     → { ok: true, name, version } (200)
     → 400 if name fails /^[a-z0-9][a-z0-9-]{0,63}$/ or body invalid
     → 401 if missing/invalid x-internal-token
```

**File:** `apps/api/src/app.ts`

Add before `app.use("/v1/*", authMiddleware)`:
```typescript
import { registerSkillRoutes } from "./routes/skill-routes.js";
registerSkillRoutes(app);
```

Run: `pnpm generate-types` and `pnpm typecheck`

---

### Step 5 — Gateway Env
**File:** `apps/gateway/src/env.ts`

Add to `envSchema`:
```typescript
OPENCLAW_SKILLS_DIR: z.string().min(1).optional(),
```

After `openclawStateDir` is resolved, derive:
```typescript
const openclawSkillsDir = normalizeConfigPath(
  parsedEnv.OPENCLAW_SKILLS_DIR ?? `${openclawStateDir}/skills`,
);
```

Export `env.OPENCLAW_SKILLS_DIR = openclawSkillsDir`.

---

### Step 6 — Gateway State
**File:** `apps/gateway/src/state.ts`

Add to `RuntimeState` interface:
```typescript
lastSkillsHash: string;
skillsSyncStatus: ConfigSyncStatus;  // reuse existing "active" | "degraded" type
```

Update `createRuntimeState()`:
```typescript
lastSkillsHash: "",
skillsSyncStatus: "active",
```

Add setter:
```typescript
export function setSkillsSyncStatus(state: RuntimeState, status: ConfigSyncStatus): void {
  state.skillsSyncStatus = status;
  updateRuntimeStatus(state);
}
```

Update `updateRuntimeStatus` to factor in `skillsSyncStatus` severity alongside `configSyncStatus` and `gatewayStatus`.

---

### Step 7 — Gateway skills.ts
**New file:** `apps/gateway/src/skills.ts`

```typescript
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeSkillsResponseSchema } from "@nexu/shared";
import { fetchJson } from "./api.js";
import { env } from "./env.js";
import { log } from "./log.js";
import type { RuntimeState } from "./state.js";
import { setSkillsSyncStatus } from "./state.js";

async function writeSkillFiles(skills: Record<string, string>): Promise<void> {
  await mkdir(env.OPENCLAW_SKILLS_DIR, { recursive: true });

  // Reconcile: remove local skills that are no longer in snapshot.
  const existing = await readdir(env.OPENCLAW_SKILLS_DIR, { withFileTypes: true });
  const incomingNames = new Set(Object.keys(skills));
  for (const entry of existing) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (!incomingNames.has(entry.name)) {
      await rm(join(env.OPENCLAW_SKILLS_DIR, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }

  for (const [name, content] of Object.entries(skills)) {
    // Defense in depth: validate name again before touching filesystem.
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
      throw new Error(`invalid skill name: ${name}`);
    }

    const dir = join(env.OPENCLAW_SKILLS_DIR, name);
    await mkdir(dir, { recursive: true });
    const target = join(dir, "SKILL.md");
    const temp = `${target}.tmp`;
    await writeFile(temp, content, "utf8");
    await rename(temp, target);
  }
}

export async function pollLatestSkills(state: RuntimeState): Promise<boolean> {
  const response = await fetchJson("/api/internal/skills/latest", { method: "GET" });
  const payload = runtimeSkillsResponseSchema.parse(response);
  if (payload.skillsHash === state.lastSkillsHash) {
    return false;
  }
  await writeSkillFiles(payload.skills);
  state.lastSkillsHash = payload.skillsHash;
  setSkillsSyncStatus(state, "active");
  log("applied new skills snapshot", { version: payload.version, hash: payload.skillsHash });
  return true;
}

// No state param — mirrors fetchInitialConfig exactly.
export async function fetchInitialSkills(): Promise<void> {
  const response = await fetchJson("/api/internal/skills/latest", { method: "GET" });
  const payload = runtimeSkillsResponseSchema.parse(response);
  await writeSkillFiles(payload.skills);
  log("initial skills synced", {
    event: "startup_skills_sync",
    status: "success",
    version: payload.version,
  });
}
```

### Step 8 — Gateway loops.ts
**File:** `apps/gateway/src/loops.ts`

Add import of `pollLatestSkills` from `./skills.js` and `setSkillsSyncStatus` from `./state.js`. Add:

```typescript
export async function runSkillsPollLoop(state: RuntimeState): Promise<never> {
  let backoffMs = env.RUNTIME_POLL_INTERVAL_MS;
  for (;;) {
    try {
      await pollLatestSkills(state);
      backoffMs = env.RUNTIME_POLL_INTERVAL_MS;
      const jitter = Math.floor(Math.random() * (env.RUNTIME_POLL_JITTER_MS + 1));
      await sleep(env.RUNTIME_POLL_INTERVAL_MS + jitter);
    } catch (error) {
      setSkillsSyncStatus(state, "degraded");
      log("skills poll failed", {
        error: error instanceof Error ? error.message : "unknown_error",
        retryInMs: backoffMs,
      });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, env.RUNTIME_MAX_BACKOFF_MS);
    }
  }
}
```

---

### Step 9 — Gateway bootstrap.ts
**File:** `apps/gateway/src/bootstrap.ts`

Add after `fetchInitialConfigWithRetry()` call:

```typescript
// No state param — mirrors fetchInitialConfigWithRetry exactly.
async function fetchInitialSkillsWithRetry(): Promise<void> {
  return runWithRetry(
    fetchInitialSkills,
    ({ attempt, retryDelayMs, error }) => {
      log("initial skills sync failed; retrying", {
        attempt,
        retryDelayMs,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    },
    env.RUNTIME_MAX_BACKOFF_MS,
  );
}
```

Append call inside `bootstrapGateway()` — **signature stays unchanged**:

```typescript
// ...existing bootstrap flow...
await fetchInitialConfigWithRetry();
await fetchInitialSkillsWithRetry();
```

---

### Step 10 — Gateway index.ts
**File:** `apps/gateway/src/index.ts`

Add import of `runSkillsPollLoop`. In `main()`, add `void runSkillsPollLoop(state)` before `await runPollLoop(state)`:

```typescript
await bootstrapGateway();       // signature unchanged
void runSkillsPollLoop(state);
await runPollLoop(state);
```

---

## Unit Tests

### API Route Tests
**New file:** `apps/api/src/routes/__tests__/skill-routes.test.ts`

Follow the exact pattern of `artifact-routes.test.ts`: `vi.mock("../../db/index.js", async () => {...})` with async factory, single `beforeAll` creates tables, `beforeEach` truncates, all tests use `app.request()`.

Internal auth setup for tests:

```typescript
beforeAll(() => {
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
});
```

Every internal route request must include:

```typescript
headers: {
  "content-type": "application/json",
  "x-internal-token": "test-internal-token",
}
```

Tables to create (minimal SQL in `createTables`):
```sql
DROP TABLE IF EXISTS skills_snapshots CASCADE;
DROP TABLE IF EXISTS skills CASCADE;
CREATE TABLE skills (
  pk SERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE skills_snapshots (
  pk SERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL UNIQUE,
  skills_hash TEXT NOT NULL UNIQUE,
  skills_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Test cases — `PUT /api/internal/skills/:name`:**

| # | Scenario | Expect |
|---|----------|--------|
| 1 | Valid name + content → first upsert | 200, `{ ok: true, name: "static-deploy", version: 1 }` |
| 2 | Same name, same content → idempotent upsert | 200, same version returned (hash collision → no new snapshot) |
| 3 | Same name, different content → update | 200, `version: 2` |
| 4 | Set `status: "inactive"` | 200, skill excluded from subsequent GET response |
| 5 | Invalid name `../escape` | 400 |
| 6 | Invalid name with uppercase `MySkill` | 400 |
| 7 | Missing `content` in body | 400 |
| 8 | Missing `x-internal-token` header | 401 |
| 9 | Invalid `x-internal-token` value | 401 |

**Test cases — `GET /api/internal/skills/latest`:**

| # | Scenario | Expect |
|---|----------|--------|
| 9 | No skills in DB | 200, `{ version: 1, skills: {}, skillsHash: "..." }` (empty snapshot) |
| 10 | One active skill | 200, `skills` contains that skill's name and content |
| 11 | One active + one inactive skill | 200, `skills` contains only the active one |
| 12 | Two consecutive GETs with no changes | Same version and hash on both responses |
| 13 | Missing `x-internal-token` header | 401 |

**Test cases — concurrency safety (`publishSkillsSnapshot` / route level):**

| # | Scenario | Expect |
|---|----------|--------|
| 14 | Two parallel updates with different content | No duplicate `version`, no unhandled unique error |
| 15 | Two parallel updates with same content | Same resulting `skillsHash`, idempotent snapshot semantics |

---

### Gateway skills.ts Tests
**New file:** `apps/gateway/src/__tests__/skills.test.ts`

Use `vi.mock("../api.js")` to stub `fetchJson`. Use `os.tmpdir()` + a unique subdirectory per test run as `OPENCLAW_SKILLS_DIR`. Override `env.OPENCLAW_SKILLS_DIR` in `beforeEach`.

Setup pattern:
```typescript
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js");
vi.mock("../env.js", () => ({ env: { OPENCLAW_SKILLS_DIR: "" } }));

import { env } from "../env.js";
import { fetchJson } from "../api.js";
import { pollLatestSkills, fetchInitialSkills } from "../skills.js";
import { createRuntimeState } from "../state.js";

let skillsDir: string;

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), "skills-test-"));
  (env as { OPENCLAW_SKILLS_DIR: string }).OPENCLAW_SKILLS_DIR = skillsDir;
  vi.mocked(fetchJson).mockReset();
});
```

**Test cases — `pollLatestSkills`:**

| # | Scenario | Expect |
|---|----------|--------|
| 1 | `skillsHash` matches `state.lastSkillsHash` | Returns `false`, no files written |
| 2 | New snapshot with one skill | Returns `true`, `SKILL.md` written to `<dir>/static-deploy/SKILL.md` |
| 3 | State updated after successful write | `state.lastSkillsHash` equals payload hash; `state.skillsSyncStatus === "active"` |
| 4 | Reconciliation: snapshot removes a skill | Old skill directory deleted, new skill file present |
| 5 | Invalid skill name in payload (defense in depth) | Throws `Error("invalid skill name: ...")` |

**Test cases — `fetchInitialSkills`:**

| # | Scenario | Expect |
|---|----------|--------|
| 6 | Happy path with multiple skills | All `SKILL.md` files written to disk |
| 7 | State not mutated | `state.lastSkillsHash` remains `""` after call (hash populated on first poll cycle) |

**Test cases — `writeSkillFiles` (atomic write):**

| # | Scenario | Expect |
|---|----------|--------|
| 8 | Write then read | File content matches what was passed in |
| 9 | No stale `.tmp` files left | After write, no `*.tmp` files exist in skill dir |

---

### Test Harness Prerequisite

`apps/gateway` currently has no test runner configuration. Before adding `skills.test.ts`, add:

1. `vitest` dev dependency in `apps/gateway/package.json`
2. `"test": "vitest run"` script in `apps/gateway/package.json`
3. Optional watch script: `"test:watch": "vitest"`

Use filtered commands in verification to avoid workspace-wide failure from packages without `test` script.

---

## Verification (Manual End-to-End)

Precondition:

```bash
export INTERNAL_API_TOKEN=<same-token-used-by-api-and-gateway>
```

1. **API smoke test** — insert a skill and confirm snapshot is created:
   ```bash
   curl -X PUT http://localhost:3000/api/internal/skills/static-deploy \
     -H "x-internal-token: $INTERNAL_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"content": "# Static Deploy\n..."}'

   curl http://localhost:3000/api/internal/skills/latest \
     -H "x-internal-token: $INTERNAL_API_TOKEN"
   ```

2. **Gateway sync** — start gateway locally; after 2s, verify:
   ```bash
   ls ~/.openclaw/skills/static-deploy/SKILL.md
   cat ~/.openclaw/skills/static-deploy/SKILL.md
   ```

3. **Update round-trip** — PUT updated content, wait 2s, cat the file again to confirm it updated.

4. **Delete reconciliation** — mark a skill inactive (or delete it), wait 2s, verify local folder is removed.

5. **Input validation** — call `PUT /api/internal/skills/../escape` and verify API rejects with `400`.

6. **No stale `.tmp` files** — check:
   ```bash
   find ~/.openclaw/skills -name "*.tmp"
   ```
   Expect no output.

7. **Typecheck + lint** — `pnpm --filter @nexu/api typecheck && pnpm --filter @nexu/gateway typecheck && pnpm lint`

8. **Run API tests** — `pnpm --filter @nexu/api test`

9. **Run gateway tests** (after adding gateway vitest setup) — `pnpm --filter @nexu/gateway test`

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `apps/api/src/db/schema/index.ts` |
| Modify | `packages/shared/src/schemas/runtime-internal.ts` |
| Create | `apps/api/src/services/runtime/skills-service.ts` |
| Create | `apps/api/src/routes/skill-routes.ts` |
| Modify | `apps/api/src/app.ts` |
| Modify | `apps/gateway/src/env.ts` |
| Modify | `apps/gateway/src/state.ts` |
| Create | `apps/gateway/src/skills.ts` |
| Modify | `apps/gateway/src/loops.ts` |
| Modify | `apps/gateway/src/bootstrap.ts` |
| Modify | `apps/gateway/src/index.ts` |
