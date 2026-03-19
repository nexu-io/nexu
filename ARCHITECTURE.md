# Architecture

Nexu is transitioning from a multi-tenant SaaS control plane to a controller-first local runtime model. In desktop/local mode, a single `apps/controller` process owns Nexu config, compiles OpenClaw config, materializes skills/templates, and orchestrates the OpenClaw runtime.

## System diagram

```
Browser → Web (React + Ant Design + Vite)
            ↓
      API (Hono + Drizzle + Zod + better-auth)  ←→  PostgreSQL
            ↓
      Webhook Router → Gateway Pool Pods (OpenClaw) → Slack / Discord / Feishu API
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

- **`apps/api/`** — Legacy Hono backend for the old multi-tenant SaaS path.
- **`apps/controller/`** — Single-user controller service. Routes in `src/routes/`, local config store in `src/store/`, OpenClaw runtime integration in `src/runtime/`, compiler logic in `src/lib/openclaw-config-compiler.ts`.
- **`apps/web/`** — React frontend. Pages in `src/pages/`, generated SDK in `lib/api/`, auth client in `src/lib/auth-client.ts`.
- **`apps/desktop/`** — Electron desktop runtime shell and sidecar orchestrator.
- **`apps/gateway/`** — Legacy gateway sidecar package from the SaaS runtime path.
- **`packages/shared/`** — Shared Zod schemas in `src/schemas/`. Includes bot, channel, gateway, invite, model, skill, and OpenClaw config schemas.
- **`nexu-skills/`** — Public skill repository. Each skill is a directory with `SKILL.md` frontmatter. `skills.json` is the built catalog index.
- **`deploy/k8s/`** — Kubernetes manifests.
- **`specs/`** — Design docs, references, product specs, exec plans, generated artifacts.

## Key data flows

**Desktop/local config generation:** Controller reads `~/.nexu/config.json` → compiles OpenClaw config JSON (agents, channels, bindings, models) → writes `OPENCLAW_CONFIG_PATH` and managed skills/templates → OpenClaw hot-reloads.

**Slack OAuth:** Frontend requests OAuth URL → user authorizes in Slack → callback exchanges code for token → credentials encrypted (AES-256-GCM) → stored in DB → webhook route created → pool config version bumped → Gateway reloads.

**Slack events:** Slack POST → `/api/slack/events` → extract `team_id` → lookup `webhookRoutes` → verify HMAC-SHA256 signature → forward to Gateway pod at `http://{podIp}:18789/slack/events/{accountId}`.

**Feishu events:** Feishu uses WebSocket long-connection (not webhooks). Gateway's Feishu plugin opens a persistent connection to Feishu's event service using App ID + App Secret from config. Messages arrive directly at the Gateway — no public endpoint needed.

**Skill catalog:** Skills are file-based. The API scans `nexu-skills/skills/` for `SKILL.md` frontmatter and merges with a remote GitHub catalog (`skills.json`). Skills can be installed/uninstalled via filesystem routes. The Gateway watches the skills directory for hot-reload.

## Database

PostgreSQL with Drizzle ORM. No foreign keys — application-level joins only. All tables in `apps/api/src/db/schema/index.ts`.

Key tables: `bots`, `bot_channels`, `channel_credentials`, `gateway_pools`, `gateway_assignments`, `webhook_routes`, `oauth_states`, `invite_codes`, `users`, `usage_metrics`, `pool_config_snapshots`, `skills`, `skills_snapshots`, `artifacts`, `pool_secrets`, `sessions`, `supported_toolkits`, `user_integrations`, `integration_credentials`, `supported_skills`.

Public IDs via cuid2. Internal `pk` (serial auto-increment) never exposed to API.

## Config generator

`apps/api/src/lib/config-generator.ts` — Core module that builds OpenClaw config from DB state.

Critical constraints:
- `bindings[].agentId` must match `agents.list[].id`
- `bindings[].match.accountId` must match `channels.{slack|feishu}.accounts` key
- Slack HTTP mode requires `signingSecret`; `groupPolicy` must be `"open"`
- LiteLLM models must set `compat.supportsStore: false`
- Only one agent should have `default: true`

See `specs/references/openclaw-config-schema.md` for full schema and common pitfalls.

## Deeper docs

- `specs/designs/openclaw-multi-tenant.md` — Full system design, data model, phased plan
- `specs/designs/openclaw-architecture-internals.md` — OpenClaw runtime analysis
- `specs/design-specs/core-beliefs.md` — Engineering principles
