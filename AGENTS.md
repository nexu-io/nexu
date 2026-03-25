# AGENTS.md

This file is for agentic coding tools. It's a map — read linked docs for depth.

## Repo overview

Nexu is a desktop-first OpenClaw platform. Users create AI bots, connect them to Slack, and the local controller generates OpenClaw config for the embedded runtime.

- Monorepo: pnpm workspaces
- `apps/controller` — Single-user local control plane for Nexu config, OpenClaw sync, and runtime orchestration
- `apps/desktop` — Electron desktop runtime shell and sidecar orchestrator
- `apps/web` — React + Ant Design + Vite
- `openclaw-runtime` — Repo-local packaged OpenClaw runtime for local dev and desktop packaging; replaces global `openclaw` CLI
- `packages/shared` — Shared Zod schemas

## Project overview

Nexu is a desktop-first OpenClaw product. Users create AI bots via a dashboard and connect them to Slack. The system dynamically generates OpenClaw configuration and hot-loads it into the local runtime managed by the controller.

## Commands

All commands use pnpm. Target a single app with `pnpm --filter <package>`.

```bash
pnpm install                          # Install
pnpm dev                              # Local controller-first web stack (Controller + Web)
pnpm dev:controller                   # Controller only
pnpm start                            # Build and launch the desktop local runtime stack
pnpm stop                             # Stop the desktop local runtime stack
pnpm restart                          # Restart the desktop local runtime stack
pnpm reset-state                      # Stop desktop runtime and delete repo-local desktop state
pnpm status                           # Show desktop local runtime status
pnpm dist:mac                         # Build signed macOS desktop distributables
pnpm dist:mac:unsigned                # Build unsigned macOS desktop distributables
pnpm probe:slack prepare              # Launch Chrome Canary with the dedicated Slack probe profile
pnpm probe:slack run                  # Run the local Slack reply smoke probe against an authenticated DM
pnpm --filter @nexu/web dev           # Web only
pnpm build                            # Build all
pnpm check:esm-imports                # Scan built dist for extensionless relative ESM specifiers
pnpm typecheck                        # Typecheck all
pnpm lint                             # Biome lint
pnpm format                           # Biome format
pnpm test                             # Vitest
pnpm generate-types                   # OpenAPI spec → frontend SDK
```

After API route/schema changes: `pnpm generate-types` then `pnpm typecheck`.

This repo is desktop-first. Prefer the controller-first path and remove or ignore legacy API/gateway/container-era assets when encountered.

## Branch model

- `main` is the integration branch and should stay releasable.
- Do feature work on short-lived branches named with a clear prefix such as `feat/...`, `fix/...`, or `chore/...`.
- Prefer merging the latest `main` into long-running feature branches instead of rewriting shared history once a PR is under review.
- After a PR merges, sync local `main`, then delete the merged feature branch locally and remotely when it is no longer needed.

## Commit & PR conventions

- **No co-author trailer.** Never append `Co-Authored-By:` lines to commit messages.
- **Conventional commit prefix.** Use `chore:` for changes that are invisible to end users (CI/CD, issue bots, tooling, config). These are excluded from release notes. Use `feat:` / `fix:` / `docs:` etc. for user-visible changes.
- **PR format.** When creating a pull request, always follow `.github/pull_request_template.md` — fill in What / Why / How / Affected areas / Checklist sections.

## Desktop local development

- Use `pnpm install` first, then `pnpm start` / `pnpm stop` / `pnpm restart` / `pnpm status` as the standard local desktop workflow.
- The repo also includes a local Slack reply smoke probe at `scripts/probe/slack-reply-probe.mjs` (`pnpm probe:slack prepare` / `pnpm probe:slack run`) for verifying the end-to-end Slack DM reply path after local runtime or OpenClaw changes.
- The Slack smoke probe is not zero-setup: install Chrome Canary first, then manually log into Slack in the opened Canary window before running `pnpm probe:slack run`.
- The desktop dev launcher is `apps/desktop/dev.sh`; it is the source of truth for tmux orchestration, sidecar builds, runtime cleanup, and stable repo-local path setup during local development.
- Treat `pnpm start` as the canonical cold-start entrypoint for the full local desktop runtime.
- The active desktop runtime path is controller-first: desktop launches `controller + web + openclaw` and no longer starts local `api`, `gateway`, or `pglite` sidecars.
- Desktop local runtime should not depend on PostgreSQL. In dev mode, all state (config, OpenClaw state, logs) lives under `.tmp/desktop/nexu-home/`, fully isolated from the packaged app. Launchd plists go to `.tmp/launchd/`, runtime-ports.json also lives there.
- In packaged mode, data is split across two directories (see table below). Launchd plists go to `~/Library/LaunchAgents/`.
- Local desktop runtime state is repo-scoped under `.tmp/desktop/` in development.

### Packaged app directory layout

| Directory | Purpose | Survives uninstall |
|---|---|---|
| `~/.nexu/` (`NEXU_HOME`) | User config (`config.json`, `cloud-profiles.json`), compiled snapshots, skill ledger, skillhub cache, logs, openclaw-sidecar, `nexu.db` | Yes |
| `~/Library/Application Support/@nexu/desktop/` (Electron `userData`) | OpenClaw runtime state: `runtime/openclaw/state/agents/` (conversations), `runtime/openclaw/state/extensions/` (channel state), `runtime/openclaw/state/skills/`, `runtime/openclaw/state/openclaw.json`, plus Electron internal data (Cache, IndexedDB, etc.) | No (cleaned by uninstall tools) |

The split is intentional: `NEXU_HOME` holds lightweight user preferences that should persist across reinstalls; Electron `userData` holds heavy runtime state tied to the app lifecycle. `OPENCLAW_STATE_DIR` is explicitly set by the desktop launcher to point to the `userData` path — do not rely on the controller's default fallback.
- For startup troubleshooting, use `pnpm logs` to tail dev logs.
- `pnpm reset-state` is a dev-only cleanup shortcut; it stops the stack and removes repo-local desktop runtime state under `.tmp/desktop/`, but it does not delete packaged app state.
- To fully reset local desktop + controller state, stop the stack, remove `.tmp/desktop/`, then remove `~/.nexu/` and `~/Library/Application Support/@nexu/desktop/`.
- If `pnpm start` exits immediately because `electron/cli.js` cannot be resolved from `apps/desktop`, validate `pnpm -C apps/desktop exec electron --version` and consult `specs/guides/desktop-runtime-guide.md` before changing the launcher flow.
- Desktop already exposes an agent-friendly runtime observability surface; prefer subscribing/querying before adding temporary UI or ad hoc debug logging.
- For deeper desktop runtime inspection, use the existing event/query path (`onRuntimeEvent(...)`, `runtime:query-events`, `queryRuntimeEvents(...)`) instead of rebuilding one-off diagnostics.
- Use `actionId`, `reasonCode`, and `cursor` / `nextCursor` as the primary correlation and incremental-fetch primitives for desktop runtime debugging.
- To fully clear local desktop runtime state, use `./apps/desktop/dev.sh reset-state`.
- Desktop runtime guide: `specs/guides/desktop-runtime-guide.md`.
- The controller sidecar is packaged by `apps/desktop/scripts/prepare-controller-sidecar.mjs` which deep-copies all controller `dependencies` and their transitive deps into `.dist-runtime/controller/node_modules/`. Keep controller deps minimal to avoid bloating the desktop distributable.
- SkillHub (catalog, install, uninstall) runs in the controller via HTTP — not in the Electron main process via IPC. The web app always uses HTTP SDK for skill operations.
- Desktop auto-update is channel-specific. Packaged builds should embed `NEXU_DESKTOP_UPDATE_CHANNEL` (`stable` / `beta` / `nightly`) so the updater checks the matching feed, and update diagnostics should always log the effective feed URL plus remote `version` / `releaseDate` when available.

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
- Desktop packaged app: never use `npx`, `npm`, `pnpm`, or any shell command that relies on the user's PATH. The packaged Electron app has no shell profile — resolve bin paths programmatically via `require.resolve()` and execute with `process.execPath`. The app must be fully self-contained.
- Controller sidecar packaging: every dependency in `apps/controller/package.json` is recursively deep-copied into the desktop distributable via `prepare-controller-sidecar` → `copyRuntimeDependencyClosure`. **Never add heavy transitive-dependency packages (e.g. `npm`, `yarn`) to the controller.** If the controller needs to shell out to a CLI tool, use PATH-based `execFile("npm", ...)` instead of bundling it as a dependency. Each MB added to controller deps adds ~1 MB to the final DMG/ZIP.
- Native Node.js addons (e.g. `better-sqlite3`) must live in the controller, NOT in the desktop Electron main process. Electron's built-in Node.js has a different ABI version (NODE_MODULE_VERSION) from system Node.js, requiring `electron-rebuild` to recompile native modules. The controller runs as a regular Node.js process (`ELECTRON_RUN_AS_NODE=1`), so native addons work without recompilation.

## Observability conventions

- Request-level tracing must be created uniformly by middleware as the root trace.
- Logic with monitoring value must be split into named functions and annotated with `@Trace` / `@Span`.
- Do not introduce function-wrapper transitional APIs such as `runTrace` / `runSpan`.
- Iterate incrementally: add Trace/Span within established code patterns first, then refine based on metrics.
- Logger usage source of truth should follow the active package you are editing; prefer established nearby logger patterns in controller and desktop code.

## Required checks

- `pnpm typecheck` — after any TypeScript changes
- `pnpm lint` — after any code changes
- `pnpm generate-types` — after API route/schema changes
- `pnpm test` — after logic changes

## Architecture

See `ARCHITECTURE.md` for the full bird's-eye view. Key points:

- Monorepo: `apps/controller` (Hono), `apps/web` (React), `apps/desktop` (Electron), `packages/shared` (Zod schemas), `nexu-skills/` (skill repo)
- Type safety: Zod -> OpenAPI -> generated frontend SDK. Never duplicate types.
- Config generator: `apps/controller/src/lib/openclaw-config-compiler.ts` builds OpenClaw config from local controller state
- Local runtime flow: `apps/controller` owns Nexu config/state, writes OpenClaw config/skills/templates, and manages `openclaw-runtime` directly; desktop wraps that controller-first stack with Electron + web sidecars
- Key data flows: local config compilation, desktop runtime boot, channel sync, file-based skill catalog

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
| Documentation sync | `skills/localdev/sync-specs/SKILL.md` |
| Nano Banana (image gen) | `skills/nexubot/nano-banana/SKILL.md` |
| Skill repo & catalog | `nexu-skills/`, `apps/controller/src/services/skillhub/` |
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
| `apps/web/src/pages/` or routing | `specs/FRONTEND.md` |
| `apps/controller/src/routes/` | `specs/references/api-patterns.md`, `specs/product-specs/*.md` |
| `apps/controller/src/runtime/` | `ARCHITECTURE.md`, `specs/RELIABILITY.md` |
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
- End-to-end pipeline status (`Controller store -> compiler -> runtime writers -> OpenClaw`)
- Why `openclaw-managed` skills may be missing from session snapshots
- Watcher/snapshot refresh caveats and validation steps

## Local quick reference

- Controller env path: `apps/controller/.env`
- OpenClaw managed skills dir (expected default): `~/.openclaw/skills/`
- Slack smoke probe setup: install Chrome Canary, set `PROBE_SLACK_URL`, run `pnpm probe:slack prepare`, then manually log into Slack in Canary before `pnpm probe:slack run`
- `openclaw-runtime` is installed implicitly by `pnpm install`; local development should normally not use a global `openclaw` CLI
- Prefer `./openclaw-wrapper` over global `openclaw` in local development; it executes `openclaw-runtime/node_modules/openclaw/openclaw.mjs`
- When OpenClaw is started manually, set `RUNTIME_MANAGE_OPENCLAW_PROCESS=false` for `@nexu/controller` to avoid launching a second OpenClaw process
- If behavior differs, verify effective `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` used by the running controller process.
