# Sentry

This document describes the current desktop Sentry pipeline as one complete system:

1. the three environments
2. the packaging pipeline, including DSN injection and sourcemap upload
3. the runtime exception/crash reporting pipeline

Scope: Electron desktop only.

Key code paths:

- `apps/desktop/shared/runtime-config.ts`
- `apps/desktop/shared/sentry-build-metadata.ts`
- `apps/desktop/main/index.ts`
- `apps/desktop/main/ipc.ts`
- `apps/desktop/preload/index.ts`
- `apps/desktop/src/main.tsx`
- `apps/desktop/scripts/dist-mac.mjs`
- `apps/desktop/scripts/upload-sourcemaps.mjs`
- `.github/workflows/desktop-build.yml`
- `.github/workflows/desktop-release.yml`

## 1. Three Environments

Desktop Sentry uses the fixed org `refly-ai` and three fixed projects.

| Environment | Build source | Sentry project | Primary use |
| --- | --- | --- | --- |
| Local dev | `local-dev`, `local-dist` | `nexu-desktop-dev` | local development and local packaged verification |
| Test | `nightly-test` | `nexu-desktop-test` | nightly test desktop builds |
| Prod | `nightly-prod`, `release` | `nexu-desktop-prod` | nightly prod builds and formal releases |

This mapping is hardcoded in `apps/desktop/scripts/upload-sourcemaps.mjs`.

### Environment-specific DSN sources

| Environment | DSN source |
| --- | --- |
| Local dev | local runtime env, usually `apps/desktop/.env` via `NEXU_DESKTOP_SENTRY_DSN`; dev runtime does not use `build-config.json` |
| Test | GitHub secret `SENTRY_DSN_NEXU_DESKTOP_TEST` |
| Prod | GitHub secret `SENTRY_DSN_NEXU_DESKTOP_PROD` |

### Shared release metadata rules

All environments use the same metadata model from `apps/desktop/shared/sentry-build-metadata.ts`:

- `release = nexu-desktop@<version>`
- `dist = <version>-<commit>` when commit exists
- if commit is missing, `dist` is omitted

Example:

- `release`: `nexu-desktop@0.1.3`
- `dist`: `0.1.3-ce04c383286127ddb766141c7bf55b4e7b70cf18`

## 2. Packaging Pipeline

This section covers the build/package side of the Sentry pipeline, including both DSN injection and sourcemap upload.

### 2.1 Local dev packaging flow

Local verification usually follows this path:

```bash
pnpm restart
pnpm --filter @nexu/desktop build
pnpm --filter @nexu/desktop upload:sourcemaps
```

#### Local dev DSN injection

For local dev runs, `apps/desktop/dev.sh` loads `NEXU_DESKTOP_SENTRY_DSN` from `apps/desktop/.env` and exports it into the Electron process.

In local dev mode, desktop runtime config does not fall back to `build-config.json` for Sentry. Effective resolution is:

1. `process.env.NEXU_DESKTOP_SENTRY_DSN`
2. `null`

In practice, local source of truth is usually:

- `apps/desktop/.env`
- variable: `NEXU_DESKTOP_SENTRY_DSN`

This is intentional. `apps/desktop/build-config.json` can contain stale CI/test/prod DSNs from earlier packaged builds, so local dev now ignores that file to avoid misrouting local events into the wrong Sentry project.

#### Local dev build metadata resolution

For local sourcemap upload, `apps/desktop/scripts/upload-sourcemaps.mjs` uses local-friendly fallbacks:

- version: desktop `package.json` fallback is allowed
- source: defaults to `local-dev` unless overridden
- commit: falls back to `git rev-parse HEAD`
- DSN: prefers env, then `build-config.json`

This is why local upload can work even if `build-config.json` is not a fresh CI-style packaged artifact.

Important distinction:

- local runtime event delivery ignores `build-config.json`
- local sourcemap upload may still read `build-config.json` as a fallback when env is absent

#### Local dev sourcemap generation

`apps/desktop/vite.config.ts` emits production sourcemaps for:

- renderer: `apps/desktop/dist/**/*.js.map`
- preload: `apps/desktop/dist-electron/preload/**/*.js.map`

#### Local dev sourcemap upload

`apps/desktop/scripts/upload-sourcemaps.mjs` then:

1. resolves version / source / commit / DSN
2. maps `local-dev` or `local-dist` to `nexu-desktop-dev`
3. derives Sentry API origin from the DSN
4. creates or reuses the Sentry release
5. uploads renderer + preload JS artifacts and sourcemaps

Required local secret material:

- `SENTRY_AUTH_TOKEN`

Local project/org mapping is hardcoded, so they do not need to be configured.

### 2.2 Test packaging flow

Nightly test builds are handled in `.github/workflows/desktop-build.yml`.

#### Test DSN injection

The workflow reads:

- `SENTRY_DSN_NEXU_DESKTOP_TEST`

Then writes a CI build manifest at `apps/desktop/build-config.json` containing:

- `NEXU_DESKTOP_APP_VERSION`
- `NEXU_DESKTOP_BUILD_SOURCE=nightly-test`
- `NEXU_DESKTOP_BUILD_BRANCH`
- `NEXU_DESKTOP_BUILD_COMMIT`
- `NEXU_DESKTOP_BUILD_TIME`
- `NEXU_DESKTOP_SENTRY_DSN`

That file is later bundled and read at runtime by `apps/desktop/shared/runtime-config.ts`.

#### Test sourcemap upload

The same workflow passes:

- `SENTRY_AUTH_TOKEN`

Then `pnpm --filter @nexu/desktop dist:mac` runs `apps/desktop/scripts/dist-mac.mjs`, which calls `apps/desktop/scripts/upload-sourcemaps.mjs` after the desktop build step.

The uploader maps `nightly-test` to:

- org: `refly-ai`
- project: `nexu-desktop-test`

### 2.3 Prod packaging flow

There are two prod-style packaging paths.

#### Nightly prod builds

Handled in `.github/workflows/desktop-build.yml` with:

- `SENTRY_DSN_NEXU_DESKTOP_PROD`
- `NEXU_DESKTOP_BUILD_SOURCE=nightly-prod`

Uploader target:

- org: `refly-ai`
- project: `nexu-desktop-prod`

#### Formal releases

Handled in `.github/workflows/desktop-release.yml`.

The workflow reads:

- `SENTRY_DSN_NEXU_DESKTOP_PROD`
- `SENTRY_AUTH_TOKEN`

Then writes `apps/desktop/build-config.json` with:

- `NEXU_DESKTOP_APP_VERSION`
- `NEXU_DESKTOP_BUILD_SOURCE=release`
- `NEXU_DESKTOP_BUILD_COMMIT`
- `NEXU_DESKTOP_BUILD_TIME`
- `NEXU_DESKTOP_SENTRY_DSN`

Then `dist:mac` runs the sourcemap upload step automatically.

Uploader target:

- org: `refly-ai`
- project: `nexu-desktop-prod`

### 2.4 Packaging secrets

Current GitHub secrets involved in the packaging pipeline:

| Secret | Where used | Purpose |
| --- | --- | --- |
| `SENTRY_DSN_NEXU_DESKTOP_TEST` | `.github/workflows/desktop-build.yml` | inject desktop test DSN into packaged test builds |
| `SENTRY_DSN_NEXU_DESKTOP_PROD` | `.github/workflows/desktop-build.yml`, `.github/workflows/desktop-release.yml` | inject desktop prod DSN into packaged prod/release builds |
| `SENTRY_AUTH_TOKEN` | `.github/workflows/desktop-build.yml`, `.github/workflows/desktop-release.yml` | authenticate sourcemap upload |

Current local secret requirement:

- `SENTRY_AUTH_TOKEN`

### 2.5 Packaging caveats

If a release file with the same artifact name already exists for the same `release` + `dist`, the uploader tries to delete it before re-uploading.

If delete is denied by Sentry:

- the old file is kept
- that one file is skipped
- the rest of the files still upload
- the summary reports `uploaded X/Y ... (N kept existing)`

## 3. Exception Reporting Pipeline

This section covers runtime event delivery after the app is built and launched.

### 3.1 Main process exception/crash path

In `apps/desktop/main/index.ts`:

1. Electron starts
2. desktop runtime config is resolved
3. `runtimeConfig.sentryDsn` is checked
4. if DSN exists:
   - initialize `@sentry/electron/main`
   - set `environment`
   - set `release`
   - set optional `dist`
   - attach build context via `Sentry.setContext("build", ...)`
5. if DSN does not exist:
   - fall back to local-only Electron `crashReporter`
   - do not upload native crashes to Sentry

This path covers:

- main-process JavaScript exceptions
- native crash handling routed through the Electron/Sentry main integration

### 3.2 Renderer exception path

In `apps/desktop/preload/index.ts` and `apps/desktop/src/main.tsx`:

1. preload exposes bootstrap data:
   - `sentryDsn`
   - `buildInfo`
2. renderer starts
3. if `sentryDsn` exists:
   - initialize `@sentry/electron/renderer`
   - set `release`
   - set optional `dist`
   - attach build context via `Sentry.setContext("build", ...)`

This path covers:

- renderer JavaScript exceptions

This is the path that depends most directly on uploaded sourcemaps for readable stack traces.

### 3.3 Exception reporting by environment

#### Local dev

- project: `nexu-desktop-dev`
- environment values typically appear as development-like runtime values
- DSN comes from local runtime env, typically `apps/desktop/.env` injected by `apps/desktop/dev.sh`
- `build-config.json` is ignored for local runtime event delivery
- renderer exceptions should land in the dev project
- if sourcemaps were uploaded first, renderer stack traces should resolve beyond bundled filenames

#### Test

- project: `nexu-desktop-test`
- packaged nightly test builds should report into test using the baked DSN
- sourcemaps uploaded during CI should match the exact packaged build metadata

#### Prod

- project: `nexu-desktop-prod`
- nightly prod and formal releases both report into prod using the baked prod DSN
- sourcemaps uploaded during CI/release packaging should match the exact release artifact

### 3.4 Runtime failure types

Current desktop failure surfaces include:

- renderer JavaScript exception
- renderer process crash
- main process crash

Behavior summary:

- renderer JavaScript exception -> `@sentry/electron/renderer`
- renderer crash / native crash path -> Electron crash pipeline + `@sentry/electron/main`
- main process crash -> `@sentry/electron/main`

If DSN is absent:

- JavaScript exceptions are not sent to Sentry
- native crashes stay on the local-only crashReporter fallback path

### 3.5 Diagnostics validation findings

The desktop diagnostics page currently exercises three deliberate failure types:

- `desktop.renderer.exception`
- `desktop.renderer.crash`
- `desktop.main.crash`

Current local-dev validation result:

- renderer JavaScript exception is the cleanest path to validate immediately in Sentry; with sourcemaps uploaded, stack traces resolve correctly
- renderer native crash lands in `nexu-desktop-dev` and now carries diagnostic tags such as `nexu.crash_title=desktop.renderer.crash` and `nexu.crash_kind=native_crash`
- main native crash lands in `nexu-desktop-dev` and carries the same diagnostic tags plus build correlation metadata (`release`, `dist`, `build.commit`, `build.builtAt`)

For native crash diagnostics, the desktop app now writes crash annotations before deliberate crash tests so that recovered minidump events still contain:

- `nexu.crash_title`
- `nexu.crash_kind`

These fields are useful for triage even when the Sentry issue title remains native-symbol-oriented (for example `electron::ElectronBindings::Crash`) or renderer-minidump-oriented (for example `<unknown>`).

### 3.6 Native crash upload timing

Renderer JavaScript exceptions are reported in-process at the moment they occur.

Native crash behavior is different:

- renderer native crashes may appear very quickly, but still come through the minidump pipeline
- main process native crashes are typically uploaded on the next app start, when `@sentry/electron/main` scans and submits the minidump left by the prior crashed run

This means a deliberate main-process crash may not create or update its Sentry issue until the next `pnpm restart` or next manual app launch.

Because upload can happen after restart, the most important fields for correlation are:

- `nexu.crash_title`
- `nexu.crash_kind`
- `release`
- `dist`
- `build.source`
- `build.branch`
- `build.commit`
- `build.builtAt`

### 3.7 What must match for readable renderer stacks

For sourcemaps to apply correctly to renderer issues, all of these must align:

- project must be correct for the environment
- `release` must match exactly
- `dist` must match exactly when present
- sourcemaps must be uploaded before the error occurs

If any of these drift, Sentry may still receive the event but show bundle-oriented frames like `app:///dist/assets/index-*.js`.

## Quick Reference

- org: `refly-ai`
- projects:
  - `nexu-desktop-dev`
  - `nexu-desktop-test`
  - `nexu-desktop-prod`
- GitHub secrets:
  - `SENTRY_AUTH_TOKEN`
  - `SENTRY_DSN_NEXU_DESKTOP_TEST`
  - `SENTRY_DSN_NEXU_DESKTOP_PROD`
