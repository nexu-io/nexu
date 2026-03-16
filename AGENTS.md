# AGENTS.md

This file is for agentic coding tools. It's a map — read linked docs for depth.

## Repo overview

Nexu is an OpenClaw multi-tenant platform. Users create AI bots, connect them to Slack, and the system generates OpenClaw config that hot-loads into shared Gateway processes.

- Monorepo: pnpm workspaces
- `apps/api` — Hono + Drizzle + Zod OpenAPI (Node ESM)
- `apps/chat` — Next.js session-chat surface for local OpenClaw probing
- `apps/desktop` — Electron desktop runtime shell and sidecar orchestrator
- `apps/gateway` — Nexu gateway sidecar for config/skills sync, runtime probing, and optional OpenClaw process management
- `apps/web` — React + Ant Design + Vite
- `openclaw-runtime` — Repo-local packaged OpenClaw runtime for local dev and desktop packaging; replaces global `openclaw` CLI
- `packages/shared` — Shared Zod schemas
- `deploy/k8s` — Kubernetes manifests

## Project overview

Nexu is an OpenClaw multi-tenant SaaS platform. Users create AI bots via a dashboard and connect them to Slack. The system dynamically generates OpenClaw configuration and hot-loads it into shared Gateway processes. One Gateway process serves 50+ bots across multiple users through OpenClaw's native multi-agent + multi-account + bindings routing.

## Commands

All commands use pnpm. Target a single app with `pnpm --filter <package>`.

```bash
pnpm install                          # Install
pnpm dev                              # All apps (API :3000, Web :5173)
pnpm desktop:start                    # Build and launch the desktop local runtime stack
pnpm desktop:stop                     # Stop the desktop local runtime stack
pnpm desktop:restart                  # Restart the desktop local runtime stack
pnpm desktop:status                   # Show desktop local runtime status
pnpm --filter @nexu/api dev           # API only
pnpm --filter @nexu/web dev           # Web only
pnpm build                            # Build all
pnpm check:esm-imports                # Scan built dist for extensionless relative ESM specifiers
pnpm typecheck                        # Typecheck all
pnpm lint                             # Biome lint
pnpm format                           # Biome format
pnpm test                             # Vitest
pnpm --filter @nexu/api test          # API tests only
pnpm db:generate                      # Generate Drizzle migration files
pnpm db:generate --name <change-name> # Generate Drizzle migration files with a semantic name
pnpm --filter @nexu/api db:push       # Drizzle schema push
pnpm generate-types                   # OpenAPI spec → frontend SDK
```

After API route/schema changes: `pnpm generate-types` then `pnpm typecheck`.

## Desktop local development

- Use `pnpm install` first, then `pnpm desktop:start` / `pnpm desktop:stop` / `pnpm desktop:restart` / `pnpm desktop:status` as the standard local desktop workflow.
- The desktop dev launcher is `apps/desktop/dev.sh`; it is the source of truth for tmux orchestration, sidecar builds, runtime cleanup, and stable repo-local path setup during local development.
- Treat `pnpm desktop:start` as the canonical cold-start entrypoint for the full local desktop runtime.
- `tmux` is required for the desktop local-dev workflow.
- Local desktop runtime state is repo-scoped under `.tmp/desktop/` in development.
- For startup troubleshooting, use `pnpm desktop:logs` and `./apps/desktop/dev.sh devlog`.
- To fully clear local desktop runtime state, use `./apps/desktop/dev.sh reset-state`.

## DB schema change workflow

When changing DB structure, follow this workflow.

### Development stage

1. Use TS schema (`apps/api/src/db/schema/index.ts`) as the SSoT for target DB structure.
2. Generate migration SQL with Drizzle and commit files under `apps/api/migrations/`.
   - Default: `pnpm db:generate`
   - Recommended: `pnpm db:generate --name <change-name>` to create a migration with a semantic name
3. Optional: for complex requirements, manually adjust the generated migration file, but only when necessary. In most cases, the auto-generated migration is the correct default.

### PR stage

- CI automatically checks migration SQL; failures block the PR.
- After the PR is merged, migrations are automatically applied by the deployment pipeline.

## Hard rules

- **Never use `any`.** Use `unknown` with narrowing or `z.infer<typeof schema>`.
- No foreign keys in Drizzle schema — application-level joins only.
- Credentials (bot tokens, signing secrets) must never appear in logs or errors.
- Frontend must use generated SDK (`apps/web/lib/api/`), never raw `fetch`.
- All API responses must use Zod response schemas via `@hono/zod-openapi`.
- Config generator output must match `docs/references/openclaw-config-schema.md`.
- Do not add dependencies without explicit approval.
- Do not modify OpenClaw source code.
- Never commit code changes until explicitly told to do so.
- Whenever you add a new environment variable, update `deploy/helm/nexu/values.yaml` in the same change.
- Gateway sidecar: never derive state paths from `OPENCLAW_CONFIG_PATH`. Use `env.OPENCLAW_STATE_DIR` for state-related files (sessions, skills, nexu-context.json). See `docs/guides/gateway-environment-guide.md`.

## Observability conventions

- Request-level tracing must be created uniformly by middleware as the root trace.
- Logic with monitoring value must be split into named functions and annotated with `@Trace` / `@Span`.
- Do not introduce function-wrapper transitional APIs such as `runTrace` / `runSpan`.
- Iterate incrementally: add Trace/Span within established code patterns first, then refine based on metrics.
- Logger usage source of truth: `apps/api/src/lib/logger.ts`; follow its exported API and nearby call-site patterns when adding logs.

## Required checks

- `pnpm typecheck` — after any TypeScript changes
- `pnpm lint` — after any code changes
- `pnpm generate-types` — after API route/schema changes
- `pnpm test` — after logic changes

## Architecture

See `ARCHITECTURE.md` for the full bird's-eye view. Key points:

- Monorepo: `apps/api` (Hono), `apps/web` (React), `packages/shared` (Zod schemas)
- Type safety: Zod -> OpenAPI -> generated frontend SDK. Never duplicate types.
- Config generator: `apps/api/src/lib/config-generator.ts` builds OpenClaw config from DB
- Runtime topology: `apps/gateway` acts as the Nexu sidecar that syncs config/skills, probes runtime health, and can manage the OpenClaw process
- Local runtime flow: `apps/api` produces config data -> `apps/gateway` syncs config/skills and coordinates runtime -> `openclaw-runtime` runs the actual OpenClaw Gateway process
- Key data flows: Slack OAuth, Slack event routing, config hot-reload

## Code style (quick reference)

- Biome: 2-space indent, double quotes, semicolons always
- Files: `kebab-case` / Types: `PascalCase` / Variables: `camelCase`
- Zod schemas: `camelCase` + `Schema` suffix
- DB tables: `snake_case` in Drizzle
- Public IDs: cuid2 (`@paralleldrive/cuid2`), never expose `pk`
- Errors: throw `HTTPException` with status + contextual message
- Logging: structured (pino or console JSON), never log credentials

## Where to look

| Topic | Location |
|-------|----------|
| Architecture & data flows | `ARCHITECTURE.md` |
| System design | `docs/designs/openclaw-multi-tenant.md` |
| OpenClaw internals | `docs/designs/openclaw-architecture-internals.md` |
| Engineering principles | `docs/design-docs/core-beliefs.md` |
| Config schema & pitfalls | `docs/references/openclaw-config-schema.md` |
| API coding patterns | `docs/references/api-patterns.md` |
| Infrastructure | `docs/references/infrastructure.md` |
| Gateway environment (dev vs prod) | `docs/guides/gateway-environment-guide.md` |
| Workspace templates | `docs/guides/workspace-templates.md` |
| Local Slack testing | `docs/references/local-slack-testing.md` |
| Frontend conventions | `docs/FRONTEND.md` |
| Security posture | `docs/SECURITY.md` |
| Reliability | `docs/RELIABILITY.md` |
| Product model | `docs/PRODUCT_SENSE.md` |
| Quality signals | `docs/QUALITY_SCORE.md` |
| Product specs | `docs/product-specs/` |
| Execution plans | `docs/exec-plans/` |
| DB schema reference | `docs/generated/db-schema.md` |
| Documentation sync | `skills/localdev/sync-docs/SKILL.md` |
| E2E gateway testing | `skills/localdev/nexu-e2e-test/SKILL.md` |
| Production operations | `skills/localdev/prod-ops/SKILL.md` |
| Nano Banana (image gen) | `skills/nexubot/nano-banana/SKILL.md` |

## Documentation maintenance

After significant code changes, verify documentation is current.

### Diff baseline

```bash
git diff --name-only $(git merge-base HEAD origin/main)...HEAD
```

### Impact mapping (changed area -> affected docs)

| Changed area | Affected docs |
|---|---|
| `apps/api/src/db/schema/` | `docs/generated/db-schema.md`, `ARCHITECTURE.md` |
| `apps/api/src/routes/` | `docs/references/api-patterns.md`, `docs/product-specs/*.md` |
| `apps/web/src/pages/` or routing | `docs/FRONTEND.md` |
| `apps/gateway/src/` | `ARCHITECTURE.md`, `docs/RELIABILITY.md` |
| `package.json` scripts | `AGENTS.md` Commands section |
| New/moved doc files | `AGENTS.md` Where to look |

### Cross-reference checklist

1. `AGENTS.md` Where to look table — all paths valid
2. `docs/DESIGN.md` <-> `docs/design-docs/` + `docs/designs/` (indexed)
3. `docs/product-specs/index.md` <-> actual spec files
4. `docs/FRONTEND.md` Pages <-> `apps/web/src/app.tsx` routes

### Rules

- Regenerate `docs/generated/db-schema.md` fully from schema source
- Preserve original language (English/Chinese)
- Do not auto-commit; present changes for review

Full reference: `skills/localdev/sync-docs/SKILL.md`

## Cross-project sync rules

Nexu work must be synced into the team knowledge repo at:
- `agent-digital-cowork/clone/`

When producing artifacts in this repo, sync them to the cross-project repo using this mapping:

| Artifact type | Target in `agent-digital-cowork/clone/` |
|---|---|
| Design plans / architecture proposals | `design/` |
| Debug summaries / incident analysis | `debug/` |
| Ideas / product notes | `ideas/` |
| Stable facts / decisions / runbooks | `knowledge/` |
| Open blockers / follow-ups | `blockers/` |

## Memory references

Project memory directory:
- `/Users/alche/.claude/projects/-Users-alche-Documents-digit-sutando-nexu/memory/`

Keep these memory notes up to date:
- Cross-project sync rules memory (source of truth for sync expectations)
- Skills hot-reload findings memory (`skills-hotreload.md`)
- DB/dev environment quick-reference memory

## Skills hot-reload note

For OpenClaw skills behavior and troubleshooting, maintain and consult:
- `skills-hotreload.md` in the Nexu memory directory above.

This note should track:
- End-to-end pipeline status (`DB -> API -> Sidecar -> Gateway`)
- Why `openclaw-managed` skills may be missing from session snapshots
- Watcher/snapshot refresh caveats and validation steps

## Local quick reference

- DB (default local): `postgresql://nexu:nexu@localhost:5433/nexu_dev`
- API env path: `apps/api/.env`
- OpenClaw managed skills dir (expected default): `~/.openclaw/skills/`
- `openclaw-runtime` is installed implicitly by `pnpm install`; local development should normally not use a global `openclaw` CLI
- Prefer `./openclaw-wrapper` over global `openclaw` in local development; it executes `openclaw-runtime/node_modules/openclaw/openclaw.mjs`
- When OpenClaw is started manually, set `RUNTIME_MANAGE_OPENCLAW_PROCESS=false` for `@nexu/gateway` to avoid launching a second OpenClaw process
- If behavior differs, verify effective `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` used by running gateway processes.
