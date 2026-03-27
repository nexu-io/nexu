# AGENTS.md

This file captures local guidance for the `scripts/dev` CLI surface.

## CLI style

- Keep the CLI layer simple, explicit, and easy to scan.
- Define commands inline with `cli.command(...)`; do not hide command registration behind loops or abstractions.
- Prefer direct readable control flow over reusable helpers unless repetition becomes truly costly.
- Aim for simple, clean, nearly-strong code rather than cleverness.
- Fail fast when inputs are invalid or execution breaks.
- Do not add defensive orchestration here; let logs expose errors clearly.

## Architecture split

- Keep the local-dev control plane centered in `scripts/dev/`; do not do a broad repo-wide `scripts/` migration.
- Root `package.json` provides the single external entrypoint `pnpm dev ...` and should stay thin.
- `scripts/dev/src/` is the assembly layer for service-level local-dev flows such as `web`, `controller`, and later `desktop`.
- Reusable script utilities belong in `packages/dev-utils/src/`.
- `@nexu/dev-utils` should stay limited to repo-level atomic operations and helpers such as `commands`, `conditions`, `lock`, `process`, and path helpers.
- Do not move service orchestration or lifecycle flows into `@nexu/dev-utils`; compose those in `scripts/dev/src/` from the atomic helpers.
- Keep command behavior thin in `scripts/dev`, but keep service-specific assembly there rather than pushing it down into `@nexu/dev-utils`.
- Runtime outputs belong under `.tmp/dev/`.

## Command surface

- Keep the command surface small and intentional.
- Preferred commands are `pnpm dev start`, `pnpm dev restart`, `pnpm dev stop`, and `pnpm dev logs <web|controller>`.
- Validate behavior through the real command surface instead of temporary harness scripts.
- Before introducing desktop concerns, stabilize the controller + web workflow first.

## Runtime model

- Root entrypoint stays `pnpm dev ...`.
- The CLI executes through `pnpm --dir ./scripts/dev exec tsx ./src/index.ts`.
- `scripts/dev` may use its own `tsconfig.json` features such as `paths`.
- Logs should live under `.tmp/dev/logs/<run_id>/...`.
- Lightweight state should use per-service pid locks under `.tmp/dev/*.pid`.
- A single `sessionId` should be shared across controller + web for one `pnpm dev start` / `pnpm dev restart` invocation.
- Dev tracing should stay lightweight: use pid locks, log files, port listeners, and stable process markers rather than adding heavy orchestration or monitoring.

## Recovery model

- Optimize for the practical bar: normal usage should be stable, common failures should be recoverable from the FAQ, and worst-case recovery may rely on a machine restart.
- Prefer lightweight, inspectable recovery over complex self-healing.
- Use these recovery signals in order: `pnpm dev status` -> `.tmp/dev/*.pid` -> `.tmp/dev/logs/<run_id>/...` -> port listeners (`3010`, `5173`) -> process command markers.
- Supervisor processes should be traceable through `--nexu-dev-service=...`, `--nexu-dev-role=supervisor`, and `--nexu-dev-session=...` command markers.
- Worker processes should inherit `NEXU_DEV_SESSION_ID`, `NEXU_DEV_SERVICE`, and `NEXU_DEV_ROLE` so they can still be correlated even when command-line markers are thinner.
- Do not chase perfect automatic recovery. The goal is fast manual diagnosis and predictable cleanup.

## FAQ

- Q: `pnpm dev stop` fails because one side is already down. A: This is currently acceptable. Read `.tmp/dev/*.pid`, kill the remaining supervisor manually if needed, remove stale pid locks, then rerun `pnpm dev start` or `pnpm dev restart`.
- Q: `pnpm dev status` shows `stale`. A: The pid lock still exists but the supervisor pid is no longer alive. Remove the stale `.tmp/dev/*.pid` file and start again.
- Q: `pnpm dev logs web` shows `Port 5173 is already in use`. A: A stale Vite process from an earlier experiment is still listening. Kill the listener on `5173`, remove `web.pid` if present, and restart the dev flow.
- Q: Which pid is stored in `controller.pid` or `web.pid`? A: The pid lock stores the supervisor pid, not the transient worker pid. Worker/listener pids are resolved at runtime via snapshots.
- Q: Where should logs be inspected first? A: Always start with `.tmp/dev/logs/<run_id>/controller.log` and `.tmp/dev/logs/<run_id>/web.log`; treat file logs as the source of truth for agent-driven debugging.
- Q: How do I correlate a leaked or suspicious process to a specific dev run? A: Start with `sessionId` from `pnpm dev status` or `.tmp/dev/*.pid`, then search process command lines for `--nexu-dev-session=<sessionId>` and `--nexu-dev-service=<controller|web>`.
- Q: What is the expected worst-case recovery path? A: Kill the known listener/supervisor pids, remove stale `.tmp/dev/*.pid` files, rerun `pnpm dev start`, and if the local environment is still inconsistent, reboot the machine to clear any orphaned OS-level process state.
