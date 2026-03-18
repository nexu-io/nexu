# Nexu Docs

This directory is an independent VitePress project.

## Why it is independent

- It lives under `docs/`, which is not matched by the root `pnpm-workspace.yaml`.
- It has its own `package.json`.
- It has its own nested `pnpm-workspace.yaml`, so running `pnpm` inside `docs/` uses this directory as the workspace root.

## Local development

```bash
cd docs
pnpm install
pnpm dev
```

## Build

```bash
cd docs
pnpm build
pnpm preview
```
