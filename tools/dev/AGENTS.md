# AGENTS.md

This file captures local guidance for the `tools/dev` CLI surface.

## CLI style

- Keep the CLI layer simple, explicit, and easy to scan.
- Define commands inline with `cli.command(...)`; do not hide command registration behind loops or abstractions.
- Prefer direct readable control flow over reusable helpers unless repetition becomes truly costly.
- Aim for simple, clean, nearly-strong code rather than cleverness.
- Fail fast when inputs are invalid or execution breaks.
- Do not add defensive orchestration here; let logs expose errors clearly.

## Architecture split

- Keep the local-dev control plane centered in `tools/dev/`.
- Root `package.json` provides the single external entrypoint `pnpm dev ...` and should stay thin.
- `tools/dev/src/` is the assembly layer for service-level local-dev flows such as `web`, `controller`, and later `desktop`.
- Reusable script utilities belong in `packages/dev-utils/src/`.
- `@nexu/dev-utils` should stay limited to repo-level atomic operations and helpers such as `commands`, `conditions`, `lock`, `process`, and path helpers.
- Do not move service orchestration or lifecycle flows into `@nexu/dev-utils`; compose those in `tools/dev/src/` from the atomic helpers.
- Keep command behavior thin in `tools/dev`, but keep service-specific assembly there rather than pushing it down into `@nexu/dev-utils`.
- Runtime outputs belong under `.tmp/dev/`.

## Command surface

- Keep the command surface small and intentional.
- Fresh-machine cold start is: `pnpm install` -> `pnpm --filter @nexu/shared build` -> optional `copy tools/dev/.env.example tools/dev/.env` (Windows) or `cp tools/dev/.env.example tools/dev/.env` (POSIX).
- Daily full-stack flow is: `pnpm dev start` -> work -> `pnpm dev restart` when you need a clean full restart -> `pnpm dev stop` when done.
- Bare `pnpm dev start` runs the lightweight full local stack in dependency order: `openclaw` -> `controller` -> `web` -> `desktop`.
- Bare `pnpm dev restart` restarts that stack by stopping in reverse order and starting again in dependency order.
- Bare `pnpm dev stop` stops that stack in reverse order: `desktop` -> `web` -> `controller` -> `openclaw`.
- Explicit single-service control remains available: `pnpm dev start <desktop|openclaw|controller|web>`, `pnpm dev restart <service>`, `pnpm dev stop <service>`, `pnpm dev status <service>`, and `pnpm dev logs <service>`.
- Do not reintroduce an `all` target or any other alias target name.
- Validate behavior through the real command surface instead of temporary harness scripts.
- Acceptance must be run from the repo root through `pnpm dev ...`, not by invoking `tools/dev` internals directly.
- The focused acceptance chain is: `pnpm dev start` -> `pnpm dev status <service>` / `pnpm dev logs <service>` as needed -> `pnpm dev stop`.
- For a quick full-stack snapshot, prefer bare `pnpm dev status`, which prints `openclaw`, `controller`, `web`, and `desktop` in order.
- For human-friendly local logs, prefer pretty output during manual runs via an env override such as `NEXU_DEV_LOG_PRETTY=true pnpm dev start` (POSIX) or `$env:NEXU_DEV_LOG_PRETTY='true'; pnpm dev start` (PowerShell).

## Runtime model

- Root entrypoint stays `pnpm dev ...`.
- The CLI executes through `pnpm --dir ./tools/dev exec tsx ./src/index.ts`.
- `tools/dev` may use its own `tsconfig.json` features such as `paths`.
- `@nexu/dev-utils` is consumed from built `dist/` output at runtime; after editing `packages/dev-utils`, rebuild it with `pnpm --filter @nexu/dev-utils build` before validating `pnpm dev ...`.
- `tools/dev/.env.example` is the source-of-truth template for dev-only overrides. Only create `tools/dev/.env` when you need local overrides for ports, URLs, state paths, config path, log dir, or the shared OpenClaw gateway token.
- Keep the repo-level pnpm build-script allowlist tight. Do not add Windows-only packaging tools such as `electron-winstaller` unless the team explicitly wants that behavior on every machine.
- Logs should live under `.tmp/dev/logs/<run_id>/...`.
- `pnpm dev logs <service>` should resolve the active session only, prepend a fixed metadata header, and tail at most 200 lines by default.
- Lightweight state should use per-service pid locks under `.tmp/dev/*.pid`.
- Each explicit service start/restart invocation owns its own `sessionId`; do not assume a cross-service aggregate session.
- Dev tracing should stay lightweight: use pid locks, log files, port listeners, and stable process markers rather than adding heavy orchestration or monitoring.

## Recovery model

- Optimize for the practical bar: normal usage should be stable, common failures should be recoverable from the FAQ, and worst-case recovery may rely on a machine restart.
- Prefer lightweight, inspectable recovery over complex self-healing.
- Use these recovery signals in order: `pnpm dev status <service>` -> `.tmp/dev/*.pid` -> `.tmp/dev/logs/<run_id>/...` -> port listeners -> process command markers.
- Supervisor processes should be traceable through `--nexu-dev-service=...`, `--nexu-dev-role=supervisor`, and `--nexu-dev-session=...` command markers.
- Worker processes should inherit `NEXU_DEV_SESSION_ID`, `NEXU_DEV_SERVICE`, and `NEXU_DEV_ROLE` so they can still be correlated even when command-line markers are thinner.
- Do not chase perfect automatic recovery. The goal is fast manual diagnosis and predictable cleanup.

## FAQ

- Q: A service will not start. A: Start with `pnpm dev status <service>` and `pnpm dev logs <service>`. If the error says a dependency is missing, start that dependency first; if it says a port is busy, kill the listener and retry.
- Q: `pnpm dev status <service>` shows `stale`. A: The supervisor pid is gone but the lock survived. Prefer `pnpm dev stop <service>` first; if the lock still remains, remove the matching `.tmp/dev/*.pid` file and start again.
- Q: `pnpm dev logs web` shows `Port 5173 is already in use`. A: A stale Vite process from an earlier experiment is still listening. Kill the listener on `5173`, remove `web.pid` if present, and restart the dev flow.
- Q: Which pid is stored in each `.tmp/dev/*.pid` file? A: The pid lock stores the supervisor pid, not the transient worker/listener pid. Worker/listener pids are resolved at runtime via snapshots.
- Q: Where should logs be inspected first? A: Start with `pnpm dev logs <service>` for the active session. If that is not enough, inspect the backing file under `.tmp/dev/logs/<run_id>/...`.
- Q: How do I correlate a leaked or suspicious process to a specific dev run? A: Start with `sessionId` from `pnpm dev status <service>` or `.tmp/dev/*.pid`, then search process command lines for `--nexu-dev-session=<sessionId>` and `--nexu-dev-service=<service>`.
- Q: Windows local tools fail to start with `rg.exe` / ripgrep blocked errors. A: First check Windows Security -> Protection history to confirm Defender or Controlled folder access is the blocker. For the common Chocolatey install path, ensure Defender exclusions cover `C:\ProgramData\chocolatey`; if your per-user tool chain or shell state lives under your home directory, excluding `C:\Users\<you>` is also acceptable when you intentionally want broad local-dev allowance. Then retry `rg --version` before debugging higher-level agent or script failures.
- Q: `pnpm install` warns that `electron-winstaller` build scripts were ignored. A: Keep it out of the shared repo allowlist unless Windows packaging support is intentionally being enabled for the whole team. Use per-machine approval when only one Windows environment needs it.
- Q: What is the expected worst-case recovery path? A: Run `pnpm dev stop`, kill any leftover listener/supervisor pid for the affected service, remove stale `.tmp/dev/*.pid` files, then run `pnpm dev start` again.
