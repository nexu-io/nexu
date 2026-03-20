---
id: 20260319-nexu-desktop-diagnostics-export
name: Nexu Desktop Diagnostics Export
status: implemented
created: '2026-03-19'
---

## Overview

### Problem Statement

- Nexu Desktop currently lacks a one-click way to export troubleshooting data.
- This makes issue investigation harder during development/testing and after release when users need to send diagnostic information back to the team.

### Goals

- Add a one-click export flow in Nexu Desktop for issue diagnosis.
- Make it easy for users to export diagnostics and share them with the team for troubleshooting.

### Scope

**In scope:**
- Export Nexu Desktop build information.
- Export machine environment information.
- Export `openclaw.json` configuration.
- Export logs.

## Research

### Existing System

- Desktop user actions cross the Electron boundary through a typed host bridge: renderer wrappers call `window.nexuHost.invoke(...)`, preload validates the channel, and Electron main handles the request in a central IPC switch. Key files: `apps/desktop/src/lib/host-api.ts:23`, `apps/desktop/preload/index.ts:23`, `apps/desktop/shared/host.ts:6`, `apps/desktop/main/ipc.ts:75`.
- Desktop already persists diagnostics data to `desktop-diagnostics.json` in the Electron logs directory. The snapshot includes cold-start state, renderer/webview failures, runtime state, and recent runtime events, and it is written with a temp-file-then-rename pattern. Key files: `apps/desktop/main/desktop-diagnostics.ts:66`, `apps/desktop/main/desktop-diagnostics.ts:255`, `apps/desktop/main/desktop-diagnostics.ts:277`.
- Desktop also writes persistent log files for the shell and runtime units. Main-process logs use `cold-start.log` and `desktop-main.log`; runtime-unit logs live under `logs/runtime-units/*.log` with rotation handled by the runtime logger. Key files: `apps/desktop/main/index.ts:179`, `apps/desktop/main/runtime/manifests.ts:227`, `apps/desktop/main/runtime/runtime-logger.ts:99`, `apps/desktop/main/runtime/runtime-logger.ts:332`.
- The renderer already exposes two adjacent user-facing surfaces: a runtime control page with per-unit log reveal actions, and a diagnostics page that shows app/build metadata and crash-testing actions. Key files: `apps/desktop/src/main.tsx:381`, `apps/desktop/src/main.tsx:528`, `apps/desktop/src/main.tsx:807`, `apps/desktop/src/main.tsx:1087`.
- Build metadata is generated at packaging time into `build-config.json`, loaded into desktop runtime config, and displayed in the shell UI. Key files: `apps/desktop/scripts/dist-mac.mjs:214`, `apps/desktop/shared/runtime-config.ts:50`, `apps/desktop/shared/runtime-config.ts:153`, `apps/desktop/src/main.tsx:1115`.
- Controller-owned local state includes Nexu config and compiled OpenClaw config paths, and the desktop runtime manifest passes an `OPENCLAW_CONFIG_PATH` into the controller-managed runtime. Key files: `apps/controller/src/app/env.ts:45`, `apps/controller/src/app/env.ts:53`, `apps/controller/src/services/openclaw-sync-service.ts:21`, `apps/controller/src/runtime/openclaw-config-writer.ts:9`, `apps/desktop/main/runtime/manifests.ts:315`.
- Repo tooling already has a diagnostics collection pattern in CI: it knows the expected diagnostics/log file locations for dev and packaged modes and copies those artifacts into a capture directory. Key files: `scripts/desktop-ci-check.mjs:44`, `scripts/desktop-ci-check.mjs:65`, `scripts/desktop-ci-check.mjs:79`, `scripts/desktop-ci-check.mjs:823`.

### Available Approaches

- **Snapshot-led export**: Package the existing `desktop-diagnostics.json` together with the persistent log files and the generated OpenClaw config path already used by desktop/controller runtime management. Relevant code: `apps/desktop/main/desktop-diagnostics.ts:255`, `apps/desktop/main/index.ts:179`, `apps/desktop/main/runtime/manifests.ts:327`.
- **On-demand assembled export**: Add a new host IPC action that gathers build info, environment/path metadata, config files, and selected logs directly in Electron main when the user clicks export. Relevant code path: `apps/desktop/shared/host.ts:6`, `apps/desktop/main/ipc.ts:75`, `apps/desktop/src/lib/host-api.ts:23`.
- **Capture-directory export**: Reuse the same artifact grouping used by `scripts/desktop-ci-check.mjs` to copy known diagnostics and log paths into an export folder, then hand that folder or an archive to the user. Relevant code: `scripts/desktop-ci-check.mjs:44`, `scripts/desktop-ci-check.mjs:79`, `scripts/desktop-ci-check.mjs:157`, `scripts/desktop-ci-check.mjs:823`.
- **Diagnostics-surface entry point**: Attach export to the existing desktop Diagnostics page, which already presents troubleshooting metadata and user-triggered diagnostics actions. Relevant UI: `apps/desktop/src/main.tsx:807`, `apps/desktop/src/main.tsx:951`, `apps/desktop/src/main.tsx:1183`.
- **Runtime-surface entry point**: Attach export to the runtime control plane, which already exposes per-unit logs, live runtime state, and runtime actions. Relevant UI: `apps/desktop/src/main.tsx:347`, `apps/desktop/src/main.tsx:528`, `apps/desktop/src/main.tsx:727`.

### Constraints & Dependencies

- Desktop filesystem access currently lives in Electron main behind the typed host bridge. Any renderer-triggered export has to be introduced as a new host channel and handled in main. Key files: `apps/desktop/shared/host.ts:6`, `apps/desktop/preload/index.ts:17`, `apps/desktop/main/ipc.ts:57`.
- There is no existing desktop save/export dialog flow in Electron main. Current file-oriented UX reveals existing log files in Finder rather than prompting for a destination. Key files: `apps/desktop/main/ipc.ts:168`, `apps/desktop/src/main.tsx:381`.
- Runtime event history is bounded in memory, and the persisted diagnostics snapshot only includes a limited recent slice. Full-history export cannot rely only on `runtime:query-events`. Key files: `apps/desktop/main/runtime/daemon-supervisor.ts:23`, `apps/desktop/main/runtime/daemon-supervisor.ts:203`, `apps/desktop/main/desktop-diagnostics.ts:256`.
- Runtime config contains sensitive values, including the gateway token and desktop auth password, so any exported environment/config metadata will need explicit filtering or redaction. Key files: `apps/desktop/shared/runtime-config.ts:138`, `apps/desktop/shared/runtime-config.ts:223`.
- Packaged desktop code must not rely on shell tools from the user's PATH. Existing archive/extract helpers in desktop code sometimes shell out to `tar`, which is a constraint for any packaged export/archive implementation. Key files: `apps/desktop/main/runtime/manifests.ts:200`, `apps/desktop/main/updater/component-updater.ts:124`, `apps/desktop/main/skillhub/catalog-manager.ts:155`.
- Desktop dev and packaged modes use different log roots, and existing diagnostics tooling already treats them as separate path sets. Key files: `scripts/desktop-ci-check.mjs:45`, `scripts/desktop-ci-check.mjs:86`.

### Key References

- `apps/desktop/shared/host.ts:6` - Typed host IPC contract and runtime event/query types.
- `apps/desktop/main/ipc.ts:75` - Central Electron main handler for host actions.
- `apps/desktop/main/desktop-diagnostics.ts:66` - Diagnostics snapshot file location and reporter.
- `apps/desktop/main/index.ts:179` - Desktop main log file locations and log writers.
- `apps/desktop/main/runtime/daemon-supervisor.ts:203` - Cursored runtime event query over bounded in-memory history.
- `apps/desktop/main/runtime/manifests.ts:227` - Runtime-unit log paths and controller/OpenClaw environment wiring.
- `apps/desktop/main/runtime/runtime-logger.ts:332` - Persistent structured runtime log serialization.
- `apps/desktop/shared/runtime-config.ts:153` - Build info, URLs, tokens, and desktop path config.
- `apps/controller/src/app/env.ts:45` - Controller local config and OpenClaw file path defaults.
- `scripts/desktop-ci-check.mjs:44` - Existing diagnostics artifact grouping for dev and packaged modes.

## Design

### Architecture

V1 keeps the export flow intentionally small and centered in Electron main.

```text
Diagnostics Page button / Help menu item
  -> typed host action or direct main-process command
  -> exportDiagnostics()
  -> collect existing artifacts
  -> redact sensitive values
  -> write staging directory
  -> create ZIP
  -> save to user-selected path
```

- Renderer stays thin and only triggers export + shows success/error state.
- Electron main owns filesystem access, save dialog, artifact collection, redaction, and ZIP creation.
- Export reuses existing persisted diagnostics files instead of rebuilding runtime state on demand.
- V1 adds two entry points:
  - Diagnostics page: developer-oriented troubleshooting surface.
  - Native app menu `Help -> Export Diagnostics...`: user-friendly support entry.

### Implementation Steps

1. **Add export contract**
   - Add a new typed host action for diagnostics export.
   - Return structured results for success, cancel, warnings, and failures.
2. **Build main-process export flow**
   - Show a native save dialog for the destination ZIP path.
   - Collect the known diagnostics artifacts from desktop log/config locations.
   - Create generated summary files for build/environment metadata.
3. **Apply default redaction**
   - Redact known secret fields from JSON/config data.
   - Apply a lightweight text redaction pass to log/config text.
4. **Package the export**
   - Copy redacted artifacts into a temporary export directory.
   - Create a ZIP archive from that staged directory.
   - Clean up temp files after completion.
5. **Expose both entry points**
   - Add an export action to the Diagnostics page.
   - Add `Help -> Export Diagnostics...` in the native menu.
6. **Document warnings and follow-ups**
   - Include a manifest/summary file in the bundle with included/missing files.
   - Capture V2 improvement ideas in Notes instead of overbuilding V1.

### Pseudocode: Export Flow

```text
exportDiagnostics(triggerSource):
  targetPath = promptUserForSaveLocation()
  if user cancelled:
    return { status: "cancelled" }

  artifacts = collectArtifactsFromKnownPaths()
  summaries = buildSafeEnvironmentSummary()

  stagedFiles = []
  for each artifact in artifacts + summaries:
    if artifact exists:
      content = readArtifact()
      redactedContent = redactSensitiveValues(content)
      writeToStagingDirectory(redactedContent)
      recordIncluded(artifact)
    else:
      recordMissing(artifact)

  writeManifest(included, missing, warnings)
  zipStagingDirectoryTo(targetPath)
  cleanupTemporaryFiles()
  return { status: "success", targetPath, warnings }
```

### Files to Modify

- `apps/desktop/shared/host.ts` - Add the typed diagnostics export channel and result types.
- `apps/desktop/src/lib/host-api.ts` - Add a renderer helper that invokes diagnostics export.
- `apps/desktop/main/ipc.ts` - Handle the new export request in Electron main.
- `apps/desktop/src/main.tsx` - Add the Diagnostics page export action and status messaging.
- `apps/desktop/main/index.ts` - Add the native `Help -> Export Diagnostics...` menu entry.

### Files to Create

- `apps/desktop/main/diagnostics-export.ts` - V1 export orchestrator for save dialog, collection, redaction, staging, and ZIP creation.

### Export Contents

ZIP directory layout after unzip:

```
nexu-diagnostics-<timestamp>/
├── diagnostics/
│   └── desktop-diagnostics.json      # Persisted desktop diagnostics snapshot (JSON-redacted)
├── logs/
│   ├── cold-start.log                # Main-process cold-start log (URL-token scrubbed)
│   ├── desktop-main.log              # Main-process runtime log (URL-token scrubbed)
│   └── runtime-units/
│       ├── controller.log            # Controller sidecar log (URL-token scrubbed)
│       ├── openclaw.log              # OpenClaw process log (URL-token scrubbed)
│       └── web.log                   # Web server log (URL-token scrubbed)
├── config/
│   └── openclaw.json                 # OpenClaw config (JSON-redacted)
└── summary/
    ├── environment-summary.json      # Build info, platform, mode, safe paths, ports, URLs
    └── manifest.json                 # Included/missing files, warnings, redaction notes
```

Notes:
- All files are deflate-compressed (method 8) with real file modification timestamps.
- Embedded runtime units (e.g. `control-plane`) have no subprocess log and are excluded from `logs/runtime-units/`.
- Files listed under `logs/runtime-units/` depend on which units are present at export time; each unit that has a log file and is not embedded is included.
- Any file not found at export time is omitted from the ZIP and listed in `manifest.json` under `missing`.

### Interfaces / API

- **Renderer -> Main**
  - Channel: `diagnostics:export`
  - Request:

```text
{
  source: "diagnostics-page"
}
```

  - Response:

```text
{
  status: "success" | "cancelled" | "failed",
  outputPath?: string,
  warnings?: string[],
  errorMessage?: string
}
```

- **Main menu -> Export service**
  - Directly call the same export function with `source: "help-menu"`.

### Edge Cases

- **Save cancelled** - Return `cancelled`; do not show a failure banner.
- **Missing files** - Still export the ZIP and list missing items in `manifest.json`.
- **Config not created yet** - Skip `openclaw.json` and record a warning.
- **Invalid JSON** - Fall back to raw text redaction when parsing fails.
- **Write/permission failure** - Return a clear actionable error.
- **Large logs** - V1 exports current log files as-is; note future size controls in Notes.
- **Sensitive data** - Default redaction covers known config secrets and common `token/password/secret` patterns.

### Scope Boundaries

- **In scope for V1**
  - Dev + packaged desktop support.
  - ZIP export through native save dialog.
  - Default redaction.
  - Diagnostics page entry.
  - Help menu entry.
- **Out of scope for V1**
  - Optional unredacted export mode.
  - Multiple export formats.
  - Fine-grained file selection UI.
  - Advanced log truncation or size budgeting.
  - Uploading diagnostics directly to a remote service.

## Plan

- [x] Add `diagnostics:export` channel and `DiagnosticsExportResult` type to `shared/host.ts`
- [x] Add `exportDiagnostics()` renderer helper in `src/lib/host-api.ts`
- [x] Create `main/diagnostics-export.ts` — ZIP writer, redaction, artifact collection, and export orchestrator
- [x] Handle `diagnostics:export` in `main/ipc.ts`
- [x] Add export action card and success message to `DiagnosticsPage` in `src/main.tsx`
- [x] Add `Help -> Export Diagnostics…` menu entry in `main/index.ts`

## Notes

### Implementation

- **`apps/desktop/shared/host.ts`** — Added `"diagnostics:export"` to `hostInvokeChannels`, `HostInvokePayloadMap`, and `HostInvokeResultMap`; added `DiagnosticsExportResult` type.
- **`apps/desktop/src/lib/host-api.ts`** — Added `exportDiagnostics()` renderer helper.
- **`apps/desktop/main/diagnostics-export.ts`** (new) — Self-contained module with: minimal ZIP writer (deflate via Node built-in `zlib.deflateRawSync`, real DOS mod timestamps from file `stat`), recursive JSON redaction keyed on `token|password|secret|key|dsn` pattern plus URL fragment/param token scrubbing on all string values, plain-text URL token scrubbing for log files, artifact collection from known paths (embedded units skipped), environment summary builder (strips all tokens/passwords), and the main `exportDiagnostics()` entry point.
- **`apps/desktop/main/ipc.ts`** — Added `diagnostics:export` case that delegates to the new orchestrator.
- **`apps/desktop/src/main.tsx`** — Added `"export"` to `DiagnosticsActionId`, `exportResult` state, `triggerExport` callback, an "Export Diagnostics" action card, and a success path display.
- **`apps/desktop/main/index.ts`** — Added a `Help` menu with `Export Diagnostics…` item that calls `exportDiagnostics()` with `source: "help-menu"`.
- ZIP uses deflate (method 8, level 6) via Node's built-in `zlib` — ~70-80% size reduction on text-heavy logs, no external deps. ZIP was chosen over tar.gz for native macOS double-click support.
- ZIP entries carry real file modification timestamps (DOS datetime from `fs.stat` mtime); generated in-memory entries (manifest, environment summary) use export time.
- Runtime unit log paths are taken from `orchestrator.getRuntimeState()` rather than being hardcoded. Units with `launchStrategy === "embedded"` are skipped — they run in-process and never write to their declared `logFilePath`.
- OpenClaw config path is derived from `app.getPath("userData")/runtime/openclaw/config/openclaw.json`, mirroring the manifests.ts convention.
- Redaction covers two layers: (1) JSON key-name matching (`token|password|secret|key|dsn` → `"[REDACTED]"`), (2) URL-embedded param/fragment values (`?token=…`, `#token=…`, etc. → `=[REDACTED]`) applied to all string values in JSON and to all log text.

### Verification

- `pnpm --filter @nexu/desktop typecheck` — passes cleanly.
- `pnpm lint` — passes cleanly after format fix.
- Manual testing requires a running desktop runtime (`pnpm start`); exercise from the Diagnostics page export button and from `Help -> Export Diagnostics…`.
- Known V1 limitations: large log files are exported as-is (no truncation).

- V1 intentionally favors a small export flow over a deeper layered architecture.
- Prefer a single export orchestrator file first; split collector/redactor/archive helpers later only if V1 grows.
- Improvement ideas for V2:
  - Better log size limits and truncation markers.
  - More robust structured redaction rules and audit counts.
  - Additional entry points inside the end-user product UI.
  - Optional direct upload/share workflow for support cases.
