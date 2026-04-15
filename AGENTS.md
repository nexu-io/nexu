# AGENTS.md

This file is for agentic coding tools. It's a map — read linked docs for depth.

## Repo overview

Nexu is a desktop-first OpenClaw platform. Users create AI bots, connect them to Slack, and the local controller generates OpenClaw config for the embedded runtime.

- Monorepo: pnpm workspaces
- `apps/controller` — Single-user local control plane for Nexu config, OpenClaw sync, and runtime orchestration
- `apps/desktop` — Electron desktop runtime shell and sidecar orchestrator
- `apps/web` — React + Ant Design + Vite
- `packages/slimclaw` — Repo-local Nexu-owned OpenClaw runtime contract, prepared runtime root, and staging/patch ownership for local dev and desktop packaging
- `packages/shared` — Shared Zod schemas
- `packages/dev-utils` — TS-first reusable utilities for local script tooling

## Project overview

Nexu is a desktop-first OpenClaw product. Users create AI bots via a dashboard and connect them to Slack. The system dynamically generates OpenClaw configuration and hot-loads it into the local runtime managed by the controller.

## Commands

All commands use pnpm. Target a single app with `pnpm --filter <package>`.

```bash
pnpm install                          # Install
pnpm --filter @nexu/shared build      # Build shared dist required by cold-start dev flows
pnpm dev start                        # Start the lightweight local stack: openclaw -> controller -> web -> desktop
pnpm dev start <service>              # Start one local-dev service: desktop|openclaw|controller|web
pnpm dev restart                      # Restart the lightweight local stack
pnpm dev stop                         # Stop the lightweight local stack in reverse order
pnpm dev stop <service>               # Stop one local-dev service
pnpm dev restart <service>            # Restart one local-dev service
pnpm dev status <service>             # Show status for one local-dev service
pnpm dev logs <service>               # Show active-session log tail (max 200 lines) for one local-dev service
pnpm dev inspect screenshot           # Capture the current desktop window screenshot (dev desktop only)
pnpm dev inspect eval "<expr>"        # Evaluate a JS expression in the desktop renderer (dev desktop only)
pnpm dev inspect dom                  # Dump the current desktop renderer DOM summary (dev desktop only)
pnpm dev inspect logs                 # Show buffered desktop renderer console/error logs (dev desktop only)
pnpm dev:controller                   # Legacy controller-only direct dev entrypoint
pnpm dist:mac                         # Build signed macOS desktop distributables
pnpm dist:mac:arm64                   # Build signed Apple Silicon macOS desktop distributables
pnpm dist:mac:x64                     # Build signed Intel macOS desktop distributables
pnpm dist:mac:unsigned                # Build unsigned macOS desktop distributables
pnpm dist:mac:unsigned:arm64          # Build unsigned Apple Silicon macOS desktop distributables
pnpm dist:mac:unsigned:x64            # Build unsigned Intel macOS desktop distributables
pnpm dist:win:local                   # Fast local Windows packaging check: reuse existing builds/runtime/sidecars when available and validate dir-only output
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
- **Docs commit/PR prefix.** Documentation-only changes must use `docs:` for both commit titles and PR titles.
- **Non-user-facing commit/PR prefix.** Any change that is not user-facing and should not appear in release notes must use `chore:` for both commit titles and PR titles.
- **PR format.** When creating a pull request, always follow `.github/pull_request_template.md` — fill in What / Why / How / Affected areas / Checklist sections.

## Desktop local development

- Minimal cold-start setup on a fresh machine is: `pnpm install` -> `pnpm --filter @nexu/shared build` -> copy `tools/dev/.env.example` to `tools/dev/.env` only if you need dev-only overrides.
- Default daily flow is: `pnpm dev start` -> `pnpm dev status <service>` / `pnpm dev logs <service>` as needed -> `pnpm dev stop`.
- Use `pnpm dev restart` for a clean full-stack recycle; use `pnpm dev restart <service>` only when you are intentionally touching one service.
- Explicit single-service control remains available through `pnpm dev start <desktop|openclaw|controller|web>`, `pnpm dev stop <service>`, `pnpm dev restart <service>`, `pnpm dev status <service>`, and `pnpm dev logs <service>`.
- Desktop dev inspect is available through `pnpm dev inspect screenshot`, `pnpm dev inspect eval "<expr>"`, `pnpm dev inspect dom`, and `pnpm dev inspect logs` for agent-friendly renderer inspection without exposing a public production API.
- `pnpm dev` intentionally does not support `all`; the full local stack order remains `openclaw` -> `controller` -> `web` -> `desktop`.
- `pnpm dev logs <service>` is session-scoped, prints a fixed header, and tails at most the last 200 lines from the active service session.
- `tools/dev/.env.example` is the source-of-truth template for dev-only overrides. Copy it to `tools/dev/.env` only when you need to override ports, URLs, state paths, or the shared OpenClaw gateway token for local development.
- Keep the detailed startup optimization rules, cache invalidation behavior, and troubleshooting notes in `specs/guides/desktop-runtime-guide.md`; keep only the core workflow expectations here.
- The repo also includes a local Slack reply smoke probe at `scripts/probe/slack-reply-probe.mjs` (`pnpm probe:slack prepare` / `pnpm probe:slack run`) for verifying the end-to-end Slack DM reply path after local runtime or OpenClaw changes.
- The Slack smoke probe is not zero-setup: install Chrome Canary first, then manually log into Slack in the opened Canary window before running `pnpm probe:slack run`.
- The desktop dev launcher is `tools/dev/`; it is the unified source of truth for local dev orchestration, including platform-specific desktop launch preparation and runtime cleanup.
- `pnpm dev` desktop launch is owned by `tools/dev`, which starts the desktop Vite worker and Electron main process explicitly while routing platform-specific setup through `tools/dev/src/shared/platform/desktop-dev-platform.*`. On macOS, the darwin helper patches the dev Electron binary's `LSUIElement` and refreshes Launch Services metadata before launch.
- `pnpm stop` behavior: sends SIGTERM first (triggers `gracefulShutdown` inside Electron → teardown launchd services → dispose orchestrator → kill orphans), waits up to 10 seconds for graceful exit, then SIGKILL as fallback. Also kills tsc watcher and web watcher background processes.
- Treat `pnpm start` as the canonical cold-start entrypoint for the full local desktop runtime.
- The active desktop runtime path is controller-first: desktop launches `controller + web + openclaw` and no longer starts local `api`, `gateway`, or `pglite` sidecars.
- Desktop local runtime should not depend on PostgreSQL. In dev mode, all state (config, OpenClaw state, logs) lives under `.tmp/desktop/nexu-home/`, fully isolated from the packaged app. Launchd plists go to `.tmp/launchd/`, runtime-ports.json also lives there.
- In packaged mode, data is split across two directories (see table below). Launchd plists go to `~/Library/LaunchAgents/`.
- Local desktop runtime state is repo-scoped under `.tmp/desktop/` in development.

### Packaged app directory layout

| Directory | Purpose | Survives uninstall |
|---|---|---|
| `~/.nexu/` (`NEXU_HOME`) | User config (`config.json`, `cloud-profiles.json`), compiled snapshots (`compiled-openclaw.json`), skill ledger (`skill-ledger.json`), skillhub cache, analytics state, logs | Yes |
| `~/.nexu/runtime/nexu-runner.app/` | APFS-cloned Electron binary + Frameworks for launchd services (avoids locking .app bundle during reinstall). Version-stamped; re-clones on app update. | Yes |
| `~/.nexu/runtime/controller-sidecar/` | APFS-cloned controller sidecar (dist + node_modules). Same reason as runner. | Yes |
| `~/.nexu/runtime/openclaw-sidecar/` | Extracted OpenClaw sidecar from .app payload. | Yes |
| `~/Library/Application Support/@nexu/desktop/` (Electron `userData`) | OpenClaw runtime state: `runtime/openclaw/state/agents/` (conversations), `runtime/openclaw/state/extensions/` (channel state), `runtime/openclaw/state/skills/`, `runtime/openclaw/state/openclaw.json`, plus Electron internal data (Cache, IndexedDB, etc.) | No (cleaned by uninstall tools) |

The split is intentional: `NEXU_HOME` holds lightweight user preferences and extracted runtime sidecars that should persist across reinstalls; Electron `userData` holds heavy runtime state tied to the app lifecycle. `OPENCLAW_STATE_DIR` is explicitly set by the desktop launcher to point to the `userData` path — do not rely on the controller's default fallback.
Launchd services reference ONLY paths under `~/.nexu/runtime/` (never inside the `.app` bundle), so the packaged app can be replaced by Finder drag-and-drop while services run in the background.
- For startup troubleshooting, use `pnpm logs` to tail dev logs.
- For proxy troubleshooting, inspect `desktop-diagnostics.json` and check `proxy.source`, redacted proxy env values, normalized bypass entries, and `resolveProxy(...)` results for controller/OpenClaw/external URLs.
- To fully reset repo-local desktop runtime state, stop the stack and remove `.tmp/desktop/`; this does not delete packaged app state.
- `tmux` is no longer required for the `pnpm dev` local-dev workflow; process state there is tracked by the platform-aware launcher entrypoints.
- To fully reset local desktop + controller state, stop the stack, remove `.tmp/desktop/`, then remove `~/.nexu/` and `~/Library/Application Support/@nexu/desktop/`.
- Desktop already exposes an agent-friendly runtime observability surface; prefer subscribing/querying before adding temporary UI or ad hoc debug logging.
- For deeper desktop runtime inspection, use the existing event/query path (`onRuntimeEvent(...)`, `runtime:query-events`, `queryRuntimeEvents(...)`) instead of rebuilding one-off diagnostics.
- Use `actionId`, `reasonCode`, and `cursor` / `nextCursor` as the primary correlation and incremental-fetch primitives for desktop runtime debugging.
- Desktop runtime guide: `specs/guides/desktop-runtime-guide.md`.
- The controller sidecar is packaged by `apps/desktop/scripts/prepare-controller-sidecar.mjs` which deep-copies all controller `dependencies` and their transitive deps into `.dist-runtime/controller/node_modules/`. Keep controller deps minimal to avoid bloating the desktop distributable.
- SkillHub (catalog, install, uninstall) runs in the controller via HTTP — not in the Electron main process via IPC. The web app always uses HTTP SDK for skill operations.
- Desktop auto-update is channel-specific. Packaged builds should embed `NEXU_DESKTOP_UPDATE_CHANNEL` (`stable` / `beta` / `nightly`) so the updater checks the matching feed, and update diagnostics should always log the effective feed URL plus remote `version` / `releaseDate` when available.

### Shutdown architecture

All quit/exit paths converge to `runTeardownAndExit()` in `quit-handler.ts`, which wraps cleanup in `try/finally` to guarantee `app.exit(0)` even if teardown throws.

**Non-launchd mode** (orchestrator): `gracefulShutdown(reason)` in `apps/desktop/main/index.ts` is the single entry point:
- **before-quit** (Cmd+Q / Dock Quit) → `gracefulShutdown("before-quit")`
- **SIGTERM** (external kill, `pnpm stop`, system shutdown) → `gracefulShutdown("signal:SIGTERM")`
- **SIGINT** (Ctrl+C) → `gracefulShutdown("signal:SIGINT")`

**Launchd mode** (packaged / `pnpm start`): all exit triggers flow through `runTeardownAndExit()`:
- **Dev window close** → `runTeardownAndExit("dev-close")`
- **Dev Cmd+Q / app.quit()** → `runTeardownAndExit("dev-before-quit")`
- **Packaged "Quit Completely" dialog** → `runTeardownAndExit("packaged-quit")`
- **Packaged no-window exit** (renderer crash) → `runTeardownAndExit("packaged-no-window")`
- **Update install** → `teardownLaunchdServices()` + `ensureNexuProcessesDead()` + `checkCriticalPathsLocked()` via `update-manager.ts`
- **SIGTERM / SIGINT** → `gracefulShutdown()` which also calls `teardownLaunchdServices()` internally

Both paths share `teardownLaunchdServices()` as the authoritative launchd service cleanup function. `gracefulShutdown` is idempotent (second call is a no-op) and has an 8-second hard timeout (`process.exit(1)` if teardown hangs).

### Startup attach and version detection

On startup, `bootstrapWithLaunchd()` reads `runtime-ports.json` to decide whether to attach to already-running services or do a fresh cold start. The attach decision uses a multi-field identity check:
- `appVersion` — refuse attach if the app was updated (missing field = mismatch, conservative)
- `userDataPath` — refuse attach across different Electron userData roots
- `buildSource` — refuse attach across packaged/dev/beta builds
- `openclawStateDir` — refuse attach across different state directories
- `NEXU_HOME` — refuse attach across different home directories

If any identity field mismatches, stale services are auto-booted-out and a fresh cold start is performed (transparent to the user, ~2-3s slower).

### Update install safety

`update-manager.ts` uses an evidence-based install decision:
1. `teardownLaunchdServices()` — bootout launchd services, kill orphans
2. `orchestrator.dispose()` — stop managed child processes
3. `ensureNexuProcessesDead()` — two sweeps of SIGKILL (15s + 5s), using both launchd labels and pgrep
4. `checkCriticalPathsLocked()` — `lsof +D` check on .app bundle, runner, and sidecar dirs
5. Decision: no critical locks → install; critical paths locked → skip this attempt (electron-updater retries next launch)

### Desktop stability testing

The desktop test suite includes real launchd integration tests that run on macOS CI runners:
- `tests/desktop/launchd-integration.test.ts` — real `launchctl` commands, real processes (skipped on non-macOS)
- `tests/desktop/entitlements-plist.test.ts` — V8 JIT entitlement regression guard (value-level assertions)
- `tests/desktop/daemon-supervisor-restart.test.ts` — circuit breaker logic (MAX_CONSECUTIVE_RESTARTS=10)
- `tests/desktop/launchd-bootstrap-lifecycle.test.ts` — stale session detection, web port retry
- `tests/desktop/launchd-manager-bootout.test.ts` — bootoutService error tolerance
- `scripts/launchd-lifecycle-e2e.sh` — shell-based e2e: bootstrap → verify → teardown → orphan cleanup → re-bootstrap
- `scripts/desktop-stop-smoke.sh` — post-stop verification: no residual processes, free ports, no stale state
- `tests/desktop/data-directory-runtime.test.ts` — verifies every plist env var value by calling real `generatePlist()`
- `tests/desktop/dev-toolchain-invariants.test.ts` — guards against desktop dev-launch regressions (tools/dev platform helpers remain the single desktop launch decision point, launchd manifests keep `ELECTRON_RUN_AS_NODE`, etc.)

## Hard rules

- **Debugging first principle: binary isolate, don't guess.** For UI/runtime regressions, start with overall bisection and add tiny reversible `quick return` / `quick fail` probes at key boundaries. Prefer changes that create obvious UI/log differences, narrow the fault domain quickly, and can be reverted immediately after verification. Do not start by rewriting route guards, state flows, or core logic based on intuition.
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
- Windows packaging split: use `pnpm dist:win` for the full installer/release path and keep it close to CI semantics. Use `pnpm dist:win:local` for local Windows validation when you need fast iteration; it is intentionally dir-only and reuse-first, so it is not a substitute for the full release build.
- Controller sidecar packaging: every dependency in `apps/controller/package.json` is recursively deep-copied into the desktop distributable via `prepare-controller-sidecar` → `copyRuntimeDependencyClosure`. **Never add heavy transitive-dependency packages (e.g. `npm`, `yarn`) to the controller.** If the controller needs to shell out to a CLI tool, use PATH-based `execFile("npm", ...)` instead of bundling it as a dependency. Each MB added to controller deps adds ~1 MB to the final DMG/ZIP.
- Native Node.js addons (e.g. `better-sqlite3`) must live in the controller, NOT in the desktop Electron main process. Electron's built-in Node.js has a different ABI version (NODE_MODULE_VERSION) from system Node.js, requiring `electron-rebuild` to recompile native modules. The controller runs as a regular Node.js process (`ELECTRON_RUN_AS_NODE=1`), so native addons work without recompilation.
- **OpenClaw provider/model registry is not hot-reload-safe.** Any code path that mutates `models.providers` in `openclaw.json` (cloud login/logout, BYOK add/delete/bulk-update, OAuth connect/disconnect) MUST call `openclawProcess.restart(reason)` after `syncAll()`. OpenClaw builds its registry once at boot; writing the file is not enough. In packaged desktop OpenClaw is supervised by launchd, so `openclawProcess.stop()/start()` is a silent no-op — `restart()` routes through `launchctl kickstart -k` automatically. Always smoke-test provider-lifecycle changes in the packaged build, not just `pnpm dev`. See `specs/design-docs/2026-04-14-openclaw-registry-cache-invalidation.md`.

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
- Local runtime flow: `apps/controller` owns Nexu config/state, writes OpenClaw config/skills/templates, and manages the slimclaw-backed OpenClaw runtime contract directly; desktop wraps that controller-first stack with Electron + web sidecars
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
| OpenClaw error handling & compaction | `specs/references/openclaw-error-handling-internals.md` |
| OpenClaw registry cache invalidation (restart-on-provider-change) | `specs/design-docs/2026-04-14-openclaw-registry-cache-invalidation.md` |
| Engineering principles | `specs/design-docs/core-beliefs.md` |
| Config schema & pitfalls | `specs/references/openclaw-config-schema.md` |
| API coding patterns | `specs/references/api-patterns.md` |
| Workspace templates | `specs/guides/workspace-templates.md` |
| Local Slack smoke probe | `scripts/probe/README.md`, `scripts/probe/slack-reply-probe.mjs` |
| Local dev CLI guidance | `tools/dev/AGENTS.md` |
| Frontend conventions | `specs/FRONTEND.md` |
| Desktop runtime guide | `specs/guides/desktop-runtime-guide.md` |
| Desktop update testing guide | `specs/guides/desktop-update-testing.md` |
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
| Desktop shutdown & lifecycle | `apps/desktop/main/index.ts` (`gracefulShutdown`), `apps/desktop/main/services/quit-handler.ts` (`runTeardownAndExit`) |
| Launchd service management | `apps/desktop/main/services/launchd-manager.ts`, `apps/desktop/main/services/launchd-bootstrap.ts` |
| External runner extraction | `apps/desktop/main/services/launchd-bootstrap.ts` (`ensureExternalNodeRunner`, `resolveLaunchdPaths`) |
| Desktop auto-updater | `apps/desktop/main/updater/update-manager.ts` (`checkCriticalPathsLocked`, `ensureNexuProcessesDead`) |
| Entitlements (V8 JIT) | `apps/desktop/build/entitlements.mac.plist`, `apps/desktop/build/entitlements.mac.inherit.plist` |
| Dev launch scripts | `scripts/dev-launchd.sh`, `tools/dev/src/services/desktop.ts`, `tools/dev/src/shared/platform/desktop-dev-platform.*` |
| Launchd stability tests | `tests/desktop/launchd-integration.test.ts`, `scripts/launchd-lifecycle-e2e.sh` |
| Entitlements regression tests | `tests/desktop/entitlements-plist.test.ts` |
| Stop smoke test | `scripts/desktop-stop-smoke.sh` |

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
- Fresh local-dev cold start: `pnpm install` -> `pnpm --filter @nexu/shared build` -> optional `copy tools/dev/.env.example tools/dev/.env` (Windows) or `cp tools/dev/.env.example tools/dev/.env` (POSIX) -> `pnpm dev start`
- Daily local-dev flow: `pnpm dev start` -> `pnpm dev logs <service>` / `pnpm dev status <service>` when needed -> `pnpm dev restart` for a clean recycle -> `pnpm dev stop`
- Desktop inspect quick checks: `pnpm dev inspect screenshot`, `pnpm dev inspect eval "document.title"`, `pnpm dev inspect dom --max-html-length 1200`, `pnpm dev inspect logs --limit 20`
- Desktop proxy env vars: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (desktop normalizes mixed-case inputs, always merges `localhost,127.0.0.1,::1` into `NO_PROXY`, and propagates uppercase values to child processes)
- OpenClaw managed skills dir (expected default): `~/.openclaw/skills/`
- Slack smoke probe setup: install Chrome Canary, set `PROBE_SLACK_URL`, run `pnpm probe:slack prepare`, then manually log into Slack in Canary before `pnpm probe:slack run`
- the slimclaw-managed prepared OpenClaw runtime is installed implicitly by `pnpm install`; local development should normally not use a global `openclaw` CLI
- Full-stack startup order is `openclaw` -> `controller` -> `web` -> `desktop`; shutdown order is the reverse
- Prefer `./openclaw-wrapper` over global `openclaw` in local development; it resolves the prepared runtime entry through slimclaw and executes that local OpenClaw CLI entry
- When OpenClaw is started manually, set `RUNTIME_MANAGE_OPENCLAW_PROCESS=false` for `@nexu/controller` to avoid launching a second OpenClaw process
- If behavior differs, verify effective `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` used by the running controller process.
