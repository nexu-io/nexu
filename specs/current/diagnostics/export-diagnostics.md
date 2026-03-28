# Desktop `Export Diagnostics`

## Purpose

`Help -> Export Diagnostics…` exports a shareable diagnostics bundle from the desktop app so startup and runtime issues can be investigated more efficiently.

It is primarily intended for cases such as:

- cold-start failures
- Intel Mac white-screen / crash / no-window startup failures
- renderer / preload / embedded webview startup issues
- OpenClaw / controller / web runtime problems
- local crash, local Sentry cache, and macOS crash report analysis

The goal is to **capture a startup scene as completely as possible** so users do not need to manually gather logs, screenshots, and file paths.

## How it works

### 1. Entry points

The main entry point is the desktop app menu:

- `Help -> Export Diagnostics…`

The renderer-side diagnostics page can trigger the same export flow as well.

### 2. Core flow

The export logic runs in the Electron main process.

At a high level, it does the following:

1. The user triggers export.
2. The main process opens a save dialog.
3. The app collects diagnostics files that are available from the current desktop runtime.
4. JSON files and logs are redacted with the shared scrubbing rules.
5. A ZIP archive is created.
6. The archive is written to the user-selected location.

The main implementation lives in:

- `apps/desktop/main/diagnostics-export.ts`
- `apps/desktop/main/desktop-diagnostics.ts`
- `apps/desktop/main/ipc.ts`
- `apps/desktop/preload/index.ts`
- `apps/desktop/src/main.tsx`

### 3. Startup diagnostics model

To improve Intel Mac startup investigations, the export bundle now includes structured startup probes in addition to the existing logs.

These probes record whether:

- `preload` started running
- `contextBridge` was successfully exposed
- the renderer main module started
- React render actually committed
- renderer Sentry initialization succeeded or failed
- Amplitude initialization succeeded or failed
- the main process observed `did-finish-load`, `did-fail-load`, or `render-process-gone`

The probes are continuously written into `desktop-diagnostics.json`. During export, the app also produces a startup-focused summary so we can quickly tell whether failure happened:

- before or inside preload
- right after renderer JavaScript starts
- during telemetry initialization
- after the page was already mounted

### 4. Intel / macOS environment details

The export also includes machine and signing information that is useful for Intel, Rosetta, and packaged-app validation issues, including:

- `process.arch`
- `uname -m`
- `sysctl.proc_translated`
- `process.versions`
- app executable path
- `codesign` output
- `spctl` output

These commands run only on macOS and use absolute binary paths so the packaged app does not depend on the user's PATH.

## Exported file structure

After extraction, the bundle looks roughly like this:

```text
nexu-diagnostics-<timestamp>/
├── config/
│   └── openclaw.json
├── diagnostics/
│   ├── crashes/
│   │   └── *.json
│   ├── desktop-diagnostics.json
│   ├── sentry/
│   │   └── **/*.json
│   └── startup-health.json
├── logs/
│   ├── cold-start.log
│   ├── desktop-main.log
│   ├── openclaw/
│   │   └── openclaw-*.log
│   └── runtime-units/
│       ├── controller.log
│       ├── openclaw.log
│       └── web.log
└── summary/
    ├── additional-artifacts.json
    ├── app-signing.json
    ├── environment-summary.json
    ├── machine-info.json
    ├── manifest.json
    └── startup-probe-summary.json
```

> Exact contents can vary by runtime mode and failure stage. Missing files are recorded in `summary/manifest.json`.

## Key files

### `diagnostics/desktop-diagnostics.json`

This is the structured desktop diagnostics snapshot. It includes:

- cold-start state
- sleep-guard state
- renderer load / process-gone information
- embedded content state
- runtime state and recent events
- startup probe timeline

### `diagnostics/crashes/*.json`

These are recent macOS crash reports collected from `~/Library/Logs/DiagnosticReports/` for files whose names contain `exu`. They are wrapped into JSON before being added to the export bundle.

### `summary/startup-probe-summary.json`

This is a startup-focused summary derived from `desktop-diagnostics.json`. It is meant to quickly answer questions such as:

- Was preload ever seen?
- Was the renderer ever seen?
- Which telemetry step failed?
- Did the renderer finish loading or go away?

### `summary/machine-info.json`

This file summarizes machine architecture and runtime environment details, especially for Intel / Rosetta analysis.

### `summary/app-signing.json`

This file captures packaged-app signing and system assessment results to help diagnose signing-related launch failures.

## Redaction

The export applies basic redaction before writing files into the ZIP:

- JSON fields matching token / password / secret / key / dsn-like names are replaced
- URL-embedded token fragments inside logs and text payloads are scrubbed

The goal is to preserve debugging value while reducing the chance of exporting sensitive information in plain text.

## Recommended use cases

This feature is especially useful for:

- Intel Macs where the desktop app does not open
- Electron renderer crashes during early startup
- user reports like “it disappears immediately after launch” without a reliable repro
- investigations that need to correlate system crash reports, startup probes, and runtime logs
