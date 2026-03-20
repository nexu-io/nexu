# Environment Startup Guide

This repo currently uses two desktop local environments with different startup flows.

## 1) local-dev (controller-first development runtime)

Use this when iterating quickly in development.

- Restart/start command (from repo root):

```bash
pnpm restart
```

- Characteristics:
  - Uses tmux session `nexu-desktop`.
  - Rebuilds runtime artifacts and launches the desktop dev stack.
  - Intended for active coding/debugging.

## 2) local-dist (packaged app verification runtime)

Use this when verifying behavior in a packaged desktop app.

- Build unsigned local package (from repo root):

```bash
pnpm dist:mac:unsigned
```

- Launch packaged app after build:

```bash
open "apps/desktop/release/mac-arm64/Nexu.app"
```

- Characteristics:
  - Generates artifacts under `apps/desktop/release` by default (`.app`, `.dmg`, `.zip`).
  - Does not use `dev.sh`/tmux lifecycle.
  - Intended for local packaged-app checks (closer to release behavior).
