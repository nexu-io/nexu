# Docker Deployment Guide

Docker Compose 全栈启动和镜像构建参考。日常开发推荐 `pnpm dev`，详见 [Local Slack Testing Guide](local-slack-testing.md)。

## Architecture

```
Browser ──→ Web UI (:8080/nginx)
               │
               └──→ API (:3000/Hono)
                      │
                      ├── PostgreSQL (:5432)
                      └──→ Gateway (:18789/OpenClaw)
                             │
                             └── LiteLLM / AI Provider
```

Inside Docker Compose, services communicate via Docker DNS (`api:3000`, `postgres:5432`, `gateway:18789`).

## Quick Start

### 1. Configure Environment

```bash
cp apps/api/.env.example apps/api/.env
```

At minimum set `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and Slack credentials. See `.env.example` for all variables.

### 2. Start

```bash
RUNTIME_POD_IP=gateway docker compose --profile full up --build
```

> `--profile full` 启动 api/web 服务。`RUNTIME_POD_IP=gateway` 使 Gateway 注册 Docker DNS 名，确保服务间通信正确。

| Service  | Host Port | Description |
|----------|-----------|-------------|
| postgres | 5433      | PostgreSQL 16 |
| api      | 3000      | Nexu API (auto-migrates + seeds) |
| web      | 8080      | Web UI (nginx) |
| gateway  | 18789     | OpenClaw Gateway |

### 3. Verify

```bash
curl http://localhost:3000/health        # API
open http://localhost:8080               # Web UI
docker compose logs gateway              # "Config fetched successfully"
```

Register with invite code **NEXU2026** at `http://localhost:8080`.

## Building Images Individually

```bash
docker build -f Dockerfile.api -t nexu-api .
docker build -f Dockerfile.web --build-arg VITE_API_URL=https://api.example.com -t nexu-web .
docker build -f Dockerfile.gateway -t nexu-gateway .
```

## Service Details

### API (`Dockerfile.api`)
- Multi-stage Node 22 build (pnpm)
- Runs DB migrations on startup; seeds dev data when `AUTO_SEED=true`
- Health check: `GET /health`
- `DATABASE_URL` inside Compose uses `postgres:5432` (overridden in `docker-compose.yml`)

### Web (`Dockerfile.web`)
- Vite build → nginx static serving
- Build arg `VITE_API_URL` bakes the API endpoint at build time

### Gateway (`Dockerfile.gateway`)
- Installs pinned `openclaw@{VERSION}` from npm (build arg `OPENCLAW_VERSION`, default `2026.2.25`)
- Gateway runtime service (`apps/gateway/src/index.ts`) fetches config with retry, waits for gateway readiness, registers pool, and keeps heartbeat/config-sync loops running
- Optional process management switch: `RUNTIME_MANAGE_OPENCLAW_PROCESS=true` lets the runtime spawn `openclaw gateway` via `child_process`
- Key env vars: `RUNTIME_API_BASE_URL`, `INTERNAL_API_TOKEN`, `RUNTIME_POOL_ID`, `RUNTIME_POD_IP`, `OPENCLAW_CONFIG_PATH`

### PostgreSQL
- `postgres:16-alpine`, credentials `nexu:nexu`, database `nexu_dev`
- Data persisted in `pgdata` Docker volume
- `docker compose down -v` to reset

## Kubernetes

See `deploy/k8s/README.md`. Key differences from Compose:
- Gateway pod IP registered dynamically via API
- Config sync sidecar for live config updates
- Secrets via K8s Secrets
- Ingress handles TLS termination
