# Handoff Notes

## Branch

- Current branch: `feat/launchd-encapsulation-strategy`
- Branched from: `feat/windows-distribution-smoke`
- Base branch state already includes:
  - merge of `origin/main` into `feat/windows-distribution-smoke`
  - `scripts/dev` as the primary HMR-first local-dev control surface
  - desktop dev auth-session compat fix (`/api/auth/get-session`)
  - unified `scripts/dev` logger using `pino`
- Workspace status at handoff: clean branch transition plus this `TASK.md` refresh

## What Was Stabilized Before This Branch

### `scripts/dev` remains the primary local-dev entrypoint

- `pnpm dev start` / `stop` / `restart` drive the lightweight stack
- `pnpm dev stop` is now idempotent at the default stack level
- already-stopped services now emit informational output instead of hard-failing the aggregate stop flow
- service raw logs remain under `.tmp/dev/logs/<run_id>/<service>.log`

### Desktop dev login flow was repaired

- `apps/controller/src/routes/desktop-compat-routes.ts` now exposes `GET /api/auth/get-session`
- this restores desktop-local auth session resolution for the embedded webview in dev
- login -> workspace navigation was verified after the fix

### Merge of `origin/main` into the Windows distribution branch was completed

- the merge was completed on `feat/windows-distribution-smoke`
- the merged result was validated enough to confirm no obvious blocker in the HMR-first local-dev path
- a few merge follow-up fixes were required and were applied:
  - `apps/desktop/main/index.ts`
    - fixed `registerIpcHandlers(...)` argument order so `diagnosticsReporter` is passed correctly
  - `apps/desktop/main/runtime/manifests.ts`
    - restored/exported `ensurePackagedOpenclawSidecar(...)` in the new platform-capability shape
  - `apps/desktop/main/services/launchd-bootstrap.ts`
    - adapted packaged OpenClaw sidecar lookup to use `getDesktopRuntimePlatformAdapter().capabilities`

### `scripts/dev` logging was unified

- `packages/dev-utils/src/logger.ts` now provides the shared `createDevLogger()` factory
- `scripts/dev/src/shared/logger.ts` owns the single root logger for `scripts/dev`
- `scripts/dev` control-plane logging now uses `logger.debug/info/warn/error`
- `packages/dev-utils/src/spawn.ts` accepts an explicit `logger?: DevLogger`
- `scripts/dev/.env.example` now includes:
  - `NEXU_DEV_LOG_LEVEL=info`
  - `NEXU_DEV_LOG_PRETTY=false`
- important constraint preserved:
  - `<service>.log` files still contain only raw service output
  - `scripts/dev` control-plane logs are not mixed into service raw logs

## Important Current Behavior

- `pnpm dev` remains the canonical local-dev control surface
- `scripts/dev` is still HMR-first and should remain the baseline for future local-dev work
- `pnpm dev logs <service>` still reads the raw active-session log for that service
- `NEXU_DEV_LOG_PRETTY` controls pretty terminal logging for the `scripts/dev` control plane only
- the current branch should treat launchd-related work as follow-up architecture work, not as a reason to regress the validated `scripts/dev` baseline

## Known Observations

- OpenClaw startup duration on Windows still shows occasional variance
  - dense timing probes currently remain in place around the hidden-launch path and OpenClaw startup timing
  - recent measurements showed normal starts in the low-seconds range, but longer outliers were also observed earlier
  - treat this as a separate observation, not yet a proven structural regression
- root `pnpm install` on this Windows machine still hits a pre-existing `scripts/postinstall.mjs` `spawn EINVAL` problem
  - this was observed while installing `pino` / `pino-pretty`
  - it is not part of the `scripts/dev` logging design itself

## Next Focus For The New Session

### Primary goal: unify launchd feature encapsulation strategy

- review the merged `launchd` surface and decide what still belongs in:
  - `apps/desktop/main/services/launchd-bootstrap.ts`
  - `apps/desktop/main/services/quit-handler.ts`
  - `apps/desktop/main/runtime/manifests.ts`
  - `apps/desktop/scripts/*sidecar*.mjs`
- define a cleaner boundary between:
  - packaged/launchd runtime responsibilities
  - `scripts/dev` local-dev responsibilities
  - desktop main-process orchestration glue
- avoid broad refactors outside that encapsulation target unless they are required to keep current behavior working

### Recommended starting points

1. Audit launchd-specific capabilities that are still spread across bootstrap/runtime/script layers
2. Decide which launchd responsibilities should be encapsulated behind one cohesive service boundary
3. Preserve the current HMR-first `scripts/dev` baseline while tightening launchd internals behind clearer APIs

### Proposed execution phases

#### Phase 1: define the lifecycle-oriented platform boundary

- define a platform lifecycle entry that covers more than cold start
- explicitly separate:
  - platform identity (`mac` / `win` / `default`)
  - runtime residency strategy (`launchd` / managed / future external-service variants)
- decide the target responsibilities that should move behind the lifecycle adapter:
  - runtime materialization
  - cold start / attach / stale-session recovery
  - shutdown / backgrounding policy
  - update-install teardown and safety checks
  - session metadata persistence (today: `runtime-ports.json`)
- keep behavior unchanged in this phase whenever possible; focus on interface shape and ownership

#### Phase 2: move mac launchd lifecycle logic behind the new entry

- migrate current mac launchd behavior to the new lifecycle boundary without changing validated behavior
- reduce `apps/desktop/main/services/launchd-bootstrap.ts` from a catch-all module into smaller mac launchd-specific units
- make `quit-handler`, updater teardown, and recovery paths depend on the new lifecycle entry instead of calling launchd-specific helpers directly
- preserve the current packaged mac behavior:
  - attach to existing launchd-managed services
  - stale session cleanup
  - background run vs quit completely
  - update-safe teardown

#### Phase 3: separate runtime unit definition from platform-specific supervision

- identify the shared runtime unit contract that is currently duplicated between:
  - `apps/desktop/main/runtime/manifests.ts`
  - `apps/desktop/main/services/plist-generator.ts`
- introduce a platform-neutral runtime unit spec that can be translated into:
  - managed/orchestrator manifests
  - mac launchd service definitions
  - future Windows or other platform supervisor definitions
- minimize duplicated env/path contract maintenance across managed and launchd flows

#### Phase 4: isolate packaged-runtime materialization responsibilities

- split packaged sidecar / runner extraction responsibilities out of launchd bootstrap flow
- clarify ownership for:
  - packaged OpenClaw sidecar materialization
  - controller sidecar externalization
  - external Electron runner extraction
  - update-safe runtime path layout
- keep `scripts/dev` responsibilities separate from packaged runtime materialization concerns

#### Phase 5: validate mac behavior and lock the adapter seam

- verify mac launchd behavior still works end to end after the refactor
- use the existing launchd-focused tests and smoke paths as the primary regression net
- confirm that the new seam is ready for future Windows adapter work rather than still encoding launchd assumptions in shared APIs
- only after mac behavior is stable, evaluate follow-up extraction work for other platforms

### Current progress snapshot

- Phase 1 and Phase 2 are substantially complete:
  - desktop runtime now routes through a shared lifecycle contract in `packages/shared/src/lifecycle/`
  - `apps/desktop/main/index.ts` is now mostly a lightweight dispatcher that calls `platform.lifecycle.*`
  - mac launchd lifecycle orchestration has been split into platform-local modules under `apps/desktop/main/platforms/mac/`
- platform identity has been tightened:
  - `default` platform identity was removed
  - supported runtime platforms are now only `mac` and `win`
  - unsupported platforms fail fast instead of silently falling back
- platform compatibility logic is now being encoded behind explicit `platform.xxx` surfaces:
  - `platform.lifecycle`
  - `platform.process`
  - `platform.network`
  - `platform.supervisor`
- sidecar/filesystem compatibility logic has started moving from raw `process.platform` checks into platform-facing capability helpers
- pure platform atomics are now being elevated into `packages/shared/src/platform/`
  - keep promoting only pure platform decision helpers and constants there
  - do not move lifecycle orchestration, launchd supervisor code, or business-specific flows into shared

### Remaining follow-up areas

- continue reviewing whether more pure platform atomics can move into `packages/shared/src/platform/`
- keep desktop-specific lifecycle/backends in `apps/desktop/main/platforms/` and `apps/desktop/main/services/`
- validate the mac packaged runtime end-to-end after the refactor:
  - cold start
  - attach to existing services
  - background run vs quit completely
  - update-install teardown
  - stale-session recovery

## Quick Validation Commands

- `pnpm --dir ./scripts/dev exec tsc --noEmit`
- `pnpm dev start`
- `pnpm dev status openclaw`
- `pnpm dev status controller`
- `pnpm dev status web`
- `pnpm dev status desktop`
- `pnpm dev logs <service>`
- `pnpm dev stop`
- `pnpm --filter @nexu/controller build`
- `pnpm --filter @nexu/web build`
- `pnpm --filter @nexu/desktop build`
