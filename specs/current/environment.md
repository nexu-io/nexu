# Environment Startup Guide

This repo currently uses two desktop local environments with different startup flows.

## 1) local-dev (controller-first development runtime)

Use this when iterating quickly in development.

- Start commands (from repo root):

```bash
pnpm dev start openclaw
pnpm dev start controller
pnpm dev start web
pnpm dev start desktop
```

- Characteristics:
  - Uses explicit per-service local development commands.
  - Services are started and stopped independently.
  - Intended for active coding/debugging.

## 2) local-dist (packaged app verification runtime)

Use this when verifying behavior in a packaged desktop app.

- Build unsigned local package (from repo root):

```bash
pnpm dist:mac:unsigned:arm64
# or
pnpm dist:mac:unsigned:x64
```

- Launch packaged app after build:

```bash
open "apps/desktop/release/mac-arm64/Nexu.app"
# or
open "apps/desktop/release/mac/Nexu.app"
```

- Characteristics:
  - Generates artifacts under `apps/desktop/release` by default (`.app`, `.dmg`, `.zip`).
  - Use the `:arm64` scripts on Apple Silicon builders and the `:x64` scripts on Intel builders.
  - Does not use the old desktop dev launcher lifecycle.
  - Intended for local packaged-app checks (closer to release behavior).
