# AGENTS.md

This file is for agentic coding tools. It's a map — read linked docs for depth.

## Repo overview

Nexu is an OpenClaw multi-tenant platform. Users create AI bots, connect them to Slack, and the system generates OpenClaw config that hot-loads into shared Gateway processes.

- Monorepo: pnpm workspaces
- `apps/api` — Legacy Hono + Drizzle + Zod OpenAPI package retained for SaaS/db workflows during migration
- `apps/controller` — Single-user local control plane for Nexu config, OpenClaw sync, and runtime orchestration
- `apps/desktop` — Electron desktop runtime shell and sidecar orchestrator
- `apps/gateway` — Legacy gateway sidecar package retained for SaaS/runtime deploy workflows during migration
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
pnpm dev                              # Local controller-first web stack (Controller + Web)
pnpm dev:legacy                       # Legacy API + Web local stack
pnpm dev:legacy:gateway               # Legacy gateway sidecar only
pnpm dev:controller                   # Controller only
pnpm desktop:start                    # Build and launch the desktop local runtime stack
pnpm desktop:stop                     # Stop the desktop local runtime stack
pnpm desktop:restart                  # Restart the desktop local runtime stack
pnpm desktop:status                   # Show desktop local runtime status
pnpm desktop:dist:mac                 # Build signed macOS desktop distributables
pnpm desktop:dist:mac:unsigned        # Build unsigned macOS desktop distributables
pnpm probe:slack prepare              # Launch Chrome Canary with the dedicated Slack probe profile
pnpm probe:slack run                  # Run the local Slack reply smoke probe against an authenticated DM
pnpm --filter @nexu/api dev           # Legacy API only
pnpm --filter @nexu/web dev           # Web only
pnpm build                            # Build all
pnpm check:esm-imports                # Scan built dist for extensionless relative ESM specifiers
pnpm typecheck                        # Typecheck all
pnpm lint                             # Biome lint
pnpm format                           # Biome format
pnpm test                             # Vitest
pnpm --filter @nexu/api test          # Legacy API tests only
pnpm db:generate                      # Generate Drizzle migration files
pnpm db:generate --name <change-name> # Generate Drizzle migration files with a semantic name
pnpm --filter @nexu/api db:push       # Drizzle schema push
pnpm generate-types                   # OpenAPI spec → frontend SDK
```

After API route/schema changes: `pnpm generate-types` then `pnpm typecheck`.

For local desktop/runtime work, prefer the controller-first path and treat `apps/api` / `apps/gateway` as legacy unless you are intentionally working on the SaaS/db or legacy deploy path.

## Branch model

- `main` is the integration branch and should stay releasable.
- Do feature work on short-lived branches named with a clear prefix such as `feat/...`, `fix/...`, or `chore/...`.
- Prefer merging the latest `main` into long-running feature branches instead of rewriting shared history once a PR is under review.
- After a PR merges, sync local `main`, then delete the merged feature branch locally and remotely when it is no longer needed.

## Desktop local development

- Use `pnpm install` first, then `pnpm desktop:start` / `pnpm desktop:stop` / `pnpm desktop:restart` / `pnpm desktop:status` as the standard local desktop workflow.
- The repo also includes a local Slack reply smoke probe at `scripts/probe/slack-reply-probe.mjs` (`pnpm probe:slack prepare` / `pnpm probe:slack run`) for verifying the end-to-end Slack DM reply path after local runtime or OpenClaw changes.
- The Slack smoke probe is not zero-setup: install Chrome Canary first, then manually log into Slack in the opened Canary window before running `pnpm probe:slack run`.
- The desktop dev launcher is `apps/desktop/dev.sh`; it is the source of truth for tmux orchestration, sidecar builds, runtime cleanup, and stable repo-local path setup during local development.
- Treat `pnpm desktop:start` as the canonical cold-start entrypoint for the full local desktop runtime.
- The active desktop runtime path is controller-first: desktop launches `controller + web + openclaw` and no longer starts local `api`, `gateway`, or `pglite` sidecars.
- Desktop local runtime should not depend on PostgreSQL; controller-owned local state lives under `~/.nexu/`, while desktop dev runtime state remains repo-scoped under `.tmp/desktop/`.
- `tmux` is required for the desktop local-dev workflow.
- Local desktop runtime state is repo-scoped under `.tmp/desktop/` in development.
- For startup troubleshooting, use `pnpm desktop:logs` and `./apps/desktop/dev.sh devlog`.
- If `pnpm desktop:start` exits immediately because `electron/cli.js` cannot be resolved from `apps/desktop`, validate `pnpm -C apps/desktop exec electron --version` and consult `specs/guides/desktop-runtime-guide.md` before changing the launcher flow.
- Desktop already exposes an agent-friendly runtime observability surface; prefer subscribing/querying before adding temporary UI or ad hoc debug logging.
- For deeper desktop runtime inspection, use the existing event/query path (`onRuntimeEvent(...)`, `runtime:query-events`, `queryRuntimeEvents(...)`) instead of rebuilding one-off diagnostics.
- Use `actionId`, `reasonCode`, and `cursor` / `nextCursor` as the primary correlation and incremental-fetch primitives for desktop runtime debugging.
- To fully clear local desktop runtime state, use `./apps/desktop/dev.sh reset-state`.
- Desktop runtime guide: `specs/guides/desktop-runtime-guide.md`.

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
- All API routes must use `createRoute()` + `app.openapi()` from `@hono/zod-openapi`. Never use plain `app.get()`/`app.post()` etc — those bypass OpenAPI spec generation and the SDK won't have corresponding functions.
- All request bodies, path params, query params, and responses must have Zod schemas. Shared schemas go in `packages/shared/src/schemas/`, route-local param schemas (e.g. `z.object({ id: z.string() })`) can stay in the route file.
- After adding or modifying API routes: run `pnpm generate-types` to regenerate `openapi.json` -> `sdk.gen.ts` -> `types.gen.ts`, then update frontend call sites to use the new SDK functions.
- Config generator output must match `specs/references/openclaw-config-schema.md`.
- Do not add dependencies without explicit approval.
- Do not modify OpenClaw source code.
- Never commit code changes until explicitly told to do so.
- Whenever you add a new environment variable, update `deploy/helm/nexu/values.yaml` in the same change.
- Gateway sidecar: never derive state paths from `OPENCLAW_CONFIG_PATH`. Use `env.OPENCLAW_STATE_DIR` for state-related files (sessions, skills, nexu-context.json). See `specs/guides/gateway-environment-guide.md`.
- Desktop packaged app: never use `npx`, `npm`, `pnpm`, or any shell command that relies on the user's PATH. The packaged Electron app has no shell profile — resolve bin paths programmatically via `require.resolve()` and execute with `process.execPath`. The app must be fully self-contained.

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

- Monorepo: `apps/api` (Hono), `apps/web` (React), `apps/desktop` (Electron), `packages/shared` (Zod schemas), `nexu-skills/` (skill repo)
- Type safety: Zod -> OpenAPI -> generated frontend SDK. Never duplicate types.
- Config generator: `apps/api/src/lib/config-generator.ts` builds OpenClaw config from DB
- Runtime topology: `apps/gateway` acts as the Nexu sidecar that syncs config/skills, probes runtime health, and can manage the OpenClaw process
- Local runtime flow: `apps/controller` owns Nexu config/state, writes OpenClaw config/skills/templates, and manages `openclaw-runtime` directly; desktop wraps that controller-first stack with Electron + web sidecars
- Key data flows: Slack OAuth, Slack/Feishu event routing, config hot-reload, file-based skill catalog

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
| System design | `specs/designs/openclaw-multi-tenant.md` |
| OpenClaw internals | `specs/designs/openclaw-architecture-internals.md` |
| Engineering principles | `specs/design-docs/core-beliefs.md` |
| Config schema & pitfalls | `specs/references/openclaw-config-schema.md` |
| API coding patterns | `specs/references/api-patterns.md` |
| Infrastructure | `specs/references/infrastructure.md` |
| Gateway environment (dev vs prod) | `specs/guides/gateway-environment-guide.md` |
| Workspace templates | `specs/guides/workspace-templates.md` |
| Local Slack testing | `specs/references/local-slack-testing.md` |
| Local Slack smoke probe | `scripts/probe/README.md`, `scripts/probe/slack-reply-probe.mjs` |
| Frontend conventions | `specs/FRONTEND.md` |
| Desktop runtime guide | `specs/guides/desktop-runtime-guide.md` |
| Security posture | `specs/SECURITY.md` |
| Reliability | `specs/RELIABILITY.md` |
| Product model | `specs/PRODUCT_SENSE.md` |
| Quality signals | `specs/QUALITY_SCORE.md` |
| Product specs | `specs/product-specs/` |
| Execution plans | `specs/exec-plans/` |
| DB schema reference | `specs/generated/db-schema.md` |
| Documentation sync | `skills/localdev/sync-specs/SKILL.md` |
| E2E gateway testing | `skills/localdev/nexu-e2e-test/SKILL.md` |
| Production operations | `skills/localdev/prod-ops/SKILL.md` |
| Nano Banana (image gen) | `skills/nexubot/nano-banana/SKILL.md` |
| Skill repo & catalog | `nexu-skills/`, `apps/api/src/services/runtime/skill-catalog.ts` |
| File-based skills design | `specs/plans/2026-03-15-skill-repo-design.md` |
| Feishu channel setup | `apps/web/src/components/channel-setup/feishu-setup-view.tsx` |

## Documentation maintenance

After significant code changes, verify documentation is current.

### Diff baseline

```bash
git diff --name-only $(git merge-base HEAD origin/main)...HEAD
```

### Impact mapping (changed area -> affected docs)

| Changed area | Affected docs |
|---|---|
| `apps/api/src/db/schema/` | `specs/generated/db-schema.md`, `ARCHITECTURE.md` |
| `apps/api/src/routes/` | `specs/references/api-patterns.md`, `specs/product-specs/*.md` |
| `apps/web/src/pages/` or routing | `specs/FRONTEND.md` |
| `apps/gateway/src/` | `ARCHITECTURE.md`, `specs/RELIABILITY.md` |
| `apps/api/src/services/runtime/` | `ARCHITECTURE.md` (skill catalog) |
| `apps/web/src/components/channel-setup/` | `specs/FRONTEND.md` |
| `nexu-skills/` | `ARCHITECTURE.md` (monorepo layout) |
| `packages/shared/src/schemas/` | `ARCHITECTURE.md` (type safety) |
| `package.json` scripts | `AGENTS.md` Commands section |
| New/moved doc files | `AGENTS.md` Where to look |

### Cross-reference checklist

1. `AGENTS.md` Where to look table — all paths valid
2. `specs/DESIGN.md` <-> `specs/design-specs/` + `specs/designs/` (indexed)
3. `specs/product-specs/index.md` <-> actual spec files
4. `specs/FRONTEND.md` Pages <-> `apps/web/src/app.tsx` routes

### Rules

- Regenerate `specs/generated/db-schema.md` fully from schema source
- Preserve original language (English/Chinese)
- Do not auto-commit; present changes for review

Full reference: `skills/localdev/sync-specs/SKILL.md`

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
- Controller env path: `apps/controller/.env`
- OpenClaw managed skills dir (expected default): `~/.openclaw/skills/`
- Slack smoke probe setup: install Chrome Canary, set `PROBE_SLACK_URL`, run `pnpm probe:slack prepare`, then manually log into Slack in Canary before `pnpm probe:slack run`
- `openclaw-runtime` is installed implicitly by `pnpm install`; local development should normally not use a global `openclaw` CLI
- Prefer `./openclaw-wrapper` over global `openclaw` in local development; it executes `openclaw-runtime/node_modules/openclaw/openclaw.mjs`
- When OpenClaw is started manually, set `RUNTIME_MANAGE_OPENCLAW_PROCESS=false` for `@nexu/controller` to avoid launching a second OpenClaw process
- If behavior differs, verify effective `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` used by the running controller process.
