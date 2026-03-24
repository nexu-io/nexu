---
id: "20260317-desktop-crash-reporting"
name: "Desktop Crash Reporting"
status: new
created: "2026-03-17"
---

## Overview

- Add observable crash reporting to the Electron desktop app and provide deterministic test entry points for validation.
- Split desktop failure testing into three paths: renderer JavaScript exception, renderer process crash, and main process crash.
- Keep local verification possible before remote monitoring, then route both exception and native crash signals into Sentry.

## Research

### Existing system

- `apps/desktop` had no dedicated crash lab surface and no Sentry integration.
- Electron native `crashReporter` captures process crashes only; it does not capture renderer JavaScript exceptions.
- `@sentry/electron` combines two different pipelines:
  - renderer JS exceptions through the renderer SDK
  - native crashes through Electron/Crashpad minidumps handled by the main SDK

### Options considered

1. Use only Electron `crashReporter`
   - Good for local native crash validation
   - Does not cover renderer exceptions
2. Use only manual Sentry exception capture
   - Good for JavaScript errors
   - Does not validate native crash handling
3. Use all three test paths with Electron crash reporting plus Sentry integration (chosen)
   - Covers the full desktop observability surface
   - Makes it easy to verify local and remote behavior separately

### Findings

- `Throw Renderer Error` should be treated as an exception test, not a crash test.
- `BrowserWindow.webContents.forcefullyCrashRenderer()` reliably simulates a renderer process crash.
- `process.crash()` reliably simulates a main process native crash.
- Once Sentry native crash handling is enabled, Sentry may own minidump upload and native issue titles may stay platform-derived.

## Design

### Architecture

`Diagnostics UI` -> `host bridge` -> `IPC` -> `main/renderer failure path`

`renderer exception` -> `@sentry/electron/renderer`

`renderer crash` / `main crash` -> `Electron crashReporter / Crashpad` -> `@sentry/electron/main`

### Implementation choices

- Add a dedicated `Diagnostics` top-level surface instead of placing dangerous controls in `Home`.
- Expose three explicit buttons:
  - `Test Renderer Exception`
  - `Test Renderer Crash`
  - `Test Main Crash`
- Show runtime diagnostics metadata on the page, including crash dump path and Sentry enablement.
- Initialize Sentry main from runtime env `NEXU_DESKTOP_SENTRY_DSN`.
- Bootstrap the renderer Sentry DSN through preload so renderer Sentry starts before React render.
- Keep a fallback local-only Electron `crashReporter` path when no Sentry DSN is present.

### Key file changes

- `apps/desktop/src/main.tsx` - Diagnostics surface, renderer exception trigger, renderer Sentry init, updated copy
- `apps/desktop/main/ipc.ts` - diagnostics IPC handlers and native crash metadata setup
- `apps/desktop/main/index.ts` - main Sentry init and local crashReporter fallback
- `apps/desktop/preload/index.ts` - preload bootstrap data for renderer Sentry
- `apps/desktop/shared/host.ts` - shared bridge contracts for diagnostics/bootstrap data
- `apps/desktop/.env.example` - desktop Sentry env example

### Verification summary

- Local-only mode:
  - renderer exception does not create Crashpad dumps
  - renderer crash creates a local native dump
  - main crash creates a local native dump
- Sentry mode:
  - renderer exception appears in Sentry as `desktop.renderer.exception.test`
  - native renderer/main crashes upload successfully, but Sentry may still display service-derived native titles such as `<unknown>` or `electron::ElectronBindings::Crash`

## Plan

- [x] Phase 1: Add deterministic desktop test entry points
  - [x] Create a top-level `Diagnostics` navigation surface
  - [x] Add renderer exception, renderer crash, and main crash buttons
  - [x] Show local crash/Sentry runtime state in the UI
- [x] Phase 2: Wire crash reporting backends
  - [x] Add Electron `crashReporter` local fallback for native crash validation
  - [x] Integrate `@sentry/electron` in both main and renderer processes
  - [x] Pass runtime bootstrap data through preload for early renderer init
- [x] Phase 3: Validate behavior
  - [x] Confirm renderer exception stays alive locally and reaches Sentry remotely
  - [x] Confirm renderer crash is recorded locally and remotely
  - [x] Confirm main crash is recorded locally and remotely

## Further actions

- [x] Provision the Sentry project via Terraform (currently dev-only and not Terraform-managed).
- [x] Wire `NEXU_DESKTOP_SENTRY_DSN` into CI nightly builds via GitHub Actions secrets (`desktop-build.yml` → `build-config.json` bake-in pattern, covering both test and prod nightlies).
- [x] Fix DSN bake-in: `NEXU_DESKTOP_SENTRY_DSN` is now read from `build-config.json` at runtime rather than from `process.env`, which is empty in packaged apps. Changes span `runtime-config.ts`, `main/index.ts`, `main/ipc.ts`, and `preload/index.ts`.
- [ ] Set the `NEXU_DESKTOP_SENTRY_DSN` GitHub secret (repo-level or per GitHub Environment) once the Terraform-managed Sentry project DSN is confirmed.
- [ ] Verify the prod DSN is pointing to the correct Sentry project before enabling crash reporting in production.

## Notes

- Native crash issue titles are harder to force than JavaScript exception titles because Sentry groups minidump-native events with platform-derived metadata.
- Current semantic test names are:
  - `desktop.renderer.exception.test`
  - `desktop.renderer.crash.test`
  - `desktop.main.crash.test`
- If needed later, native crash differentiation should rely on tags/context/fingerprint rather than expecting Sentry issue titles to be fully customizable.
