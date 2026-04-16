# Windows compatibility audit (whole repo)

Tracking ticket: follow-up to issue #920. The branch `fix/win-skill-install`
addresses the immediate skill-install failure path. This document expands the
original controller-only audit into a repo-wide map of remaining
Windows-compatibility hazards so they can be triaged into follow-up branches.

## Method

Grep targets across `apps/`, `packages/`, `scripts/`, `openclaw-runtime/`
(skipped: `node_modules`, `.tmp`, `dist`, `.dist-runtime`, `.worktrees`):

- `child_process` invocations: `execFile`, `execFileSync`, `exec`, `execSync`, `spawn`, `spawnSync`
- POSIX-only binaries on PATH: `pgrep`, `pkill`, `lsof`, `osascript`, `launchctl`, `defaults`, `mdfind`, `pbcopy`, `cp -R`, `unzip`, `chmod`, etc.
- Hard-coded POSIX paths: `/usr/`, `/tmp/`, `~/`, `$HOME` (in code)
- Path-separator assumptions: `.startsWith("/")` used as "absolute" check, manual `"/"` joins
- macOS-specific APIs: launchd, LSUIElement, `~/Library/...`
- POSIX-only signals: `SIGUSR1`, `SIGUSR2`, `SIGHUP`
- File-system specifics: `fs.symlinkSync`, `fs.chmod`, reserved Windows names
- Build / dev scripts: `.sh`, `.zsh`, `.bash`, `package.json` shell syntax

## Status legend

- ✅ already cross-platform safe (this branch or earlier)
- 🔴 critical: Windows users hit it in normal flow — fix soon
- 🟡 medium: edge case or dev-only impact — fix when convenient
- 🟢 low: gated, doc-only, or graceful fallback already present

## Findings

### Controller — `apps/controller/`

| File:line | Operation | Status | Notes |
|---|---|---|---|
| `services/skillhub/catalog-manager.ts:683` | `npm install` via spawn | ✅ | Routed through `npm-runner.ts` with `shell: true` on Win32 + npm preflight (this branch). |
| `services/skillhub/catalog-manager.ts:206-211` | `tar` extract | ✅ | Has Win32 branch with `--force-local` fallback for bsdtar. |
| `services/skillhub/catalog-manager.ts:290,333,507` | clawhub via `process.execPath` | ✅ | Invokes Node directly with JS entry — no PATH lookup, no `.cmd` shim. |
| `services/skillhub/zip-importer.ts:75,87,101,109` | `unzip` / `cp` | ✅ | Replaced with PowerShell `Expand-Archive` + `fs.cpSync` (this branch). |
| `services/skillhub/skill-db.ts:352` | `sqlite3` CLI | 🟡 | One-shot legacy DB migration. Silently fails on Windows users without `sqlite3`. **Fix:** use `better-sqlite3` (already a dep) to read the legacy DB. |
| `runtime/openclaw-process.ts:694` | `/usr/bin/pgrep -f 'openclaw.*gateway'` | 🔴 | Hard-coded Unix path, no platform guard. Used to detect orphan OpenClaw processes; on Windows it silently no-ops, leaving stale processes after restarts and possibly causing port conflicts. **Fix:** gate by `process.platform !== "win32"` and add a `tasklist /FI` Windows branch (or no-op if Windows uses a different supervisor architecture). |
| `runtime/openclaw-process.ts:304` | `launchctl kickstart` | 🟢 | Reachable only when supervised by launchd, which is macOS-only. Verify call-site context never invokes on Win32. |
| `services/channel-service.ts:1595` | `launchctl kickstart` | 🟢 | Same as above. Verify gating at call site. |
| `services/model-provider-service.ts:1227` | `execFile` (dynamic cmd) | 🟡 | Audit the actual `cmd` value at runtime — same `.cmd` / `.exe` shim caveat as `npm`. If it ever resolves to a `.cmd`, needs `shell: true`. |
| `routes/desktop-routes.ts:138` | dynamic `cmd` open-folder | 🟡 | Resolves to `explorer.exe` on Win32, `open` on Mac, `xdg-open` on Linux per platform branch. Uses `execFile` without `shell: true` — direct `.exe` is fine, but if anyone routes a `.cmd` shim through here it will fail. Add `shell: true` defensively on Win32, or document the constraint. |
| `runtime/openclaw-ws-client.ts:146`, `static/runtime-plugins/openclaw-weixin/src/auth/accounts.ts:218` | `fs.chmodSync(..., 0o600)` | ✅ | Wrapped in try-catch — chmod is a no-op on Windows but doesn't throw. |
| `runtime/sessions-runtime.ts:1571` | `process.env.HOME` | ✅ | Falls back to `os.homedir()` — portable. |

### Desktop — `apps/desktop/`

| File:line | Operation | Status | Notes |
|---|---|---|---|
| `main/services/launchd-bootstrap.ts` (entire) | launchd suite | ✅ | Macos-only by design. Win32 branch at line 535 no-ops the entire launchd stack; desktop on Windows uses the in-process orchestrator instead. |
| `main/services/launchd-bootstrap.ts:1672` | `lsof +D` | ✅ | Gated by Win32-returns-false branch above. |
| `main/services/launchd-bootstrap.ts:1474` | `pgrep -P` | ✅ | Same gating. |
| `main/services/launchd-manager.ts` | `launchctl` operations | ✅ | macOS-only by design; not invoked on Win32. |
| `main/bootstrap.ts:177` | `reg.exe query` | ✅ | Windows-only code path, correctly gated. |
| `main/platforms/shared/runtime-roots.ts:5` | `process.env.HOME` for `~` expansion | 🟡 | Should use `os.homedir()` directly — `process.env.HOME` is undefined on Windows. Currently mostly OK because the affected code paths are dev-mode helpers, but it's a latent bug. |
| `tests/desktop/create-symlink.ts:15-19` | `fs.symlinkSync` | 🟢 | Windows requires admin or Developer Mode. Test gracefully skips with `KnownSymlinkPlatformGapError`. Non-blocking but limits coverage. |

### Web — `apps/web/`

No Windows hazards identified. React/Vite/TypeScript only; no spawn or filesystem assumptions.

### Shared / dev-utils — `packages/`

| File:line | Operation | Status | Notes |
|---|---|---|---|
| `packages/dev-utils/src/process.ts:67-75` | `lsof` for port detection (Darwin path) | ✅ | Win32 branch routes through `tasklist` / `netstat` correctly; Linux uses `/proc`. |

### openclaw-runtime — `openclaw-runtime/`

| File:line | Operation | Status | Notes |
|---|---|---|---|
| `openclaw-runtime/install-runtime.mjs` | `npm ci` / `npm install` postinstall | 🟡 | Spawns `npm` to install runtime deps. Uses `shell: false` per Node defaults; same `.cmd` shim risk as the controller had. **Validate on Windows:** does `pnpm install` succeed at the runtime postinstall step? If not, add `shell: process.platform === "win32"`. |

### Scripts — `scripts/`

| File | Operation | Status | Notes |
|---|---|---|---|
| `scripts/launchd-lifecycle-e2e.sh` | shell script, `launchctl` | ✅ | Explicitly checks `uname = Darwin` at line 149 and skips otherwise. |
| `scripts/dev-launchd.sh` | launchd dev wrapper | ✅ | macOS-only entry; Win32 dev flow goes through `scripts/dev/src/shared/platform/desktop-dev-platform.win32.*` instead. |
| `scripts/desktop-stop-smoke.sh` | shell script | 🟡 | macOS-only smoke test. No Windows equivalent yet — Win32 stop semantics differ (no launchd) so a parallel `.ps1` or Node script should be added when Windows packaging stabilizes. |
| `scripts/dev/` (TS sources) | platform-aware dev launcher | ✅ | Uses `scripts/dev/src/shared/platform/desktop-dev-platform.{darwin,win32,linux}.ts` for OS-specific handling. |
| `apps/desktop/scripts/*.mjs` | Node-based packaging helpers | ✅ | All written in Node, no shell dependencies. |
| `apps/desktop/package.json` scripts | electron-builder invocations | ✅ | No shell syntax (`cp`, `rm`, `chmod`, `find -exec`). Uses Node helpers. |

### Process / signal usage

| Pattern | Status | Notes |
|---|---|---|
| `process.kill(pid, "SIGKILL")` | ✅ | Translated to TerminateProcess on Windows by Node. |
| `process.kill(pid, 0)` for existence | ✅ | Cross-platform with consistent error semantics. |
| `SIGUSR1` / `SIGUSR2` / `SIGHUP` | ✅ | Only mentioned in comments; not delivered by code. |
| `SIGINT` / `SIGTERM` handlers | ✅ | Both delivered on Windows (with caveats: `SIGTERM` from external `taskkill /T` works; from non-tree kill it doesn't). |

## Critical findings (🔴)

Only one truly critical item beyond what this branch already fixes:

### `runtime/openclaw-process.ts:694` — hard-coded `/usr/bin/pgrep`

```ts
const output = execSync("/usr/bin/pgrep -f 'openclaw.*gateway'", { … });
```

On Windows, this path doesn't exist; `execSync` throws ENOENT. The catch (if any) silences the orphan sweep, so OpenClaw gateway processes from a previous session can survive across restarts → port conflicts, stale state, mysterious "address in use" errors.

**Fix:** branch by platform:

```ts
if (process.platform === "win32") {
  // tasklist /FI "IMAGENAME eq openclaw*.exe" /FO CSV
} else {
  execSync("/usr/bin/pgrep -f 'openclaw.*gateway'", …);
}
```

Or, if Windows uses a different supervisor architecture entirely, no-op on Win32 with a telemetry log.

## Suggested follow-up branches (priority order)

1. **`fix/win-openclaw-orphan-sweep`** (🔴) — Gate `runtime/openclaw-process.ts:694`. Add Win32 `tasklist`/`taskkill` equivalent or platform no-op. Single-file change. **Ship before any Windows packaged release.**
2. **`fix/win-skillhub-sqlite-migration`** (🟡) — Swap `execFileSync("sqlite3", …)` for `better-sqlite3` reads in `skill-db.ts:352`. Removes the only remaining external-binary dependency in the skill DB layer. Migration only fires on legacy installs; impact is bounded.
3. **`fix/win-runtime-env-portability`** (🟡) — Replace `process.env.HOME` with `os.homedir()` everywhere it's used as a tilde-expansion fallback (`runtime-roots.ts:5` is the main offender). Tiny diff, prevents future Windows dev-mode regressions.
4. **`fix/win-defensive-shell`** (🟡) — Audit `model-provider-service.ts:1227` and `desktop-routes.ts:138` — both use `execFile` with a dynamic `cmd`. Add `shell: process.platform === "win32"` defensively so future `.cmd`/`.bat` resolution doesn't regress like `npm` did.
5. **`fix/win-runtime-postinstall-spawn`** (🟡) — Verify `openclaw-runtime/install-runtime.mjs` npm spawn works on Windows. If not, apply the same `shell: true` fix as `npm-runner.ts`.
6. **`chore/win-platform-coverage`** (🟢) — Add a Vitest that statically asserts the controller does not invoke POSIX-only binaries on the Win32 path. Lightweight regression guard.
7. **`docs/win-stop-smoke-script`** (🟢) — Port `desktop-stop-smoke.sh` to a Node script (or PowerShell) so Windows packaging gets the same post-stop verification.

## Summary

The codebase is largely well-gated for Windows. The two highest-impact fixes
(npm with `shell: true` and the PowerShell-based zip importer) ship in the
current `fix/win-skill-install` branch and unblock the most common user flow.

Beyond that, **one critical hazard remains** (`pgrep` orphan sweep), and a
handful of medium-priority items concentrate around legacy assumptions
(`sqlite3` shellout, `process.env.HOME`, defensive `shell: true` on dynamic
spawns). The shell scripts and launchd suite are intentionally macOS-only and
correctly guarded — the desktop on Windows uses a different process model
entirely (in-process orchestrator instead of launchd), so launchd code paths
are unreachable.

A focused 2–3 PR sequence (#1, then #2/#3 in parallel, then #4–#7 in a small
batch) brings the controller and packaged desktop to full Windows parity.
