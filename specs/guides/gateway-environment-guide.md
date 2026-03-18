# Gateway Environment Guide: Dev vs Production Path Divergence

This document explains how the gateway sidecar resolves filesystem paths differently in development and production, and how to avoid bugs caused by this divergence.

## Path Resolution Table

| Environment variable | Dev (default) | Production (K8s) | K8s volume type |
|---|---|---|---|
| `OPENCLAW_CONFIG_PATH` | `<cwd>/.openclaw/openclaw.json` | `/etc/openclaw/config.json` | emptyDir (ephemeral) |
| `OPENCLAW_STATE_DIR` | `<cwd>/.openclaw/` | `/data/openclaw/` | PVC (persistent 20Gi) |
| `OPENCLAW_SKILLS_DIR` | `<cwd>/.openclaw/skills/` | `/data/openclaw/skills/` | (inside state PVC) |

In development, `dirname(CONFIG_PATH) === STATE_DIR`. In production, they are **different volumes**.

## Why They Diverge

- **Config** is ephemeral — it's regenerated from the API on every boot and written to an emptyDir. If the pod restarts, the sidecar re-fetches the config.
- **State** is persistent — sessions, skills, and `nexu-context.json` live on a PVC so they survive restarts. This avoids re-downloading all skills and losing session history.

Separating them lets Kubernetes manage lifecycle independently: config can be blown away freely, while state persists across deploys.

## Golden Rule

> Never derive state-related paths from `OPENCLAW_CONFIG_PATH`. Always use `env.OPENCLAW_STATE_DIR`.

Code that does `dirname(env.OPENCLAW_CONFIG_PATH)` to find state files works in dev (where config and state share a directory) but silently writes to the wrong volume in production.

## `nexu-context.json` Location

`nexu-context.json` must be written to `OPENCLAW_STATE_DIR`, not `dirname(OPENCLAW_CONFIG_PATH)`.

OpenClaw skills discover this file by walking up from their script directory. In production, skills live under `/data/openclaw/skills/`, so `nexu-context.json` must also be under `/data/openclaw/` for the walk-up to find it.

Path: `${OPENCLAW_STATE_DIR}/nexu-context.json`

## Session Lock Files

OpenClaw writes `.lock` files under `${OPENCLAW_STATE_DIR}/agents/*/sessions/`. These persist on the PVC across container restarts.

**Problem:** After a rolling deploy, the new container's OpenClaw process may get the same PID (container PID namespace reuse), causing lock checks to believe the lock is "legitimately held" — permanent deadlock.

**Solution:** The sidecar clears all `.lock` files before starting the managed OpenClaw process (`clearStaleSessionLocks()` in `bootstrap.ts`). This is guarded behind `RUNTIME_MANAGE_OPENCLAW_PROCESS=true` — when the sidecar doesn't manage the process, an external OpenClaw may have active locks.

## Skill Watcher Behavior

OpenClaw's file watcher uses `ignoreInitial: true`. Files that exist on disk before the watcher initializes are invisible to it — no events fire, so existing sessions never rebuild to include those skills.

**Pattern:** After OpenClaw is ready:
1. Wait for the watcher to fully initialize (2s delay after liveness check)
2. Atomically rewrite all `SKILL.md` files (read → write temp → rename)
3. This triggers watcher events → existing sessions rebuild with skills injected

New skills added via the poll loop after boot trigger watcher events automatically — this gap is startup-only.

## Helm Chart Reference

These environment variables are set in:
- `deploy/helm/nexu/templates/gateway-deployment.yaml`

The PVC for state is defined in:
- `deploy/helm/nexu/templates/gateway-pvc.yaml`

When adding new path-related environment variables, always update both the Helm template and `apps/gateway/src/env.ts`.
