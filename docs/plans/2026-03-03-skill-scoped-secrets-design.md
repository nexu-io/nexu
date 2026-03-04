# Skill-Scoped Secrets & Token Separation

**Date:** 2026-03-03
**Status:** Draft
**Author:** Colin + Claude

## Problem

The OpenClaw process (AI model runtime) currently has god-mode access:

1. **`INTERNAL_API_TOKEN` in env** — the model can run `echo $INTERNAL_API_TOKEN` and use it to call any privileged internal endpoint (config, skill sync, secret management).
2. **All pool secrets on disk** — `nexu-context.json` contains a flat `secrets` dict with every secret in the pool, visible to every skill.
3. **`ENCRYPTION_KEY` in env** — inherited from the gateway process, could theoretically decrypt DB values.
4. **Session endpoints unauthenticated** — `POST/PATCH /sessions` have no auth check.

## Threat Model

**Honest-model guardrails.** We assume the model follows instructions. The goal is to remove secrets from obvious places (env, disk, context file) so the model won't accidentally leak them. Skills request only their own secrets via API at runtime.

This is NOT full sandboxing — the model runs with `security: "full"`, `ask: "off"` and could theoretically read process memory. That's an acceptable tradeoff for now.

## Design

### Layer 1: Strip Privileged Access from OpenClaw Process

**`apps/gateway/src/openclaw-process.ts`** — Filter env before spawning:

```typescript
const { INTERNAL_API_TOKEN, ENCRYPTION_KEY, ...safeEnv } = process.env;
const child = spawn(env.OPENCLAW_BIN, args, {
  stdio: "inherit",
  env: { ...safeEnv, SKILL_API_TOKEN: env.SKILL_API_TOKEN },
});
```

**`apps/gateway/src/env.ts`** — Add:

```typescript
SKILL_API_TOKEN: z.string().min(1).default("skill-secret-token"),
```

**`apps/gateway/src/config.ts`** — Rewrite `writeNexuContext`:

```typescript
const context = {
  apiUrl: env.RUNTIME_API_BASE_URL,
  poolId: env.RUNTIME_POOL_ID,
  agents: agentMeta ?? {},
};
```

Remove `poolSecrets` parameter. Remove `secrets`, `internalToken`, and `skillToken` from context.
Skills read `SKILL_API_TOKEN` from env (`$SKILL_API_TOKEN`), not from nexu-context.json.
Update callers to drop the `poolSecrets` argument.

### Layer 2: Per-Skill Secret Scoping

**`apps/api/src/db/schema/index.ts`** — Add `scope` column to `pool_secrets`:

```typescript
scope: text("scope").notNull().default("pool"),
```

Scope values:
- `"pool"` — accessible by any skill in the pool (backwards compatible)
- `"skill:{name}"` — only accessible by the named skill (e.g. `"skill:deploy-page"`)

**`apps/api/src/routes/pool-routes.ts`** — Update `PUT /secrets` to accept scope:

```typescript
// Body: { secrets: { "CF_API_TOKEN": { value: "...", scope: "skill:deploy-page" } } }
// Backwards compatible: plain string value defaults to scope "pool"
```

### Layer 3: Runtime Secret Fetch Endpoint

**New file: `apps/api/src/routes/secret-routes.ts`**

```
GET /api/internal/secrets/:skillName?poolId={poolId}
Auth: requireSkillToken
```

Logic:
1. Validate skill token
2. Query: `pool_secrets WHERE pool_id = ? AND (scope = 'pool' OR scope = 'skill:{skillName}')`
3. Decrypt each value
4. Return `{ "CF_API_TOKEN": "...", "CF_ZONE_ID": "..." }`

**Skill usage (in SKILL.md):**

```bash
CTX=$(cat ../nexu-context.json)
API_URL=$(echo $CTX | jq -r .apiUrl)
POOL_ID=$(echo $CTX | jq -r .poolId)
SECRETS=$(curl -s -H "Authorization: Bearer $SKILL_API_TOKEN" \
  "$API_URL/api/internal/secrets/static-deploy?poolId=$POOL_ID")
CF_TOKEN=$(echo $SECRETS | jq -r .CF_API_TOKEN)
```

Skills read `$SKILL_API_TOKEN` from env (injected by gateway into OpenClaw process env).

### Layer 4: Auth Middleware

**`apps/api/src/middleware/internal-auth.ts`**

Add `requireSkillToken(c)`:
- Reads token from `x-internal-token` header or `Authorization: Bearer` header
- Validates against `process.env.SKILL_API_TOKEN` using `crypto.timingSafeEqual`

Upgrade existing `requireInternalToken` to use `timingSafeEqual` (fixes timing side-channel).

### Layer 5: Endpoint Protection Matrix

| Endpoint | Auth | Caller |
|----------|------|--------|
| **Skill-accessible (requireSkillToken):** | | |
| `GET /api/internal/secrets/:skillName` | skillToken | Skills at runtime |
| `POST /api/internal/artifacts` | skillToken | Skills |
| `PATCH /api/internal/artifacts/{id}` | skillToken | Skills |
| **Privileged (requireInternalToken):** | | |
| `GET /config`, `/config/latest`, `/config/versions/{v}` | internalToken | Gateway sidecar |
| `POST /register`, `/heartbeat` | internalToken | Gateway sidecar |
| `PUT /pools/{id}/secrets` | internalToken | Gateway sidecar / admin |
| `GET/PUT /skills/*` | internalToken | Gateway sidecar |
| `POST /sessions` | internalToken | Gateway sidecar |
| `PATCH /sessions/{id}` | internalToken | Gateway sidecar |
| `POST /sessions/sync-discord` | internalToken | Gateway sidecar |

Session endpoints are currently unauthenticated — this design fixes that gap.

## Security Model

```
┌───────────────────────────────────────────────────────┐
│  OpenClaw Process (AI model runtime)                   │
│  ENV: SKILL_API_TOKEN ✓  INTERNAL_API_TOKEN ✗          │
│  nexu-context.json: { apiUrl, poolId, agents }         │
│  NO secrets on disk                                    │
└──────────────────┬────────────────────────────────────┘
                   │ $SKILL_API_TOKEN (from env)
                   ▼
┌───────────────────────────────────────────────────────┐
│  GET /api/internal/secrets/static-deploy?poolId=...    │
│  → Returns only: pool-scoped + skill:static-deploy     │
│  → { "CF_API_TOKEN": "...", "CF_ZONE_ID": "..." }     │
│  → Skill calls CF API directly                         │
└───────────────────────────────────────────────────────┘
```

## Known Weaknesses (accepted for v1)

1. Model can `echo $SKILL_API_TOKEN` — the shared token is in env
2. Model can call `/secrets/{otherSkillName}` — fetch another skill's secrets
3. No proof of caller identity — any skill can impersonate another

**Future hardening (each layer additive):**
- v2: Per-skill tokens (token = skill identity, no skill name in URL)
- v3: Session binding (API resolves skill from active session, no token needed)
- v4: Broker sidecar (separate container, model never sees any token)

## File Changes

| File | Action | What |
|------|--------|------|
| `apps/gateway/src/openclaw-process.ts` | Modify | Strip privileged env vars from child process |
| `apps/gateway/src/env.ts` | Modify | Add `SKILL_API_TOKEN` |
| `apps/gateway/src/config.ts` | Modify | Write `skillToken`, remove `secrets`/`internalToken` |
| `apps/api/src/middleware/internal-auth.ts` | Modify | Add `requireSkillToken`, upgrade to `timingSafeEqual` |
| `apps/api/src/db/schema/index.ts` | Modify | Add `scope` column to `pool_secrets` |
| `packages/shared/src/schemas/runtime-internal.ts` | Modify | Add scope to secret schema |
| `apps/api/src/routes/pool-routes.ts` | Modify | Support `scope` in PUT secrets |
| `apps/api/src/routes/secret-routes.ts` | **Create** | `GET /api/internal/secrets/:skillName` |
| `apps/api/src/routes/artifact-routes.ts` | Modify | Switch to `requireSkillToken` |
| `apps/api/src/routes/session-routes.ts` | Modify | Add `requireInternalToken` (fix auth gap) |
| `apps/api/src/app.ts` | Modify | Register secret routes |
| `apps/api/src/routes/__tests__/artifact-routes.test.ts` | Modify | Add `SKILL_API_TOKEN` env var |

## What This Does NOT Include

- **No CF action broker** — skills call external APIs directly with fetched secrets. A broker can be added later as an additive change for specific high-risk operations.
- **No per-pool skill tokens** — single shared `SKILL_API_TOKEN` for now. Per-pool tokens (e.g. JWT with poolId claim) are a future enhancement.
- **No secret rotation** — secrets are updated via PUT endpoint. Automated rotation is out of scope.

## Verification

```bash
pnpm --filter @nexu/api db:push    # Apply scope column
pnpm generate-types                 # Regenerate frontend SDK
pnpm typecheck
pnpm lint
pnpm test
```

Manual checks:
1. `nexu-context.json` contains `skillToken` (not `internalToken`), no `secrets` field
2. In OpenClaw session: `echo $INTERNAL_API_TOKEN` → empty
3. `GET /secrets/deploy-page` with skillToken → returns only scoped secrets
4. `GET /secrets/deploy-page` with wrong token → 401
5. `PUT /pools/{id}/secrets` with skillToken → 401 (blocked)
6. `GET /config/latest` with skillToken → 401 (blocked)
7. `POST /sessions` without token → 401 (newly protected)
