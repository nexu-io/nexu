# Windows shell-out audit (controller)

Tracking ticket: follow-up to issue #920. This branch (`fix/win-skill-install`)
addresses the immediate skill-install failure path. The items below were
discovered during that audit and need their own branch.

## Scope

Grep target: `apps/controller/src` for `execFile`, `execFileSync`, `spawn`,
`execSync`, `spawnSync`.

## Status legend

- ✅ already cross-platform safe (macOS + Windows)
- ⚠️ Windows-only hazard, fix in a follow-up branch
- 🟡 platform-gated (mac-only), no Windows impact

## Findings

| File:line | Command | Status | Notes |
|---|---|---|---|
| `services/skillhub/catalog-manager.ts:206-211` | `tar` | ✅ | Has explicit Win32 branch with `--force-local` fallback for bsdtar. |
| `services/skillhub/catalog-manager.ts:290,333,507` | clawhub via `process.execPath` | ✅ | Invokes Node directly with JS entry — no PATH lookup, no `.cmd` shim. |
| `services/skillhub/catalog-manager.ts:683` (post-fix) | `npm` | ✅ | Now goes through `npm-runner.ts` with `shell: true` on Win32. |
| `services/skillhub/zip-importer.ts:75,87,101,109` (post-fix) | `unzip` / `cp` | ✅ | Replaced with PowerShell `Expand-Archive` on Win32 + `fs.cpSync` for copy. |
| `services/skillhub/skill-db.ts:352` | `sqlite3` | ⚠️ | One-shot legacy DB migration. Will silently fail on Windows users who hit the migration path (no `sqlite3` CLI on default Win install). Low blast radius — only fires once per install when migrating from the pre-v0.1.x ledger. **Fix:** use `better-sqlite3` (already a controller dep) to read the legacy DB instead of shelling out. |
| `services/channel-service.ts:1595` | `launchctl` | 🟡 | macOS-only; channel-service should gate or no-op on Win32. Verify call site is gated. |
| `runtime/openclaw-process.ts:304` | `launchctl` | 🟡 | Same as above; verify the supervisor doesn't reach this branch on Win32. |
| `runtime/openclaw-process.ts:694` | `/usr/bin/pgrep` | ⚠️ | Hard-coded Unix path; this code path needs to be gated by `process.platform !== "win32"` or replaced with a cross-platform process lookup (e.g. `tasklist` on Windows, or skip the orphan-sweep entirely on Win32 if launchd is the only consumer). |
| `routes/desktop-routes.ts:138` | dynamic `cmd` open-folder | ⚠️ | Verify `cmd` here resolves to `explorer.exe` on Windows, `open` on macOS, `xdg-open` on Linux. Currently uses `execFile` without `shell: true`; if `cmd` is `cmd.exe` or any `.cmd` shim this will break the same way `npm` did. |
| `services/model-provider-service.ts:1227` | `execFile` (unspecified) | ⚠️ | Audit the actual `cmd` value — same `.cmd` / `.exe` resolution caveat as desktop-routes. |

## Suggested follow-up branch plan

1. `fix/win-skillhub-sqlite-migration` — swap `execFileSync("sqlite3", …)` for `better-sqlite3` reads.
2. `fix/win-process-supervisor` — gate `pgrep` / `launchctl` paths by platform; provide Win32 equivalents (`tasklist` / `taskkill`) or no-op + telemetry.
3. `fix/win-open-folder` — verify the open-folder command resolution per platform; route `.cmd`/`.bat` shims through `shell: true` or use `process.execPath` for embedded entries.

## Test gap

Add a Vitest that asserts `process.platform === "win32"` paths in the controller
do not invoke posix-only binaries (`unzip`, `cp`, `sqlite3`, `pgrep`,
`launchctl`). A simple grep test or a runtime mock-based test would catch
regressions.
