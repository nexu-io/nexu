# Desktop Build / Runtime Follow-up

## Current branch

- `fix/desktop-build-runtime`

## Latest commit

- `ef3be4a` `refactor(desktop): split runtime shell and add startup timing`

## Completed in this session

- Added packaged desktop build-time env support:
  - `NEXU_DESKTOP_AUTO_UPDATE_ENABLED`
  - `NEXU_DESKTOP_RELEASE_DIR`
- Kept `NEXU_DESKTOP_AUTO_UPDATE_ENABLED` default behavior as enabled unless explicitly set to `false` / `0`
- Added local packaged-app override documentation via `apps/desktop/.env.example`
- Added startup timing instrumentation for the pre-Electron gap:
  - `apps/desktop/dev.sh`
  - `apps/desktop/main/index.ts`
- Verified new startup timeline logs:
  - `.tmp/logs/desktop-startup-timeline.log`
  - `.tmp/desktop/electron/logs/desktop-main.log`
- Temporarily implemented a startup loading page, then removed it per request
- Kept only the startup logging instrumentation, not the loading UI
- Refactored `apps/desktop/src/main.tsx` into smaller modules:
  - `apps/desktop/src/components/desktop-shell.tsx`
  - `apps/desktop/src/components/surface-button.tsx`
  - `apps/desktop/src/components/surface-frame.tsx`
  - `apps/desktop/src/components/summary-card.tsx`
  - `apps/desktop/src/components/runtime-unit-card.tsx`
  - `apps/desktop/src/components/diagnostics-action-card.tsx`
  - `apps/desktop/src/hooks/use-runtime-state.ts`
  - `apps/desktop/src/hooks/use-desktop-runtime-config.ts`
  - `apps/desktop/src/lib/runtime-formatters.ts`
  - `apps/desktop/src/lib/runtime-state.ts`
  - `apps/desktop/src/pages/runtime-page.tsx`
  - `apps/desktop/src/pages/diagnostics-page.tsx`
- Verified desktop manual smoke check looked OK
- Unified desktop runtime paths under a single root:
  - dev root: `.tmp/desktop/electron`
  - packaged root: `~/Library/Application Support/@nexu/desktop`
- Moved desktop main logs, diagnostics, and runtime-unit logs under `<desktop-root>/logs`
- Set packaged/session storage under `<desktop-root>/session`
- Added explicit packaged user-data override support:
  - `NEXU_DESKTOP_USER_DATA_ROOT`
- Updated packaged verification to pass an absolute desktop root override instead of relying on `HOME`
- Verified packaged output and isolated packaged runtime check after the path changes

## Key findings so far

- The biggest startup cost is still `build_runtime` in `apps/desktop/dev.sh`
- The previously unclear gap between wrapper startup and Electron process launch is now measurable
- On recent runs:
  - `tmux session created` -> `electron main module evaluated`: about `1.1s - 1.3s`
  - `electron main module evaluated` -> `main window ready-to-show`: about `0.25s - 0.35s`
- Cold-start slowness after `reset-state` is mainly from:
  - fresh PGlite migrations
  - gateway/openclaw config sync and deferred Feishu config injection
- Relevant gateway log markers:
  - `rewrote config file to trigger watcher`
  - `applied new pool config`
  - `deferred feishu config injected via hot-reload`

## Custom packaged build behavior

- `apps/desktop/scripts/dist-mac.mjs` now supports:
  - `NEXU_DESKTOP_RELEASE_DIR=/absolute/path`
- Verified output to:
  - `/Users/zqxy123/Downloads/nexu-local-release`
- `apps/desktop/release` old artifacts were cleaned afterward

## Packaged path behavior

- Default packaged desktop root is now:
  - `~/Library/Application Support/@nexu/desktop`
- Packaged verification uses an isolated absolute override root:
  - `.tmp/desktop-dist-home/Library/Application Support/@nexu/desktop`
- Expected packaged layout under the desktop root:
  - `logs/desktop-main.log`
  - `logs/cold-start.log`
  - `logs/desktop-diagnostics.json`
  - `logs/runtime-units/*.log`
  - `runtime/`
  - `session/`
  - `components/`
  - `startup-health.json`
  - `Crashpad/`
- Important implementation note:
  - packaged path calculation must not depend on `process.env.HOME`
  - use Electron `appData` by default and only use `NEXU_DESKTOP_USER_DATA_ROOT` for explicit test overrides

## Validation completed in this session

- `pnpm --filter @nexu/desktop typecheck`
- `pnpm desktop:dist:mac:unsigned`
- `env NEXU_DESKTOP_RELEASE_DIR="/Users/zqxy123/Downloads/nexu-local-release" pnpm desktop:check:dist`
- `pnpm desktop:check:dev`
- Packaged runtime health verification passed with the unified path layout

## Current repo state

- Desktop dev instance is stopped
- Last check:
  - `pnpm desktop:status` -> `tmux session 'nexu-desktop' is not running`

## Suggested next focus

- Continue local packaged-build and runtime defect hunting
- Prioritize:
  1. packaged app auto-update / feed behavior
  2. packaged runtime first-launch behavior and state restore
  3. sidecar path / build-config / env injection correctness
  4. startup path optimization around gateway deferred config injection

## Useful commands

- Start desktop dev:
  - `pnpm desktop:start`
- Restart desktop dev:
  - `pnpm desktop:restart`
- Stop desktop dev:
  - `pnpm desktop:stop`
- Reset desktop state:
  - `./apps/desktop/dev.sh reset-state`
- Build unsigned mac package:
  - `pnpm desktop:dist:mac:unsigned`

## Useful log files

- `.tmp/logs/desktop-dev.log`
- `.tmp/logs/desktop-startup-timeline.log`
- `.tmp/desktop/electron/logs/desktop-main.log`
- `.tmp/desktop/electron/logs/cold-start.log`
- `.tmp/desktop/electron/logs/runtime-units/pglite.log`
- `.tmp/desktop/electron/logs/runtime-units/gateway.log`
- `.tmp/desktop-ci-test/packaged-app.log`
- `.tmp/desktop-dist-home/Library/Application Support/@nexu/desktop/logs/desktop-main.log`
- `.tmp/desktop-dist-home/Library/Application Support/@nexu/desktop/logs/cold-start.log`
- `.tmp/desktop-dist-home/Library/Application Support/@nexu/desktop/logs/runtime-units/api.log`
