# Desktop Runtime Guide

This guide covers desktop-specific working rules, structure, and troubleshooting for `apps/desktop`.

## Observability boundary

- Optimize first for agent/debugging efficiency, not human-facing control panel UX.
- Prefer changes inside `apps/desktop/main/`, `apps/desktop/src/`, and `apps/desktop/shared/` when improving local runtime observability.
- Desktop-internal observability changes may be relatively aggressive when they improve structured diagnostics, event correlation, runtime state introspection, or local log transport reliability.
- Keep the boundary strict for `apps/web` and `apps/controller`: default to no changes.
- If touching `apps/web` or `apps/controller` is unavoidable for desktop observability work, limit the change to logging only: log fields, log level, stable reason codes, or propagation of desktop correlation ids.
- Do not use desktop observability work as a reason to refactor behavior, state models, or interfaces in `apps/web` or `apps/controller`.
- Prefer machine-queryable diagnostics over presentation-oriented additions: structured events, reason codes, action ids, session/boot correlation ids, and incremental event streams.

## Directory structure

- `apps/desktop/main/` — Electron main-process code: app bootstrap, IPC registration, runtime orchestration, updater integration, and file/log side effects.
- `apps/desktop/main/runtime/` — Local runtime supervision only: manifests, unit lifecycle, structured runtime logging, probes, and process state transitions.
- `apps/desktop/preload/` — Narrow bridge surface between Electron main and renderer. Keep it thin and explicit.
- `apps/desktop/src/` — Renderer UI only. Prefer consuming typed host APIs instead of embedding Electron/runtime knowledge directly in components.
- `apps/desktop/src/lib/` — Renderer-side adapters for host bridge calls and desktop-specific client helpers.
- `apps/desktop/shared/` — Contracts shared by main/preload/renderer, including host API types and runtime config structures. Prefer putting cross-boundary types here first.
- `apps/desktop/scripts/` — Build, packaging, and sidecar preparation scripts. Keep runtime behavior out of these scripts unless it is strictly packaging-related.
- `apps/controller/src/services/skillhub/` — SkillHub catalog/install/uninstall logic. Runs in the controller process, served via HTTP. The web app uses the HTTP SDK — never IPC.
- Keep process-management logic out of renderer files; keep presentation logic out of `main/`; keep cross-boundary DTOs out of feature-local files when they are shared by IPC.

## Controller sidecar packaging

The controller is bundled into the desktop distributable as a sidecar. The script `apps/desktop/scripts/prepare-controller-sidecar.mjs` uses `copyRuntimeDependencyClosure` to recursively deep-copy every `dependency` from `apps/controller/package.json` (and all their transitive deps) into `.dist-runtime/controller/node_modules/`.

**Rules:**

- **Keep controller deps minimal.** Each MB in controller `dependencies` adds ~1 MB to the final DMG/ZIP.
- **Never add heavy CLI tool packages** (e.g. `npm`, `yarn`) as controller dependencies. If the controller needs to invoke a CLI tool, use PATH-based `execFile("npm", ...)` instead.
- **Native Node.js addons** (e.g. `better-sqlite3`) must live in the controller, NOT in the Electron main process. Electron's built-in Node.js uses a different ABI version (`NODE_MODULE_VERSION`) from system Node.js, which causes "compiled against a different Node.js version" errors. The controller runs as a regular Node.js process (`ELECTRON_RUN_AS_NODE=1`), so native addons work without `electron-rebuild`.

**Before adding a controller dependency**, check its size:
```bash
du -sh node_modules/.pnpm/<pkg>@*/node_modules/<pkg>/
```
If total size (including transitive deps) exceeds ~5 MB, consider alternatives: PATH-based invocation, optional dependencies, or lazy runtime download.

## Common troubleshooting

- `a locally packaged app needs build-time overrides`
  - Put local-only packaged-app settings in `apps/desktop/.env` and keep that file untracked.
  - Start from `apps/desktop/.env.example`.
  - `apps/desktop/scripts/dist-mac.mjs` reads `apps/desktop/.env` during packaging and bakes those values into `apps/desktop/build-config.json` for the packaged app to read at runtime.
  - Use this for packaged-app-only flags such as `NEXU_DESKTOP_AUTO_UPDATE_ENABLED=false` when you want a local build to skip update checks.
  - Use `NEXU_DESKTOP_RELEASE_DIR=/absolute/output/path` when you want packaged artifacts written somewhere other than `apps/desktop/release`.

- `desktop won't cold start`
  - Start with `pnpm logs` and `./apps/desktop/dev.sh devlog`.
  - Then inspect `cold-start.log`, `desktop-main.log`, and `logs/runtime-units/*.log` under the desktop logs directory.
  - If the issue looks power-management related, inspect `desktop-diagnostics.json` `sleepGuard` plus `desktop-main.log` entries with `source=sleep-guard` to confirm the blocker type, power-source transitions, and whether a `suspend` was still observed.
  - Correlate by `desktop_boot_id` first, then `desktop_session_id` if auth/session recovery is involved.
  - If `tmux session 'nexu-desktop' is not running` immediately after start, verify `pnpm -C apps/desktop exec electron --version` succeeds.
  - If `pnpm exec electron` works but `pnpm run start:electron` fails to resolve `electron/cli.js`, prefer `pnpm exec electron .` inside `apps/desktop/package.json` and then rebuild from the standard `pnpm start` path.

- `a runtime unit looks running but behavior is broken`
  - Check the unit's structured lifecycle/probe logs in `apps/desktop/main/runtime/` outputs before changing UI.
  - Verify whether the issue is process presence, port readiness, auth bootstrap, or delegated-process detection.
  - Prefer fixing state/probe semantics in the orchestrator instead of adding renderer-side heuristics.

- `control panel state looks stale or noisy`
  - Inspect `apps/desktop/main/runtime/daemon-supervisor.ts` first, especially polling, probe, and state-transition logging paths.
  - Reduce duplicate event emission in main process before adding renderer filtering.

- `you need a deeper runtime event query than the control panel shows`
  - Keep the control panel minimal; use the host query interface instead of adding temporary UI.
  - Query through the desktop bridge with `runtime:query-events` / `queryRuntimeEvents(...)` and filter by `unitId`, `actionId`, `reasonCode`, `afterCursor`, and `limit`.
  - Treat `cursor` as the incremental checkpoint for agent/debug sessions; use `nextCursor` to continue from the last seen event instead of re-reading a whole tail.
  - Prefer event queries for chain reconstruction; keep `RuntimeUnitState` focused on only the highest-value current signals.

- `desktop observability work starts touching api/web/gateway`
  - Re-check the observability boundary above.
  - Default answer is to move the change back into desktop unless the only missing piece is a log field, level, reason code, or correlation id.

- `unclear where a new type or helper belongs`
  - If it crosses main/preload/renderer boundaries, put it in `apps/desktop/shared/`.
  - If it only affects runtime supervision, keep it in `apps/desktop/main/runtime/`.
  - If it only changes UI rendering, keep it in `apps/desktop/src/`.
