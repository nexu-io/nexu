---
id: 20260319-desktop-sentry-build-metadata
name: Desktop Sentry Build Metadata
status: implemented
created: '2026-03-19'
---

## Overview

- Add desktop build metadata to Sentry events so crash and exception issues can be tied back to the exact packaged artifact without relying on branch-specific tags.
- Keep Sentry naming aligned with standard release management:
  - `release`: `nexu-desktop@<version>`
  - `dist`: `<version>-<commit>`
- Focus the operator experience on packaged crash triage first. Local dev-only metadata such as branch and build source should remain available as event context, but should not become primary issue filters.
- Apply the same metadata model to both Electron main and renderer pipelines so JavaScript exceptions and native crashes share the same release/dist identity in Sentry.

## Research

### Existing system

- Electron main computes `runtimeConfig` once via `getDesktopRuntimeConfig(...)`, then initializes Sentry only when a desktop DSN is present; otherwise it keeps the local-only `crashReporter` fallback unchanged.
- Electron renderer initializes `@sentry/electron/renderer` from preload bootstrap data, but today only receives `sentryDsn` and `isPackaged`, so it has no shared `release`/`dist` metadata.
- `apps/desktop/shared/runtime-config.ts` already acts as the single source of truth for build metadata (`version`, `source`, `branch`, `commit`, `builtAt`) across dev env injection and packaged `build-config.json`.
- Full runtime config is already available to the renderer through the typed `env:get-runtime-config` IPC path, and the UI already displays `buildInfo`, so no new build metadata source is needed.

### Available approaches

- Extend preload bootstrap to include the resolved build metadata needed for renderer Sentry initialization.
- Initialize renderer Sentry after asynchronously fetching full runtime config over the existing `env:get-runtime-config` IPC call.
- Add a shared desktop Sentry metadata helper that derives `release`, optional `dist`, and structured build context from `runtimeConfig.buildInfo`, then reuse it in both main and renderer.

### Constraints

- Preserve `getDesktopRuntimeConfig(...)` as the canonical build metadata resolver; do not duplicate environment parsing in Sentry setup code.
- Preserve the existing DSN-absent behavior where main falls back to Electron `crashReporter` with no Sentry upload path.
- Keep renderer access within the existing typed host bridge and IPC patterns defined in `apps/desktop/shared/host.ts`.
- Preserve existing crash-test tagging and `beforeSend` behavior in main so desktop Sentry diagnostics continue to work.
- `dist` must be omitted when commit metadata is unavailable instead of inventing a synthetic value.

### Key references

- `apps/desktop/main/index.ts:51`
- `apps/desktop/main/index.ts:72`
- `apps/desktop/main/index.ts:75`
- `apps/desktop/main/index.ts:96`
- `apps/desktop/src/main.tsx:42`
- `apps/desktop/src/main.tsx:52`
- `apps/desktop/preload/index.ts:19`
- `apps/desktop/preload/index.ts:24`
- `apps/desktop/main/ipc.ts:137`
- `apps/desktop/shared/runtime-config.ts:107`
- `apps/desktop/shared/runtime-config.ts:167`
- `apps/desktop/shared/runtime-config.ts:209`
- `apps/desktop/shared/host.ts:271`

## Design

### Architecture overview

```text
build-config.json / env
        |
        v
getDesktopRuntimeConfig(...)
        |
        +--> main/index.ts --------> getDesktopSentryBuildMetadata(buildInfo)
        |                               |-> Sentry.init({ release, dist? })
        |                               `-> Sentry.setContext("build", ...)
        |
        `--> preload/index.ts -----> bootstrap.buildInfo + bootstrap.sentryDsn
                                        |
                                        v
                                   src/main.tsx
                                        |
                                        `-> getDesktopSentryBuildMetadata(buildInfo)
                                            -> Sentry.init({ release, dist? })
                                            -> Sentry.setContext("build", ...)
```

### Design decisions

- Keep `runtimeConfig.buildInfo` as the only source of desktop build metadata so main and renderer cannot drift.
- Add a small shared helper that derives Sentry `release`, optional `dist`, and the structured `build` context from `DesktopBuildInfo`.
- Rename the desktop Sentry release to `nexu-desktop@<version>` and set `dist` to a Sentry-safe `<version>-<commit>` value only when commit metadata exists.
- Expose `buildInfo` through the existing preload bootstrap so renderer Sentry can initialize synchronously during startup instead of waiting on an async IPC round-trip.
- Keep branch/source/commit out of Sentry tags; store them only in `Sentry.setContext("build", ...)`.

### Implementation steps

1. Add a shared desktop Sentry metadata helper in `apps/desktop/shared/` that normalizes commit values and returns `release`, optional `dist`, and `build` context.
2. Update `apps/desktop/main/index.ts` to use that helper during `Sentry.init(...)` and attach the `build` context immediately after initialization.
3. Extend the typed host bootstrap contract to include `buildInfo`, then pass it through `apps/desktop/preload/index.ts`.
4. Update `apps/desktop/src/main.tsx` to initialize renderer Sentry from the same helper output so renderer and main share the same metadata model.
5. Verify three cases: DSN present with commit, DSN present without commit, and DSN absent with the local crashReporter fallback intact.

### Pseudocode

```text
function getDesktopSentryBuildMetadata(buildInfo):
  release = "nexu-desktop@" + buildInfo.version
  commit = trim(buildInfo.commit)

  return {
    release,
    dist: commit ? version + "-" + commit : undefined,
    buildContext: {
      version: buildInfo.version,
      source: buildInfo.source,
      branch: buildInfo.branch,
      commit: commit or null,
      builtAt: buildInfo.builtAt,
    },
  }
```

### Files to create or modify

- `apps/desktop/shared/sentry-build-metadata.ts` - shared helper for release, dist, and build context derivation
- `apps/desktop/main/index.ts` - use the helper for main-process Sentry initialization and build context attachment
- `apps/desktop/shared/host.ts` - extend preload bootstrap typing with `buildInfo`
- `apps/desktop/preload/index.ts` - expose `buildInfo` in the bootstrap payload
- `apps/desktop/src/main.tsx` - initialize renderer Sentry with the same release/dist/context model as main

### Edge cases and error handling

- Treat empty or whitespace-only commit values as missing and omit `dist`.
- Preserve the existing DSN-absent path where main uses local-only `crashReporter` and renderer skips Sentry initialization.
- Leave `builtAt` as raw context data; do not parse or validate timestamps during Sentry setup.
- Keep the renderer's one-time initialization guard so startup cannot double-register Sentry.

## Plan

- [x] Add a shared helper that derives desktop Sentry `release`, optional `dist`, and structured build context from `DesktopBuildInfo`
- [x] Update main-process Sentry initialization to use the shared metadata helper and attach the `build` context
- [x] Extend the preload bootstrap contract to expose `buildInfo` to the renderer
- [x] Update renderer Sentry initialization to use the shared metadata helper and attach the `build` context
- [x] Run validation checks for the desktop TypeScript changes (`pnpm typecheck`, `pnpm lint`, and targeted tests if needed)

## Implementation

### Files created or modified

- `apps/desktop/shared/sentry-build-metadata.ts` - added the shared helper that builds Sentry `release`, optional `dist`, and normalized `build` context from `DesktopBuildInfo`
- `apps/desktop/main/index.ts` - main-process Sentry now uses the shared helper and attaches `Sentry.setContext("build", ...)`
- `apps/desktop/src/main.tsx` - renderer Sentry now uses the same shared helper and preload bootstrap metadata for synchronous startup initialization
- `apps/desktop/shared/host.ts` and `apps/desktop/preload/index.ts` - extended the preload bootstrap contract to expose `buildInfo`
- `apps/desktop/shared/runtime-config.ts` - added packaged build-config support for `NEXU_DESKTOP_APP_VERSION` so preload can resolve the correct desktop version without async IPC
- `apps/desktop/scripts/dist-mac.mjs`, `.github/workflows/desktop-build.yml`, and `.github/workflows/desktop-release.yml` - now write `NEXU_DESKTOP_APP_VERSION` into `build-config.json` for packaged builds
- `apps/desktop/scripts/upload-sourcemaps.mjs` and `apps/desktop/vite.config.ts` - renderer/preload production builds now emit sourcemaps and upload them to Sentry releases, auto-routing by build source to hardcoded `refly-ai` desktop projects (`nexu-desktop-dev`, `nexu-desktop-test`, `nexu-desktop-prod`)
- `tests/desktop/sentry-build-metadata.test.ts` - added unit coverage for release/dist derivation and blank-commit handling

### Testing results

- `pnpm typecheck` - passed
- `pnpm lint` - passed
- `pnpm --filter @nexu/desktop build` - passed and now emits renderer/main/preload sourcemaps
- `pnpm exec vitest run tests/desktop/sentry-build-metadata.test.ts` - passed
- `pnpm test` - not fully green due pre-existing environment/repo issues outside this feature: API suites expect a local `nexu_test` database, and `tests/web/home.test.tsx` still fails on the alpha video source assertion

### Deviations from the design

- The design originally assumed existing build metadata sources were already sufficient for synchronous renderer initialization.
- During implementation review, packaged renderer startup was found to fall back to `0.0.0` because preload had no authoritative app version.
- To preserve synchronous renderer Sentry initialization without introducing an async IPC dependency, packaged `build-config.json` generation was expanded to include `NEXU_DESKTOP_APP_VERSION`, and `runtimeConfig.buildInfo.version` now reads it when `appVersion` is not injected directly.

## Notes

<!-- Optional: Alternatives considered, open questions, etc. -->
