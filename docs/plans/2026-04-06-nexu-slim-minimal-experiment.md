# 2026-04-06 nexu-slim minimal Electron + OpenClaw experiment

## Goal

Create a new sibling experiment repo/directory at `nexu.io/nexu-slim/` that keeps the `apps/` + `packages/` monorepo shape but strips the system down to the smallest credible Electron + OpenClaw runtime integration.

This experiment exists to answer one question first:

- can a minimal Electron shell reliably locate, launch, probe, and later package a repo-local OpenClaw runtime without inheriting Nexu's current controller/web/packaging complexity?

## Non-goals

Do **not** carry these into phase 1:

- `apps/controller`
- `apps/web`
- updater / auto-update
- launchd / services
- sidecar packaging/orchestration layers
- payload archive/extraction optimization
- packaging cache/reuse optimization
- full `scripts/pkg` migration work
- shared SDK / API schema generation
- broad abstraction for future reuse

## Final repo topology

```text
nexu-slim/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  README.md

  apps/
    desktop/
      package.json
      tsconfig.json
      main/
        index.ts
        create-window.ts
        runtime-launch.ts
        runtime-probe.ts
        runtime-state.ts
        paths.ts
        diagnostics.ts
        event-buffer.ts
        ipc.ts
      preload/
        index.ts

  packages/
    desktop-renderer/
      package.json
      tsconfig.json
      vite.config.ts
      index.html
      src/
        main.tsx
        app.tsx
        types.ts

    openclaw-runtime/
      package.json
      tsconfig.json
      src/
        index.ts
        install-layout.ts
        launch.ts
        probe.ts

  openclaw-runtime/
    package.json
    package-lock.json
    install-runtime.mjs
    postinstall.mjs
```

## Hard boundaries

### `apps/desktop`

Owns only:

- Electron main process
- BrowserWindow lifecycle
- preload bridge
- runtime start/stop/restart wiring
- minimal diagnostics, event buffering, and IPC probes
- loading renderer dev URL or built files

Must not own:

- renderer source/build config
- OpenClaw business logic
- payload optimization strategy
- complex orchestration framework

### `packages/desktop-renderer`

Owns only:

- Vite
- renderer UI
- minimal debug panel showing runtime facts

Must not own:

- Electron main concerns
- runtime file layout assumptions beyond IPC-returned facts

### repo-root runtime integration helpers

Owns only:

- repo-local runtime path resolution
- launch command assembly
- minimal probe helpers

Must not own:

- download/install optimization
- archive/extract strategy
- packaging/cache policy
- Electron lifecycle
- UI

### top-level `openclaw-runtime/`

Acts as:

- the real upstream/runtime payload host
- a consumed external input boundary

Must not be treated as:

- an internal package to refactor freely
- a place to rebuild Nexu app logic

## Minimal runtime model

The repo-root runtime integration helper layer stays intentionally thin.

Phase 1 API surface should stay near:

- `resolveRepoLocalOpenClawInstallLayout()`
- `spawnOpenClaw()`
- `probeOpenClaw()`

That is enough to support:

- locate runtime package root
- locate runtime entry path
- spawn the runtime
- run `--help` or `--version` probe

No caching, patching, archive shaping, or packaging helpers in phase 1.

## Desktop autonomy support surface

To minimize future intervention, `apps/desktop` should include a small built-in observability/control surface.

### IPC

Queries:

- `runtime:get-state`
- `runtime:get-paths`
- `runtime:get-last-error`
- `runtime:get-last-probe`
- `runtime:get-events`

Actions:

- `runtime:start`
- `runtime:stop`
- `runtime:restart`
- `runtime:probe`

Subscriptions:

- `runtime:on-state-changed`
- `runtime:on-event`

### Diagnostics snapshot

Maintain a single file such as:

- `.tmp/runtime-diagnostics.json`

Include only:

- current runtime state
- resolved paths
- pid
- last probe result
- last error
- recent event buffer

### Event buffer

Maintain a small in-memory ring buffer, e.g. 50 events:

- `spawn-start`
- `spawn-success`
- `spawn-fail`
- `probe-start`
- `probe-success`
- `probe-fail`
- `stop-start`
- `stop-success`
- `stop-fail`
- `state-changed`

## Renderer requirements

The renderer is a debug facts panel, not a product UI.

Show only:

- state
- pid
- runtime entry path
- last probe result
- last error
- recent events

Provide only:

- Start
- Stop
- Restart
- Probe

## Command surface

Keep phase 1 command surface intentionally small.

Root:

- `pnpm dev`
- `pnpm build`
- `pnpm typecheck`
- `pnpm openclaw-runtime:install`
- later: `pnpm probe:runtime`

`@nexu-slim/desktop-renderer`:

- `dev`
- `build`
- `typecheck`

`@nexu-slim/desktop`:

- `dev`
- `build`
- `typecheck`

Do not add `dist:win`, `pkg`, cache modes, or full orchestration subcommands in phase 1.

## Implementation phases

### Phase 1 — local runtime boot loop

Success means:

- renderer dev server starts
- Electron window opens
- desktop resolves repo-local OpenClaw paths
- desktop can run a minimal probe
- desktop can start and stop OpenClaw
- renderer can inspect state through IPC

### Phase 2 — unpacked Windows packaging

Only after phase 1 is stable:

- add minimal Windows packaging to `apps/desktop`
- include OpenClaw payload as simple bundled resources
- verify install/build output can still locate and probe the runtime

### Phase 3 — installer experiment

Only after unpacked packaging works:

- produce a minimal Windows installer
- validate installed layout and post-install probe
- compare payload size and shape against full Nexu desktop output

## Explicit anti-goals for scope control

If any of these appear during implementation, treat them as scope drift:

- reintroducing controller/web
- building a general orchestration framework
- adding packaging optimization before first boot loop works
- abstracting for future multi-runtime support
- copying current Nexu release/CI machinery into slim

## Converged judgment

The cleanest minimal experiment is:

- one Electron app in `apps/desktop`
- one renderer package in `packages/desktop-renderer`
- one thin runtime adapter co-located under repo-root `openclaw-runtime/`
- one top-level `openclaw-runtime/` payload source

That is the smallest structure that still preserves the ideal monorepo shape, keeps the runtime boundary explicit, and gives enough IPC/diagnostic surface for low-intervention autonomous iteration.
