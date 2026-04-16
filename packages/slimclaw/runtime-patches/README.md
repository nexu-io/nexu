This directory stores file-level overlays for the locked slimclaw-managed OpenClaw runtime artifact.

- Paths are relative to `node_modules/` within the prepared runtime root
- `packages/slimclaw/src/runtime-stage.ts` applies these overlays during runtime staging
- Keep patches minimal and version-specific
