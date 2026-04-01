# Desktop Runtime Guide

This guide covers desktop-specific working rules, structure, and troubleshooting for `apps/desktop`.

## Observability boundary

- Optimize first for agent/debugging efficiency, not human-facing control panel UX.
- Prefer changes inside `apps/desktop/main/`, `apps/desktop/src/`, and `apps/desktop/shared/` when improving local runtime observability.
- Desktop-internal observability changes may be relatively aggressive when they improve structured diagnostics, event correlation, runtime state introspection, or local log transport reliability.
- Keep the boundary strict for `apps/web` and `apps/controller`: default to no changes.
- If touching `apps/web` or `apps/controller` is unavoidable for desktop observability work, limit the change to logging only: log fields, log level, stable reason codes, or propagation of desktop correlation ids.
- Do not use desktop observability work as a reason to refactor behavior, state models, or interfaces in `apps/web` or `apps/controller`.
- Prefer machine-queryable diagnostics over presentation-oriented additions: structured events, reason codes, action ids, session/boot correlation ids, and incremental event streams.

## Directory structure

- `apps/desktop/main/` — Electron main-process code: app bootstrap, IPC registration, runtime orchestration, updater integration, and file/log side effects.
- `apps/desktop/main/runtime/` — Local runtime supervision only: manifests, unit lifecycle, structured runtime logging, probes, and process state transitions.
- `apps/desktop/preload/` — Narrow bridge surface between Electron main and renderer. Keep it thin and explicit.
- `apps/desktop/src/` — Renderer UI only. Prefer consuming typed host APIs instead of embedding Electron/runtime knowledge directly in components.
- `apps/desktop/src/lib/` — Renderer-side adapters for host bridge calls and desktop-specific client helpers.
- `apps/desktop/shared/` — Contracts shared by main/preload/renderer, including host API types and runtime config structures. Prefer putting cross-boundary types here first.
- `apps/desktop/scripts/` — Build, packaging, and sidecar preparation scripts. Keep runtime behavior out of these scripts unless it is strictly packaging-related.
- `apps/controller/src/services/skillhub/` — SkillHub catalog/install/uninstall logic. Runs in the controller process, served via HTTP. The web app uses the HTTP SDK — never IPC.
- Keep process-management logic out of renderer files; keep presentation logic out of `main/`; keep cross-boundary DTOs out of feature-local files when they are shared by IPC.

## External runtime extraction (packaged mode)

In packaged mode, launchd services must NOT reference files inside the `.app` bundle — otherwise macOS Finder reports "app is in use" and blocks drag-and-drop reinstall. The solution: APFS-clone the Electron runtime and sidecars to `~/.nexu/runtime/` on first launch.

### What gets extracted

| Source (inside .app) | Destination (outside .app) | Method |
|---|---|---|
| `Contents/MacOS/<binary>` + `Contents/Frameworks/` | `~/.nexu/runtime/nexu-runner.app/Contents/` | APFS clone (`cp -Rc`), near-zero disk |
| `Contents/Resources/runtime/controller/` | `~/.nexu/runtime/controller-sidecar/` | APFS clone (`cp -Rc`) |
| `Contents/Resources/runtime/openclaw/payload.tar.gz` | `~/.nexu/runtime/openclaw-sidecar/` | tar extract (existing logic) |

### Version stamping

Each extracted directory has a `.version-stamp` file containing the app version. On startup, `resolveLaunchdPaths()` compares the stamp against `app.getVersion()`:
- Match → fast path, use existing extraction
- Mismatch → re-extract via staging dir + atomic rename
- Missing stamp → treat as mismatch (conservative)

### Extraction flow

1. Clone to `${targetDir}.staging` (temp directory)
2. Verify critical entry point exists in staging
3. Write version stamp inside staging
4. `rm -rf` old target directory
5. `mv` staging to final location (atomic on same filesystem)
6. On startup, any leftover `.staging` directories are cleaned up

### Fallback

If extraction fails (disk full, permissions), `resolveLaunchdPaths()` falls back to in-bundle paths (`process.execPath` for node runner, `Contents/Resources/runtime/controller/` for controller). The app will work but Finder will report "app is in use" during reinstall.

### Binary name detection

The Electron binary name is read from `Info.plist` (`CFBundleExecutable`) instead of being hardcoded, so the extraction works even if the product is renamed.

## Launchd service management (packaged mode)

Packaged desktop uses macOS launchd to manage controller and openclaw as independent system services. This means services survive Electron crashes and can be reattached on next launch.

### Service labels
- Production: `io.nexu.controller`, `io.nexu.openclaw`
- Dev mode: `io.nexu.controller.dev`, `io.nexu.openclaw.dev`

### Session attach

On startup, `bootstrapWithLaunchd()` checks `runtime-ports.json` for a previous session. Attach is only allowed if ALL identity fields match:
- `appVersion` — prevents attaching to services from an older build
- `userDataPath` — prevents cross-environment attach
- `buildSource` — prevents stable/beta/dev cross-attach
- `openclawStateDir` — prevents state directory mismatch
- `NEXU_HOME` — prevents home directory mismatch

If any field mismatches (or is missing from the previous session), stale services are auto-booted-out and a fresh cold start is performed. This is transparent to the user (~2-3s slower).

### Stale session detection

If the previous Electron PID is dead AND `runtime-ports.json` is older than 5 minutes, all services are auto-booted-out before proceeding (handles Force Quit scenarios).

### runtime-ports.json

Written atomically (tmp + rename) after each successful bootstrap. Contains port assignments, identity fields, and the Electron PID for stale detection.

## Update install safety

`update-manager.ts` uses an evidence-based install decision:

1. **teardownLaunchdServices()** — bootout launchd services, kill orphan processes
2. **orchestrator.dispose()** — stop managed child processes
3. **ensureNexuProcessesDead()** — two sweeps of SIGKILL (15s + 5s), using both launchd labels and pgrep pattern matching
4. **checkCriticalPathsLocked()** — `lsof +D` check on `.app` bundle, runner, and sidecar directories
5. **Decision**:
   - No processes, no locks → install
   - Processes alive but no critical file locks → install (harmless residual)
   - Critical paths locked → skip this attempt; electron-updater retries next launch

### Orphan cleanup hierarchy

1. **Authoritative**: launchd label lookup (`launchctl print`) + stored PIDs from `runtime-ports.json`
2. **Fallback**: `pgrep -f` with `node.*` prefix patterns, excluding current process tree
3. Pattern matching is a last resort — prefer label-based cleanup

## Controller sidecar packaging

The controller is bundled into the desktop distributable as a sidecar. The script `apps/desktop/scripts/prepare-controller-sidecar.mjs` uses `copyRuntimeDependencyClosure` to recursively deep-copy every `dependency` from `apps/controller/package.json` (and all their transitive deps) into `.dist-runtime/controller/node_modules/`.

**Rules:**

- **Keep controller deps minimal.** Each MB in controller `dependencies` adds ~1 MB to the final DMG/ZIP.
- **Never add heavy CLI tool packages** (e.g. `npm`, `yarn`) as controller dependencies. If the controller needs to invoke a CLI tool, use PATH-based `execFile("npm", ...)` instead.
- **Native Node.js addons** (e.g. `better-sqlite3`) must live in the controller, NOT in the Electron main process. Electron's built-in Node.js uses a different ABI version (`NODE_MODULE_VERSION`) from system Node.js, which causes "compiled against a different Node.js version" errors. The controller runs as a regular Node.js process (`ELECTRON_RUN_AS_NODE=1`), so native addons work without `electron-rebuild`.

**Before adding a controller dependency**, check its size:
```bash
du -sh node_modules/.pnpm/<pkg>@*/node_modules/<pkg>/
```
If total size (including transitive deps) exceeds ~5 MB, consider alternatives: PATH-based invocation, optional dependencies, or lazy runtime download.

## System proxy behavior

Desktop proxy handling is explicit and split by network surface:

- Electron / Chromium traffic reads one normalized proxy policy at startup.
- If `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` is present, Electron uses explicit fixed proxy rules derived from env.
- If no proxy env var is present, Electron falls back to system proxy mode.
- Local loopback traffic is always bypassed with `<local>`, `localhost`, `127.0.0.1`, and `::1` merged into the effective bypass list.
- The desktop propagates normalized `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` into the web sidecar and controller/OpenClaw process tree.
- Controller outbound HTTP uses the shared proxy-aware fetch layer, while desktop-to-controller loopback traffic stays direct.

`ALL_PROXY` is treated as the fallback proxy for both HTTP and HTTPS when scheme-specific env vars are absent.

### Dev vs packaged behavior

- Dev (`pnpm start`): desktop reads proxy env from the launching shell, normalizes mixed-case variants, merges loopback bypass entries, and passes the normalized uppercase env into child processes.
- Packaged app: Electron still applies the same normalized proxy policy, but child processes rely on the env values written into the desktop runtime manifests / launchd plists rather than the user's shell preserving mixed-case env vars.
- In both modes, the canonical `NO_PROXY` always includes `localhost,127.0.0.1,::1` even if the operator omitted them.

### Proxy diagnostics

`desktop-diagnostics.json` now includes a `proxy` snapshot with:

- `source`: `env`, `system`, or `direct`
- redacted proxy env values (`httpProxyRedacted`, `httpsProxyRedacted`, `allProxyRedacted`)
- normalized bypass entries
- Electron proxy mode / bypass rules
- `resolveProxy(...)` results for controller, OpenClaw, and a representative external HTTPS URL

Use this snapshot to confirm that local controller/OpenClaw URLs resolve to direct/bypass behavior while external URLs resolve through the expected proxy mode.

## Common troubleshooting

## Local State Map

### Dev desktop (`pnpm start` / `pnpm restart`)

- Electron `userData`: `<repo>/.tmp/desktop/electron`
- Desktop logs: `<repo>/.tmp/desktop/electron/logs`
- Desktop main log: `<repo>/.tmp/desktop/electron/logs/desktop-main.log`
- Cold-start log: `<repo>/.tmp/desktop/electron/logs/cold-start.log`
- Desktop diagnostics snapshot: `<repo>/.tmp/desktop/electron/logs/desktop-diagnostics.json`
- Startup health state: `<repo>/.tmp/desktop/electron/startup-health.json`
- Runtime unit logs: `<repo>/.tmp/desktop/electron/logs/runtime-units`
- Controller unit log: `<repo>/.tmp/desktop/electron/logs/runtime-units/controller.log`
- Other managed unit logs: `<repo>/.tmp/desktop/electron/logs/runtime-units/<unit>.log`
- Desktop wrapper log: `<repo>/.tmp/logs/desktop-dev.log`
- Desktop startup timeline log: `<repo>/.tmp/logs/desktop-startup-timeline.log`
- OpenClaw runtime root: `<repo>/.tmp/desktop/electron/runtime/openclaw`
- OpenClaw config: `<repo>/.tmp/desktop/electron/runtime/openclaw/config/openclaw.json`
- OpenClaw state: `<repo>/.tmp/desktop/electron/runtime/openclaw/state`
- OpenClaw native log: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- Desktop-scoped Nexu home: `<repo>/.tmp/desktop/electron/.nexu`
- Controller `NEXU_HOME`: points to the desktop-scoped path above when launched by desktop dev
- Repo-local reset command: `pnpm reset-state` or `./apps/desktop/dev.sh reset-state`

### Packaged desktop (DMG-installed app)

- Electron `userData`: `~/Library/Application Support/@nexu/desktop`
- Override for local packaged testing: `NEXU_DESKTOP_USER_DATA_ROOT`
- Desktop logs: `~/Library/Application Support/@nexu/desktop/logs`
- Desktop main log: `~/Library/Application Support/@nexu/desktop/logs/desktop-main.log`
- Cold-start log: `~/Library/Application Support/@nexu/desktop/logs/cold-start.log`
- Desktop diagnostics snapshot: `~/Library/Application Support/@nexu/desktop/logs/desktop-diagnostics.json`
- Startup health state: `~/Library/Application Support/@nexu/desktop/startup-health.json`
- Runtime unit logs: `~/Library/Application Support/@nexu/desktop/logs/runtime-units`
- Controller unit log: `~/Library/Application Support/@nexu/desktop/logs/runtime-units/controller.log`
- Other managed unit logs: `~/Library/Application Support/@nexu/desktop/logs/runtime-units/<unit>.log`
- OpenClaw runtime root: `~/Library/Application Support/@nexu/desktop/runtime/openclaw`
- OpenClaw state: `~/Library/Application Support/@nexu/desktop/runtime/openclaw/state`
- OpenClaw native log: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- Desktop-scoped Nexu home: `~/Library/Application Support/@nexu/desktop/.nexu`
- Controller `NEXU_HOME`: points to the desktop-scoped path above when launched from the packaged app
- External node runner: `~/.nexu/runtime/nexu-runner.app/` (APFS-cloned Electron binary + Frameworks)
- External controller sidecar: `~/.nexu/runtime/controller-sidecar/` (APFS-cloned controller dist + node_modules)
- External openclaw sidecar: `~/.nexu/runtime/openclaw-sidecar/` (extracted from .app payload)
- Launchd plist directory: `~/Library/LaunchAgents/` (`io.nexu.controller.plist`, `io.nexu.openclaw.plist`)
- Runtime ports metadata: `~/Library/LaunchAgents/runtime-ports.json` (session identity + port assignments)

### How to use the logs

- Start with the desktop wrapper log in dev when `pnpm start` fails before Electron is fully up: `<repo>/.tmp/logs/desktop-dev.log`
- Check `cold-start.log` for boot milestones and early main-process startup sequencing
- Check `desktop-main.log` for main-process runtime behavior, auth recovery, renderer-side forwarded events, and desktop lifecycle diagnostics
- Check `logs/runtime-units/*.log` for sidecar process logs, especially `controller.log`
- Check `/tmp/openclaw/openclaw-YYYY-MM-DD.log` for OpenClaw-native channel traffic, agent dispatch, config reloads, hook activity, and model override behavior
- When exporting diagnostics, the app bundles `desktop-main.log`, `cold-start.log`, `logs/runtime-units/*`, `desktop-diagnostics.json`, `startup-health.json`, and `/tmp/openclaw/openclaw-*.log`

### What `reset-state` actually does

- `pnpm reset-state` is a dev-only command that runs `./apps/desktop/dev.sh reset-state`
- It stops the tmux-managed desktop stack and removes `$NEXU_DESKTOP_RUNTIME_ROOT`, which is the repo-local desktop runtime root in dev
- In practice this clears repo-local desktop runtime data such as desktop `userData`, generated OpenClaw config/state, agent workspaces, runtime sessions, and desktop logs under `.tmp/desktop/`
- It does not touch packaged-app data under `~/Library/Application Support/@nexu/desktop`
- It does not touch any separately managed `~/.nexu/` state from non-desktop workflows or older local setups

### Full local wipe checklist

- For a normal dev reset, run `pnpm reset-state`
- For a full local wipe, run `pnpm stop`, remove `<repo>/.tmp/desktop/`, then remove `~/.nexu/` (includes extracted runtime sidecars and runner) and `~/Library/Application Support/@nexu/desktop/` if you also want to discard all packaged-app state
- Use the full wipe when you want to forget bots, channels, model selections, generated OpenClaw state, extracted runtime, and any leftover controller state from earlier local runs

- `a locally packaged app needs build-time overrides`
  - Put local-only packaged-app settings in `apps/desktop/.env` and keep that file untracked.
  - Start from `apps/desktop/.env.example`.
  - `apps/desktop/scripts/dist-mac.mjs` reads `apps/desktop/.env` during packaging and bakes those values into `apps/desktop/build-config.json` for the packaged app to read at runtime.
  - Use this for packaged-app-only flags such as `NEXU_DESKTOP_AUTO_UPDATE_ENABLED=false` when you want a local build to skip update checks.
  - Use `NEXU_DESKTOP_RELEASE_DIR=/absolute/output/path` when you want packaged artifacts written somewhere other than `apps/desktop/release`.

- `desktop won't cold start`
  - Start with `pnpm logs` and `./apps/desktop/dev.sh devlog`.
  - Then inspect `cold-start.log`, `desktop-main.log`, and `logs/runtime-units/*.log` under the desktop logs directory.
  - If the issue may be proxy-related, inspect `desktop-diagnostics.json` `proxy.source`, `proxy.env`, `proxy.bypass`, and `proxy.resolutions` before changing runtime code.
  - If the issue looks power-management related, inspect `desktop-diagnostics.json` `sleepGuard` plus `desktop-main.log` entries with `source=sleep-guard` to confirm the blocker type, power-source transitions, and whether a `suspend` was still observed.
  - Correlate by `desktop_boot_id` first, then `desktop_session_id` if auth/session recovery is involved.
  - If `tmux session 'nexu-desktop' is not running` immediately after start, verify `pnpm -C apps/desktop exec electron --version` succeeds.
  - If `pnpm exec electron` works but `pnpm run start:electron` fails to resolve `electron/cli.js`, prefer `pnpm exec electron .` inside `apps/desktop/package.json` and then rebuild from the standard `pnpm start` path.

- `external requests fail only behind a corporate proxy`
  - Confirm the launching environment or packaged launchd manifests include the expected uppercase proxy env vars.
  - Inspect `desktop-diagnostics.json` and verify `proxy.source === "env"` when env proxying is expected.
  - Check that `proxy.resolutions` shows local controller/OpenClaw URLs bypassed and the external URL resolved through the proxy.
  - Confirm `NO_PROXY` still includes `localhost,127.0.0.1,::1`; removing loopback bypass should never be required.
  - If Electron resolves external traffic through `system` mode but controller traffic still fails, compare the controller child-process env in the runtime manifests / launchd plists with the normalized desktop diagnostics snapshot.

- `a runtime unit looks running but behavior is broken`
  - Check the unit's structured lifecycle/probe logs in `apps/desktop/main/runtime/` outputs before changing UI.
  - Verify whether the issue is process presence, port readiness, auth bootstrap, or delegated-process detection.
  - Prefer fixing state/probe semantics in the orchestrator instead of adding renderer-side heuristics.

- `control panel state looks stale or noisy`
  - Inspect `apps/desktop/main/runtime/daemon-supervisor.ts` first, especially polling, probe, and state-transition logging paths.
  - Reduce duplicate event emission in main process before adding renderer filtering.

- `you need a deeper runtime event query than the control panel shows`
  - Keep the control panel minimal; use the host query interface instead of adding temporary UI.
  - Query through the desktop bridge with `runtime:query-events` / `queryRuntimeEvents(...)` and filter by `unitId`, `actionId`, `reasonCode`, `afterCursor`, and `limit`.
  - Treat `cursor` as the incremental checkpoint for agent/debug sessions; use `nextCursor` to continue from the last seen event instead of re-reading a whole tail.
  - Prefer event queries for chain reconstruction; keep `RuntimeUnitState` focused on only the highest-value current signals.

- `desktop observability work starts touching api/web/gateway`
  - Re-check the observability boundary above.
  - Default answer is to move the change back into desktop unless the only missing piece is a log field, level, reason code, or correlation id.

- `unclear where a new type or helper belongs`
  - If it crosses main/preload/renderer boundaries, put it in `apps/desktop/shared/`.
  - If it only affects runtime supervision, keep it in `apps/desktop/main/runtime/`.
  - If it only changes UI rendering, keep it in `apps/desktop/src/`.
