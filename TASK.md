# Handoff Notes

## Branch

- Current branch: `feat/local-dev-workflow-optimization`
- Branch pushed to: `origin/feat/local-dev-workflow-optimization`
- Latest commit from before this session: `01bd29a` `refactor: clarify scripts dev module boundaries`
- Workspace status at handoff: code changes for desktop/controller/scripts-dev integration plus this `TASK.md` update

## What Changed In This Session

### Desktop runtime ownership was split into `external | internal`

- `apps/desktop/shared/runtime-config.ts` now exposes `runtimeMode: "external" | "internal"`
- `apps/desktop/main/platforms/shared/runtime-common.ts` now has an external runtime adapter path
- `apps/desktop/main/platforms/index.ts` selects an external adapter when desktop is launched in external mode
- `apps/desktop/main/runtime/manifests.ts` marks `web`, `controller`, and `openclaw` runtime units as `external` when desktop is attaching instead of owning processes
- `apps/desktop/main/runtime/daemon-supervisor.ts` now probes external runtime units by port and reports external availability state instead of trying to manage them
- `apps/desktop/main/index.ts` logs the effective desktop runtime mode and the external runtime targets during cold start

### Controller OpenClaw ownership was split into `external | internal`

- `apps/controller/src/app/env.ts` now accepts:
  - `NEXU_CONTROLLER_OPENCLAW_MODE=external|internal`
  - `OPENCLAW_BASE_URL`
  - `OPENCLAW_LOG_DIR`
- Legacy `RUNTIME_MANAGE_OPENCLAW_PROCESS` is now treated as a compatibility input; the effective owner is derived from the explicit mode when present
- `apps/controller/src/runtime/gateway-client.ts`, `apps/controller/src/runtime/runtime-health.ts`, and `apps/controller/src/runtime/openclaw-ws-client.ts` now connect through `OPENCLAW_BASE_URL` instead of hard-coded `127.0.0.1:${port}`
- `apps/controller/src/app/bootstrap.ts` now logs the runtime contract and only starts OpenClaw when controller is in `internal` mode
- `apps/controller/src/services/model-provider-service.ts` and `apps/controller/src/services/desktop-local-service.ts` now skip runtime restarts when controller is attached to an external OpenClaw instance
- `apps/controller/src/runtime/openclaw-process.ts` now exposes `managesProcess()` so ownership checks are explicit at call sites

### `scripts/dev` now owns OpenClaw local-dev startup

- Added `scripts/dev/src/shared/dev-runtime-config.ts`
  - reads `scripts/dev/.env` when present
  - defines the cross-service local-dev contract for ports, URLs, state dirs, config path, log dir, and gateway token
- Added `scripts/dev/.env.example` as the source-of-truth example for dev-only external injection
- Added `scripts/dev/src/services/openclaw.ts`
- Added `scripts/dev/src/supervisors/openclaw.ts`
- Updated `scripts/dev/src/index.ts` so `pnpm dev start|restart|stop|status|logs` now includes `openclaw`
- Updated existing `scripts/dev` controller/web assembly to consume injected values from `scripts/dev/.env` instead of assuming only hard-coded defaults

### `scripts/dev` now also owns desktop local-dev attach

- Added `scripts/dev/src/services/desktop.ts`
- Updated `scripts/dev/src/index.ts` so `pnpm dev start|restart|stop|status|logs` now includes `desktop`
- Added desktop-specific `scripts/dev` state/log plumbing:
  - `.tmp/dev/desktop.pid`
  - desktop log access wired to `.tmp/dev/logs/<run_id>/desktop.log`
- `scripts/dev` command routing no longer has implicit aggregate defaults for `start | status | stop | restart`
  - these commands now require an explicit single-service target: `desktop | openclaw | controller | web`
  - aggregate target `all` is rejected
  - example: `pnpm dev start openclaw`, `pnpm dev status desktop`, `pnpm dev stop web`
- `pnpm dev logs <service>` is now session-scoped and tail-oriented:
  - logs are resolved from the active service session only
  - output is capped to the last 200 lines by default
  - the CLI prints a fixed header with the tail policy, session line count, and actual log file path before log content
- Desktop local dev now starts Electron directly from `scripts/dev`
  - the old `scripts/desktop-dev.mjs` -> `apps/desktop/scripts/dev-cli.mjs` launcher chain is deleted
  - desktop session logs now live under `.tmp/dev/logs/<run_id>/desktop.log` like the other services
  - desktop pid locks now store `launchId` directly inside the service lock
- The old desktop local-dev system is intentionally not backward compatible anymore
  - `pnpm start` now fails because that script no longer exists
  - `apps/desktop/dev.sh` and `apps/desktop/scripts/dev-cli.mjs` are deleted
  - validation helpers now invoke explicit `pnpm dev start|stop <service>` commands only
- Two outdated root dev aliases were also removed:
  - `dev:controller`
  - `dev:desktop`
- Root `AGENTS.md` and `scripts/dev/AGENTS.md` were updated to describe the explicit per-service local-dev workflow, the lack of an `all` target, and the new session-scoped logging contract
- Cleaned obvious old script-managed dev wording in service errors so each service now points to the matching explicit stop command (`pnpm dev stop <service>`)
- `apps/desktop/main/bootstrap.ts` now respects a pre-injected `NEXU_HOME` in local dev instead of always forcing the desktop-local fallback path
- Root `package.json` no longer exposes the old `pnpm start|stop|restart|status|logs|reset-state` desktop launcher scripts

### Small controller-chain robustness fix

- `apps/controller/src/runtime/openclaw-config-writer.ts` now derives a fallback state dir from `openclawConfigPath` when the full env shape is not present, which fixed the related config-writer regression in tests

## Validation Already Done

- `pnpm --filter @nexu/desktop typecheck` passed
- `pnpm --filter @nexu/desktop build` passed earlier in the session after the desktop external-runtime split
- `pnpm --filter @nexu/controller typecheck` passed
- `pnpm --filter @nexu/controller build` passed
- `pnpm --dir ./scripts/dev exec tsc --noEmit` passed
- Root-entrypoint local-dev acceptance for explicit per-service local-dev flow passed:
  - `pnpm dev status all` rejects `all` as intended
  - `pnpm dev start openclaw`
  - `pnpm dev logs openclaw`
  - `pnpm dev start controller`
  - `pnpm dev logs controller`
  - `pnpm dev start web`
  - `pnpm dev logs web`
  - `pnpm dev start desktop`
  - `pnpm dev logs desktop`
  - `pnpm dev stop desktop`
  - `pnpm dev stop web`
  - `pnpm dev stop controller`
  - `pnpm dev stop openclaw`
- Follow-up doc / cleanup validation passed:
  - `pnpm --dir ./scripts/dev exec tsc --noEmit`
  - grep audit across `AGENTS.md`, `scripts/dev/AGENTS.md`, and `scripts/dev/src/` for stale implicit-aggregate command wording
- Direct desktop supervisor validation passed:
  - `pnpm dev stop desktop`
  - `pnpm dev start desktop`
  - `pnpm dev logs desktop`
  - `pnpm dev status desktop`
- Legacy launcher removal validation passed:
  - `pnpm start` now fails with `ERR_PNPM_NO_SCRIPT_OR_SERVER` as intended
  - `pnpm --filter @nexu/desktop typecheck`
  - `pnpm dev restart desktop`
  - `pnpm dev logs desktop`
- Root alias removal is committed and pushed on `feat/local-dev-workflow-optimization`
  - latest commit at handoff: `5adcbe3` (`refactor: remove legacy desktop dev launchers`)
- Verified controller now boots in `external` OpenClaw mode and successfully reaches `openclaw_ws_connected` through the `scripts/dev`-managed OpenClaw process
- `pnpm lint` still fails, but only on pre-existing repo-wide Biome formatting drift unrelated to this branch
- `pnpm test` still fails, but the observed failures are pre-existing desktop cross-platform/path test issues unrelated to this branch

## Important Current Behavior

- OpenClaw local dev is now expected to be orchestrated by `scripts/dev`, not by its own dedicated `.env`
- `scripts/dev/.env` is intended to become the single dev-only source of truth for cross-service injected runtime values
- Controller local dev is already consuming OpenClaw through that external contract when launched via `scripts/dev`
- Desktop local dev is now started/stopped through `scripts/dev` in `external` mode and attaches to the `scripts/dev`-managed controller/web/openclaw stack
- `pnpm dev start|status|stop|restart` now require an explicit single-service target; `all` is intentionally unsupported
- `pnpm dev logs <service>` only works for the active session of that service and prints at most the last 200 lines, prefixed with a fixed metadata header
- Desktop launched via `scripts/dev` now goes straight through Electron + pid lock supervision instead of the extra `dev-cli` wrapper layer
- Desktop session logs launched via `scripts/dev` now use `.tmp/dev/logs/<run_id>/desktop.log`
- The old desktop launcher model is abolished; local desktop development is now only supported through explicit `pnpm dev <command> <service>` flows
- Root `package.json` no longer exposes the old desktop launcher scripts or the old `dev:controller` / `dev:desktop` aliases
- Remaining old-command references are documentation debt only in historical design/plan docs, not active executable paths

## Known Existing Issues

- `pnpm lint` still fails due to pre-existing repo-wide Biome formatting issues unrelated to this branch
- `pnpm --filter @nexu/controller test` still has pre-existing failures not introduced by this session:
  - `tests/nexu-config-store.test.ts`
  - `tests/openclaw-sync.test.ts`
  - `tests/openclaw-runtime-plugin-writer.test.ts` (Windows symlink permission issue)
- `pnpm test` still has additional pre-existing desktop failures on Windows path expectations / filesystem assumptions (launchd, plist, state migration, skill path, runtime manifest, skill DB migration)

## Suggested Next Steps

1. Decide whether any per-service dependency guardrails are needed when users start `controller` or `desktop` without their expected upstream services already running
2. Add the missing OpenClaw runtime-root/runtime-port contract that desktop still expects in external mode so the current `Missing external runtime port` warning disappears
3. Continue tightening the `scripts/dev/.env` contract so every external injection is documented, named consistently, and traced to a single owner
4. Optionally do a historical-doc cleanup pass for old `pnpm start` / `pnpm restart` references that no longer map to executable paths
