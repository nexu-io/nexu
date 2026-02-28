# Architecture

Nexu is an OpenClaw multi-tenant SaaS platform. One Gateway process serves many users' bots through config-driven routing.

## System diagram

```
Browser → Web (React + Ant Design + Vite)
            ↓
      API (Hono + Drizzle + Zod + better-auth)  ←→  PostgreSQL
            ↓
      Webhook Router → Gateway Pool Pods (OpenClaw) → Slack API
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| API framework | Hono + @hono/zod-openapi |
| Database | Drizzle ORM + PostgreSQL (no FK) |
| Validation | Zod (single source of truth) |
| Auth | better-auth (email/password + sessions) |
| Frontend | React + Ant Design + Vite |
| Frontend SDK | @hey-api/openapi-ts (auto-generated) |
| State | React Query (@tanstack/react-query) |
| Lint/Format | Biome |
| Package manager | pnpm workspaces |

## Type safety chain

Zod schema is the single source of truth. Types flow one-way, never duplicated:

```
Zod Schema (define once)
  → API route validation (@hono/zod-openapi)
  → OpenAPI spec (auto-generated)
  → Frontend SDK types (@hey-api/openapi-ts)
  → DB query types (Drizzle inference)
```

Never hand-write types that duplicate a schema. Use `z.infer<typeof schema>`.

## Monorepo layout

- **`apps/api/`** — Hono backend. Routes in `src/routes/`, DB schema in `src/db/schema/index.ts`, config generator in `src/lib/config-generator.ts`, auth in `src/auth.ts`.
- **`apps/web/`** — React frontend. Pages in `src/pages/`, generated SDK in `lib/api/`, auth client in `src/lib/auth-client.ts`.
- **`packages/shared/`** — Shared Zod schemas in `src/schemas/`. Includes bot, channel, gateway, invite, model, and OpenClaw config schemas.
- **`deploy/k8s/`** — Kubernetes manifests.
- **`docs/`** — Design docs, references, product specs, exec plans, generated artifacts.

## Key data flows

**Config generation:** API queries DB for active bots in a pool → decrypts channel credentials → assembles OpenClaw config JSON (agents, channels, bindings, models) → Gateway hot-reloads.

**Slack OAuth:** Frontend requests OAuth URL → user authorizes in Slack → callback exchanges code for token → credentials encrypted (AES-256-GCM) → stored in DB → webhook route created → pool config version bumped → Gateway reloads.

**Slack events:** Slack POST → `/api/slack/events` → extract `team_id` → lookup `webhookRoutes` → verify HMAC-SHA256 signature → forward to Gateway pod at `http://{podIp}:18789/slack/events/{accountId}`.

## Database

PostgreSQL with Drizzle ORM. No foreign keys — application-level joins only. All tables in `apps/api/src/db/schema/index.ts`.

Key tables: `bots`, `bot_channels`, `channel_credentials`, `gateway_pools`, `gateway_assignments`, `webhook_routes`, `oauth_states`, `invite_codes`, `users`, `usage_metrics`.

Public IDs via cuid2. Internal `pk` (serial auto-increment) never exposed to API.

## Config generator

`apps/api/src/lib/config-generator.ts` — Core module that builds OpenClaw config from DB state.

Critical constraints:
- `bindings[].agentId` must match `agents.list[].id`
- `bindings[].match.accountId` must match `channels.slack.accounts` key (NOT botToken)
- Slack HTTP mode requires `signingSecret`; `groupPolicy` must be `"open"`
- LiteLLM models must set `compat.supportsStore: false`
- Only one agent should have `default: true`

See `docs/references/openclaw-config-schema.md` for full schema and common pitfalls.

## Deeper docs

- `docs/design-docs/openclaw-multi-tenant.md` — Full system design, data model, phased plan
- `docs/design-docs/openclaw-architecture-internals.md` — OpenClaw runtime analysis
- `docs/design-docs/core-beliefs.md` — Engineering principles
