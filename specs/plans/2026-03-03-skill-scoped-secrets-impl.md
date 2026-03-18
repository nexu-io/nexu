# Skill-Scoped Secrets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove god-mode secret access from the OpenClaw process and add per-skill scoped secret fetching via API.

**Architecture:** Strip `INTERNAL_API_TOKEN`/`ENCRYPTION_KEY` from OpenClaw child env, add `SKILL_API_TOKEN` as lower-privilege token, create `GET /api/internal/secrets/:skillName` endpoint with `scope` column on `pool_secrets` for per-skill filtering.

**Tech Stack:** Hono, Drizzle ORM, Zod, Node crypto (timingSafeEqual), Vitest

---

### Task 1: Add `SKILL_API_TOKEN` to gateway env schema

**Files:**
- Modify: `apps/gateway/src/env.ts:36-37`

**Step 1: Add SKILL_API_TOKEN to envSchema**

In `apps/gateway/src/env.ts`, add after `INTERNAL_API_TOKEN` line:

```typescript
SKILL_API_TOKEN: z.string().min(1).default("skill-secret-token"),
```

Also add `"SKILL_API_TOKEN"` to the `requiredEnvKeys` production check array (line 13):

```typescript
const requiredEnvKeys = [
  ...(nodeEnv === "production"
    ? ["INTERNAL_API_TOKEN", "SKILL_API_TOKEN", "RUNTIME_POOL_ID"]
    : []),
] as const;
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @nexu/gateway typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/gateway/src/env.ts
git commit -m "feat(gateway): add SKILL_API_TOKEN to env schema"
```

---

### Task 2: Strip privileged env from OpenClaw child process

**Files:**
- Modify: `apps/gateway/src/openclaw-process.ts:23-26`

**Step 1: Filter env before spawning**

Replace lines 23-26 in `openclaw-process.ts`:

```typescript
  // Old:
  const child = spawn(env.OPENCLAW_BIN, args, {
    stdio: "inherit",
    env: process.env,
  });
```

With:

```typescript
  const {
    INTERNAL_API_TOKEN: _internalToken,
    ENCRYPTION_KEY: _encryptionKey,
    ...safeEnv
  } = process.env;
  const child = spawn(env.OPENCLAW_BIN, args, {
    stdio: "inherit",
    env: { ...safeEnv, SKILL_API_TOKEN: env.SKILL_API_TOKEN },
  });
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @nexu/gateway typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/gateway/src/openclaw-process.ts
git commit -m "fix(gateway): strip INTERNAL_API_TOKEN and ENCRYPTION_KEY from OpenClaw child env"
```

---

### Task 3: Clean up nexu-context.json — remove secrets and internalToken

**Files:**
- Modify: `apps/gateway/src/config.ts:20-38,66,96`
- Modify: `apps/gateway/src/state.ts:18,33` (remove `lastSecretsHash`)

**Step 1: Rewrite `writeNexuContext` function**

Replace the function signature and body (lines 20-38):

```typescript
async function writeNexuContext(
  agentMeta: Record<string, { botId: string }> | undefined,
): Promise<void> {
  const stateDir = env.OPENCLAW_STATE_DIR;
  const contextPath = join(stateDir, "nexu-context.json");
  const context = {
    apiUrl: env.RUNTIME_API_BASE_URL,
    poolId: env.RUNTIME_POOL_ID,
    agents: agentMeta ?? {},
  };
  await mkdir(stateDir, { recursive: true });
  const tempPath = `${contextPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(context, null, 2), "utf8");
  await rename(tempPath, contextPath);
  await chmod(contextPath, 0o600);
}
```

**Step 2: Update callers**

Line 66 — change:
```typescript
await writeNexuContext(payload.agentMeta, payload.poolSecrets);
```
To:
```typescript
await writeNexuContext(payload.agentMeta);
```

Line 96 — change:
```typescript
await writeNexuContext(undefined, undefined);
```
To:
```typescript
await writeNexuContext(undefined);
```

**Step 3: Remove secretsHash tracking from pollLatestConfig**

Lines 51-52 — remove the `secretsChanged` check since we no longer track secrets in context. The `secretsHash` field can remain in the API response schema but the gateway ignores it now. Simplify the condition:

```typescript
  if (!configChanged) {
    return false;
  }

  const configJson = JSON.stringify(payload.config, null, 2);
  await atomicWriteConfig(configJson);
  state.lastConfigHash = payload.configHash;
  state.lastSeenVersion = payload.version;

  await writeNexuContext(payload.agentMeta);
```

Remove `state.lastSecretsHash` references.

**Step 4: Remove `lastSecretsHash` from RuntimeState**

In `apps/gateway/src/state.ts`, remove `lastSecretsHash: string;` from the `RuntimeState` interface (line 18) and remove `lastSecretsHash: "",` from `createRuntimeState()` (line 33).

**Step 5: Verify typecheck passes**

Run: `pnpm --filter @nexu/gateway typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/gateway/src/config.ts apps/gateway/src/state.ts
git commit -m "fix(gateway): remove secrets and internalToken from nexu-context.json"
```

---

### Task 4: Add `requireSkillToken` middleware + upgrade `requireInternalToken` to timingSafeEqual

**Files:**
- Modify: `apps/api/src/middleware/internal-auth.ts`

**Step 1: Write the updated middleware**

Replace entire file content:

```typescript
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { MiddlewareError } from "../lib/error.js";

function readToken(c: Context): string | null {
  const headerToken = c.req.header("x-internal-token");
  if (headerToken) {
    return headerToken;
  }

  const authHeader = c.req.header("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function safeCompare(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function requireInternalToken(c: Context): void {
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (!expectedToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "internal_token_not_configured",
      message: "INTERNAL_API_TOKEN is not configured",
    });
  }

  const actualToken = readToken(c);
  if (!actualToken || !safeCompare(actualToken, expectedToken)) {
    throw MiddlewareError.from("internal-auth", {
      code: "internal_token_invalid",
      message: "Unauthorized internal request",
    });
  }
}

export function requireSkillToken(c: Context): void {
  const skillToken = process.env.SKILL_API_TOKEN;
  if (!skillToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "skill_token_not_configured",
      message: "SKILL_API_TOKEN is not configured",
    });
  }

  const actualToken = readToken(c);
  if (!actualToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "skill_token_invalid",
      message: "Unauthorized skill request",
    });
  }

  // Accept either skill token or internal token
  const matchesSkill = safeCompare(actualToken, skillToken);
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const matchesInternal = internalToken
    ? safeCompare(actualToken, internalToken)
    : false;

  if (!matchesSkill && !matchesInternal) {
    throw MiddlewareError.from("internal-auth", {
      code: "skill_token_invalid",
      message: "Unauthorized skill request",
    });
  }
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/middleware/internal-auth.ts
git commit -m "feat(api): add requireSkillToken middleware + upgrade to timingSafeEqual"
```

---

### Task 5: Add `scope` column to `pool_secrets` table

**Files:**
- Modify: `apps/api/src/db/schema/index.ts:277-278`
- Modify: `apps/api/src/db/migrate.ts:296-308` (add DDL migration)

**Step 1: Add scope column**

After the `encryptedValue` field in `poolSecrets` (line 278), add:

```typescript
    scope: text("scope").notNull().default("pool"),
```

**Step 2: Add DDL migration to migrate.ts**

In `apps/api/src/db/migrate.ts`, after the pool_secrets CREATE TABLE block (line 308), add:

```typescript
  // Scope column for per-skill secret filtering
  await client.query(`
    ALTER TABLE pool_secrets ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'pool';
  `);
```

**Step 3: Push schema to database**

Run: `pnpm --filter @nexu/api db:push`
Expected: Prompts to add column, confirm with `y`

**Step 4: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/db/schema/index.ts apps/api/src/db/migrate.ts
git commit -m "feat(api): add scope column to pool_secrets table"
```

---

### Task 6: Update PUT /secrets to accept scope + update buildPoolSecrets

**Files:**
- Modify: `apps/api/src/routes/pool-routes.ts:181-211,293-330,153-179`

**Step 1: Update PUT schema to accept scope**

Replace the `putPoolSecretsRoute` schema body (lines 190-192):

```typescript
          schema: z.object({
            secrets: z.record(
              z.union([
                z.string(),
                z.object({
                  value: z.string(),
                  scope: z.string().default("pool"),
                }),
              ]),
            ),
          }),
```

**Step 2: Update PUT handler to write scope**

In the handler (lines 310-325), change the loop:

```typescript
    for (const [name, entry] of Object.entries(secrets)) {
      const value = typeof entry === "string" ? entry : entry.value;
      const scope = typeof entry === "string" ? "pool" : entry.scope;
      const encryptedValue = encrypt(value);
      await db
        .insert(poolSecrets)
        .values({
          id: createId(),
          poolId,
          secretName: name,
          encryptedValue,
          scope,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [poolSecrets.poolId, poolSecrets.secretName],
          set: { encryptedValue, scope, updatedAt: now },
        });
      count++;
    }
```

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/pool-routes.ts
git commit -m "feat(api): support scope in PUT /secrets endpoint"
```

---

### Task 7: Create secret fetch endpoint

**Files:**
- Create: `apps/api/src/routes/secret-routes.ts`

**Step 1: Write the route file**

```typescript
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq, or, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { poolSecrets } from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { requireSkillToken } from "../middleware/internal-auth.js";
import type { AppBindings } from "../types.js";

const skillNameParam = z.object({
  skillName: z.string().min(1).max(64),
});

const poolIdQuery = z.object({
  poolId: z.string().min(1),
});

const getSecretsRoute = createRoute({
  method: "get",
  path: "/api/internal/secrets/{skillName}",
  tags: ["Secrets (Internal)"],
  request: {
    params: skillNameParam,
    query: poolIdQuery,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.record(z.string()) },
      },
      description: "Scoped secrets for skill",
    },
    401: {
      content: {
        "application/json": { schema: z.object({ message: z.string() }) },
      },
      description: "Unauthorized",
    },
  },
});

export function registerSecretRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getSecretsRoute, async (c) => {
    requireSkillToken(c);
    const { skillName } = c.req.valid("param");
    const { poolId } = c.req.valid("query");

    const rows = await db
      .select({
        secretName: poolSecrets.secretName,
        encryptedValue: poolSecrets.encryptedValue,
        scope: poolSecrets.scope,
      })
      .from(poolSecrets)
      .where(
        and(
          eq(poolSecrets.poolId, poolId),
          or(
            eq(poolSecrets.scope, "pool"),
            eq(poolSecrets.scope, `skill:${skillName}`),
          ),
        ),
      );

    const secrets: Record<string, string> = {};
    for (const row of rows) {
      try {
        secrets[row.secretName] = decrypt(row.encryptedValue);
      } catch {
        // Skip secrets that fail to decrypt
      }
    }

    return c.json(secrets, 200);
  });
}
```

**Step 2: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/routes/secret-routes.ts
git commit -m "feat(api): add GET /api/internal/secrets/:skillName endpoint"
```

---

### Task 8: Switch artifact routes to requireSkillToken

**Files:**
- Modify: `apps/api/src/routes/artifact-routes.ts:15,109,164`

**Step 1: Update import**

Change line 15:
```typescript
import { requireInternalToken } from "../middleware/internal-auth.js";
```
To:
```typescript
import { requireSkillToken } from "../middleware/internal-auth.js";
```

**Step 2: Update handler calls**

Line 109 — change `requireInternalToken(c)` to `requireSkillToken(c)`
Line 164 — change `requireInternalToken(c)` to `requireSkillToken(c)`

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/artifact-routes.ts
git commit -m "fix(api): switch artifact internal routes to requireSkillToken"
```

---

### Task 9: Add requireInternalToken to session endpoints (fix auth gap)

**Files:**
- Modify: `apps/api/src/routes/session-routes.ts:18-19,108,183,232`

**Step 1: Add import**

Add after line 19:
```typescript
import { requireInternalToken } from "../middleware/internal-auth.js";
```

**Step 2: Add auth checks**

Line 108 (POST /sessions handler) — add as first line inside handler:
```typescript
    requireInternalToken(c);
```

Line 183 (PATCH /sessions/:id handler) — add as first line inside handler:
```typescript
    requireInternalToken(c);
```

Line 232 (POST /sessions/sync-discord handler) — add as first line inside handler:
```typescript
    requireInternalToken(c);
```

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/session-routes.ts
git commit -m "fix(api): add requireInternalToken to session internal endpoints"
```

---

### Task 10: Register secret routes in app.ts + add SKILL_API_TOKEN to API env

**Files:**
- Modify: `apps/api/src/app.ts:51-53`

**Step 1: Add import**

Add to imports:
```typescript
import { registerSecretRoutes } from "./routes/secret-routes.js";
```

**Step 2: Register route**

Add after `registerSessionInternalRoutes(app)` (line 52):
```typescript
  registerSecretRoutes(app);
```

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @nexu/api typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): register secret routes"
```

---

### Task 11: Fix artifact tests

**Files:**
- Modify: `apps/api/src/routes/__tests__/artifact-routes.test.ts:99`

**Step 1: Add SKILL_API_TOKEN env var**

In `beforeAll` (line 99), add:
```typescript
    process.env.SKILL_API_TOKEN = TOKEN;
```

So it becomes:
```typescript
  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.SKILL_API_TOKEN = TOKEN;
    setupPool = new pg.Pool({ connectionString: TEST_DB_URL });
    await createTables(setupPool);
  });
```

**Step 2: Run tests**

Run: `pnpm --filter @nexu/api test`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/routes/__tests__/artifact-routes.test.ts
git commit -m "fix(api): add SKILL_API_TOKEN to artifact test env"
```

---

### Task 12: Final verification

**Step 1: Generate types**

Run: `pnpm generate-types`
Expected: PASS

**Step 2: Typecheck all**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Lint all**

Run: `pnpm lint`
Expected: PASS (may need `pnpm format` first)

**Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS

**Step 5: Final commit if any format/lint fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```
