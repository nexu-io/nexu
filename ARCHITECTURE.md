# Architecture

Nexu uses a controller-first local runtime model. In desktop/local mode, a single `apps/controller` process owns Nexu config, compiles OpenClaw config, materializes skills/templates, and orchestrates the OpenClaw runtime.

## System diagram

```
Desktop Shell / Browser
        ↓
Web (React + Ant Design + Vite)
        ↓
Controller (Hono + Zod OpenAPI + lowdb-backed local store)
        ↓
OpenClaw Runtime → Slack / Discord / Feishu API
```

## Tech stack

| Layer                    | Technology                                  |
| ------------------------ | ------------------------------------------- |
| Local control plane      | Hono + @hono/zod-openapi                    |
| Local persistence        | lowdb + JSON config under `~/.nexu/`        |
| Validation               | Zod (single source of truth)                |
| Local auth compatibility | Controller-managed local auth/session shims |
| Frontend                 | React + Ant Design + Vite                   |
| Frontend SDK             | @hey-api/openapi-ts (auto-generated)        |
| State                    | React Query (@tanstack/react-query)         |
| Lint/Format              | Biome                                       |
| Package manager          | pnpm workspaces                             |

## Type safety chain

Zod schema is the single source of truth. Types flow one-way, never duplicated:

```
Zod Schema (define once)
  → API route validation (@hono/zod-openapi)
  → OpenAPI spec (auto-generated)
  → Frontend SDK types (@hey-api/openapi-ts)
  → local store/runtime types
```

Never hand-write types that duplicate a schema. Use `z.infer<typeof schema>`.

## Monorepo layout

- **`apps/controller/`** — Single-user controller service. Routes in `src/routes/`, local config store in `src/store/`, OpenClaw runtime integration in `src/runtime/`, compiler logic in `src/lib/openclaw-config-compiler.ts`.
- **`apps/web/`** — React frontend. Pages in `src/pages/`, generated SDK in `lib/api/`, auth client in `src/lib/auth-client.ts`.
- **`apps/desktop/`** — Electron desktop runtime shell and sidecar orchestrator. The active local path launches `controller + web + openclaw` sidecars only.
- **`packages/shared/`** — Shared Zod schemas in `src/schemas/`. Includes bot, channel, gateway, invite, model, skill, and OpenClaw config schemas.
- **`nexu-skills/`** — Public skill repository. Each skill is a directory with `SKILL.md` frontmatter. `skills.json` is the built catalog index.
- **`specs/`** — Design docs, references, product specs, exec plans, generated artifacts.

## Key data flows

**Desktop/local config generation:** Controller reads `~/.nexu/config.json` → compiles OpenClaw config JSON (agents, channels, bindings, models) → writes `OPENCLAW_CONFIG_PATH` and managed skills/templates → OpenClaw hot-reloads.

**Desktop runtime boot:** Electron desktop starts the controller sidecar, waits for controller readiness/auth bootstrap, starts the web sidecar, and delegates OpenClaw process management to `apps/controller`.

**Channel connection flows:** Frontend calls controller routes → controller validates and stores local credentials/config → controller recompiles OpenClaw config → runtime writers materialize the updated state → OpenClaw reloads.

**Slack events:** Slack messages are handled through the current controller-compiled OpenClaw runtime path rather than a separate Nexu gateway sidecar.

**Feishu events:** Feishu uses a long-lived runtime connection driven by the controller-compiled OpenClaw config.

**Skill catalog:** Skills are file-based. The controller scans `nexu-skills/skills/` for `SKILL.md` frontmatter and serves install/uninstall/catalog flows. The local runtime watches the managed skills directory for hot-reload.

## Persistence

The active local/controller path persists Nexu-owned state under `~/.nexu/` via controller store modules, with `config.json` as the main source of truth and OpenClaw runtime files living under `OPENCLAW_STATE_DIR`.

## Config generator

`apps/controller/src/lib/openclaw-config-compiler.ts` — Active controller-first module that builds OpenClaw config from Nexu local state.

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
