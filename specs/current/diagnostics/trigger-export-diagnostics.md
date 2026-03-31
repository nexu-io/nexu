# Desktop `Export Diagnostics` Execution Guide

Export the diagnostics bundle via the menu `Help -> Export Diagnostics…`.

## Execution Method

### 1) Confirm the desktop app is running

```bash
pnpm desktop:status
```

Expect to see tmux session `nexu-desktop` in running state.

If not running, start the desktop app first:

```bash
pnpm desktop:start
```

### 2) Trigger the menu and save via AppleScript (Agent Execution Spec)

Goal: Export a zip via `Help -> Export Diagnostics…` to `<nexu-repo-root>/.tmp/diagnostics`.

Do not treat the AppleScript as a "fixed script to run all at once." Instead, execute it as a state machine: **locate process -> focus -> click menu -> wait for save panel -> enter path and save -> verify output**.

#### Root Causes of Failure (must understand first)

- `keystroke` / `key code` are sent to the current foreground window, not bound to process `p`.
- `set frontmost of p to true` done only once is not enough — focus can be stolen by user actions or system dialogs during execution.
- The save sheet may appear with jitter; a fixed `delay` may cause premature input, resulting in missed keystrokes or input sent to the wrong window.

#### Agent Execution Principles

1. Re-confirm the target process is frontmost before every critical action (at minimum: before clicking the menu, before sending keystrokes).
2. Only send `Cmd+Shift+G` and the return key sequence after detecting that `sheet 1 of window 1 of p` exists.
3. All UI actions should allow limited retries (recommended 2–3 times); failures must be reported explicitly, never silently swallowed.
4. Do not rely on "command exit code success"; always verify output by checking file timestamps to confirm a new zip was actually produced.

#### Key Code Snippets (for composition — do not hardcode into a single long script)

Get PID:

```bash
PID=$(ps -ax -o pid,command | rg "Electron apps/desktop$" | awk '{print $1}' | head -n 1)
```

Focus target process:

```applescript
tell application "System Events"
  set p to first process whose unix id is (targetPid as integer)
  set frontmost of p to true
end tell
```

Click menu item:

```applescript
click menu item "Export Diagnostics…" of menu 1 of menu bar item "Help" of menu bar 1 of p
```

Wait for save sheet:

```applescript
repeat 40 times
  tell application "System Events"
    if exists sheet 1 of window 1 of p then exit repeat
  end tell
  delay 0.1
end repeat
```

Enter directory and confirm save:

```applescript
keystroke "G" using {command down, shift down}
keystroke "<nexu-repo-root>/.tmp/diagnostics"
key code 36
key code 36
```

## Verification Commands

Immediately confirm the file exists after export — check the file timestamp:

```bash
ls -lt <nexu-repo-root>/.tmp/diagnostics/nexu-diagnostics-*.zip
```

Also recommended to check the export bundle size and large file distribution:

```bash
ZIP=<nexu-repo-root>/.tmp/diagnostics/nexu-diagnostics-<timestamp>.zip
TMP=<nexu-repo-root>/.tmp/diagnostics-check
rm -rf "$TMP" && mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
du -ah "$TMP"/nexu-diagnostics-* | sort -hr | head -n 20
```

## Export Bundle Directory Structure (confirmed)

After extraction, there should be a single top-level directory — files will not be scattered into the current directory:

```text
nexu-diagnostics-<timestamp>/
├── diagnostics/
│   ├── desktop-diagnostics.json
│   ├── startup-health.json
│   ├── sentry/
│   │   └── *.json
│   └── crashes/
│       └── *.json
├── logs/
│   ├── cold-start.log
│   ├── desktop-main.log
│   ├── openclaw/
│   │   └── openclaw-*.log
│   └── runtime-units/
│       ├── controller.log
│       ├── openclaw.log
│       └── web.log
├── config/
│   └── openclaw.json
└── summary/
    ├── additional-artifacts.json
    ├── app-signing.json
    ├── environment-summary.json
    ├── machine-info.json
    ├── manifest.json
    └── startup-probe-summary.json
```

Recommended: use the following command to inspect the ZIP internal paths directly (more reliable than Finder):

```bash
unzip -l <nexu-repo-root>/.tmp/diagnostics/nexu-diagnostics-<timestamp>.zip
```

## New Information Notes (for troubleshooting completeness)

- `diagnostics/startup-health.json`
  - Upgrade/rollback health status (failure count, version, last check time).
- `diagnostics/sentry/**/*.json`
  - Local Sentry session/queue/context snapshots (JSON recursively collected, with unified redaction).
- `diagnostics/crashes/*.json`
  - Crash reports from the last 7 days in `DiagnosticReports` with filenames containing `exu`, converted to JSON (includes a `content` text field).
- `logs/openclaw/openclaw-*.log`
  - Native OpenClaw logs from `/tmp/openclaw`, supplementing troubleshooting info beyond runtime-units.
- `summary/additional-artifacts.json`
  - Index of newly collected files (source path, archive path, size, modification time) for quickly determining "did we collect everything?"
- `summary/startup-probe-summary.json`
  - Extracted preload / renderer / main startup probe timeline for locating early boot failures.
- `summary/machine-info.json`
  - Machine architecture, Rosetta check, executable path, and runtime version summary for Intel mac investigations.
- `summary/app-signing.json`
  - `codesign` and `spctl` output for packaged app signature / system assessment troubleshooting.

## Environment Differences (local dev vs packaged build)

- Both runtime modes collect via Electron `userData`-relative paths (avoiding hardcoded legacy paths).
- Local `pnpm restart`: `userData` is at `<repo>/.tmp/desktop/electron`.
- Packaged build: `userData` is at `~/Library/Application Support/@nexu/desktop` (or overridden by `NEXU_DESKTOP_USER_DATA_ROOT`).

## Redaction Check (recommended)

After export, quickly scan for suspected plaintext credentials:

```bash
rg --pcre2 -n -i "gw-secret-token|xox[baprs]-|bearer\s+[a-z0-9._-]{8,}|token\"\s*:\s*\"(?!\[REDACTED\])|password\"\s*:\s*\"(?!\[REDACTED\])|secret\"\s*:\s*\"(?!\[REDACTED\])|dsn\"\s*:\s*\"(?!\[REDACTED\])" \
  <unzipped-diagnostics-root>
```

## Common Issues

1. **Error: `osascript is not allowed assistive access (-1719)`**
   - Grant accessibility permission to the current terminal app: `System Settings -> Privacy & Security -> Accessibility`.

2. **"Path changed but didn't save"**
   - This means only the directory navigation completed, but the final Save was not triggered.
   - Fix: Add one or two extra `return` key presses after the path entry return, and include a short delay in the script.

3. **Switching to another app during execution causes intermittent export failures**
   - Root cause: `keystroke` is sent to the current foreground window — if focus drifts, keystrokes hit the wrong target.
   - Fix: Re-set `frontmost` before every critical action, explicitly wait for the `sheet` to appear; after export, use `ls -lt` to forcibly verify whether a new zip was generated.
