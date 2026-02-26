# Local Slack Testing Guide

How to receive Slack event callbacks on your local machine and run a Gateway for end-to-end AI responses.

Related guide:

- `docs/guides/local-runtime-sidecar.md` — 中文版，本地 sidecar + 本地 OpenClaw 联调说明（推荐和本篇配合使用）

## Architecture

```
Slack Events API ─→ cloudflared tunnel ─→ Nexu API (:3000)
                                            │
                                            ├─ url_verification → immediate reply
                                            ├─ verify signature (HMAC-SHA256)
                                            └─ forward to Gateway (:18789)
                                                  │
                                                  ├─ AI (via LiteLLM / Anthropic)
                                                  └─ reply via Slack API
```

## Two Setup Paths

| | pnpm dev (推荐开发) | Docker Compose 全栈 |
|---|---|---|
| 适用场景 | 日常开发、调试、热重载 | 快速体验、E2E 验证、部署预演 |
| API + Web | `pnpm dev`（热重载） | Docker 容器 |
| Postgres | Docker 容器 | Docker 容器 |
| Gateway | Docker 容器 或 手动源码启动 | Docker 容器 |
| Node 要求 | Node 20+（Gateway 源码需 22+） | 仅需 Docker |

---

## Common Setup: Slack App

不论选哪条路径，都需要先创建 Slack App。

### 1. Create a Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it anything (e.g. "Nexu Dev"), pick your workspace
3. Note down from **Basic Information**:
   - **Signing Secret**
4. Note down from **Basic Information** → **App Credentials**:
   - **Client ID** and **Client Secret**

### 2. Bot Token Scopes

Go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:

- `channels:history`
- `channels:read`
- `chat:write`
- `groups:history`
- `groups:read`
- `im:history`
- `im:read`
- `im:write`
- `mpim:history`
- `mpim:read`
- `users:read`

### 3. Start HTTPS Tunnel

Slack requires HTTPS for both OAuth redirect and Event Subscriptions.

```bash
cloudflared tunnel --url http://localhost:3000
```

It will output a URL like:
```
https://some-random-words.trycloudflare.com
```

> **Note:** This URL changes every time you restart cloudflared. You'll need to update Slack App settings accordingly.

### 4. Configure Slack App URLs

#### OAuth Redirect URL

**OAuth & Permissions** → **Redirect URLs** → Add:
```
https://<your-tunnel>.trycloudflare.com/api/oauth/slack/callback
```
Click **Add** then **Save URLs**.

#### Event Subscriptions

**Event Subscriptions** → Enable Events → **Request URL**:
```
https://<your-tunnel>.trycloudflare.com/api/slack/events
```

Slack will send a `url_verification` challenge. It will show **Verified** once the API is running (step 5 or 6 below).

**Subscribe to bot events** → Add:
- `app_mention` — triggers when someone @mentions your bot
- `message.im` — triggers on direct messages to your bot

Click **Save Changes**.

---

## Path A: pnpm dev (Recommended for Development)

热重载、可断点调试、改代码即时生效。

### Prerequisites

- Docker (for PostgreSQL)
- pnpm 9+
- Node 20+ (Node 22+ required if running Gateway from source)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`)

### 5a. Start Database

```bash
docker compose up postgres -d
```

This starts PostgreSQL on port 5433. Tables are auto-migrated on API startup.

### 6a. Configure Environment

```bash
cp apps/api/.env.example apps/api/.env
```

Fill in `apps/api/.env`:

```env
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev
BETTER_AUTH_SECRET=nexu-dev-secret-change-in-production
BETTER_AUTH_URL=https://<your-tunnel>.trycloudflare.com
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
SLACK_CLIENT_ID=<from Slack App>
SLACK_CLIENT_SECRET=<from Slack App>
SLACK_SIGNING_SECRET=<from Slack App>
GATEWAY_TOKEN=gw-secret-token
PORT=3000
WEB_URL=http://localhost:5173

# AI responses (optional — bot won't reply without these)
LITELLM_BASE_URL=https://litellm.example.com
LITELLM_API_KEY=sk-your-key
```

**Important:** `BETTER_AUTH_URL` must be the cloudflared tunnel URL (HTTPS).

### 7a. Build and Start Dev Server

首次启动需要先构建 shared 包：

```bash
pnpm build          # 构建 shared + api（首次必须，后续 tsx watch 自动处理）
pnpm dev
```

This starts:
- API on `http://localhost:3000` (with hot reload)
- Web on `http://localhost:5173` (Vite HMR)

### 8a. Seed Dev Data

Dev server 不会自动 seed（`AUTO_SEED` 仅在 Docker 全栈模式下开启）。用 seed 命令创建 pool + invite code：

```bash
pnpm seed
```

这会创建 `pool_local_01`（`pod_ip=127.0.0.1`）和 invite code `NEXU2026`。幂等，可重复运行。

### 9a. Register and Connect Slack

1. Open `http://localhost:5173`
2. Register with invite code **NEXU2026**
3. Create a bot (configure model, system prompt)
4. Go to **Channels** → **Add to Slack** → Authorize
5. You should see "Connected" status

### 10a. Start Gateway

Bot 需要 Gateway 才能实际回复消息。两种方式：

#### Option 1: Docker Gateway (推荐)

最简单 — 不需要克隆 OpenClaw 仓库：

```bash
NEXU_API_URL=http://host.docker.internal:3000 docker compose up gateway -d
```

说明：
- `NEXU_API_URL` 覆盖默认值，让 Docker 容器内的 Gateway 通过 `host.docker.internal` 访问宿主机上的 API
- `docker-compose.yml` 默认设置 `POD_IP=127.0.0.1`，API 会通过 `127.0.0.1:18789`（端口映射）将事件转发到 Gateway
- 首次启动需要 build 镜像，加 `--build` 参数：`NEXU_API_URL=http://host.docker.internal:3000 docker compose up gateway -d --build`

> macOS/Windows 上 `host.docker.internal` 自动可用。Linux 需加 `--add-host=host.docker.internal:host-gateway` 或使用宿主机实际 IP。

#### Option 2: 源码启动 (适合调试 OpenClaw)

需要 Node 22+ 和 OpenClaw 仓库：

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw && pnpm install && pnpm build
```

先将 bot 关联到 pool：

```sql
UPDATE bots SET pool_id = 'pool_local_01' WHERE slug = '<your-bot-slug>';
UPDATE webhook_routes SET pool_id = 'pool_local_01' WHERE channel_type = 'slack';
```

生成配置并启动：

```bash
# 生成配置
curl -s http://localhost:3000/api/internal/pools/pool_local_01/config \
  -H "Authorization: Bearer gw-secret-token" \
  | python3 -m json.tool > gateway-config.json

# 启动 Gateway (Node 22+)
OPENCLAW_CONFIG_PATH=$(pwd)/gateway-config.json \
  node dist/index.js gateway run --bind loopback --port 18789 --force --verbose
```

正常启动日志：
```
[gateway] agent model: litellm/anthropic/claude-sonnet-4
[gateway] listening on ws://127.0.0.1:18789 (PID xxxxx)
[slack] http mode listening at /slack/events/slack-T123
```

> **关键注意事项：**
> - 环境变量是 `OPENCLAW_CONFIG_PATH`（不是 `OPENCLAW_CONFIG`）
> - 入口是 `dist/index.js`（需先 `pnpm build`），不是 chunk 文件
> - `--verbose` 有助于调试，可以看到每条消息的处理过程
> - 配置变更后需重新生成 config 并重启 Gateway

### 11a. Test End-to-End

1. In Slack, @mention your bot or DM it
2. Watch the API logs:
   ```
   [slack-events] forwarding to http://127.0.0.1:18789/slack/events/slack-T123
   [slack-events] gateway responded: status=200
   ```
3. Watch the Gateway logs:
   ```
   [agent/embedded] embedded run start: provider=litellm model=anthropic/claude-sonnet-4
   [agent/embedded] embedded run agent end: isError=false
   slack: delivered 1 reply to channel:C123
   ```
4. The bot should reply in Slack!

---

## Path B: Docker Compose Full Stack

一条命令启动所有服务，无需安装 pnpm/Node。适合快速体验和部署预演。

### Prerequisites

- Docker and Docker Compose v2+
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`)

### 5b. Configure Environment

```bash
cp apps/api/.env.example apps/api/.env
```

Fill in `apps/api/.env` (same as Path A, but `WEB_URL` points to Docker web):

```env
# DATABASE_URL 会被 docker-compose.yml 覆盖为 postgres:5432，此处值仅供参考
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev
BETTER_AUTH_SECRET=nexu-dev-secret-change-in-production
BETTER_AUTH_URL=https://<your-tunnel>.trycloudflare.com
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
SLACK_CLIENT_ID=<from Slack App>
SLACK_CLIENT_SECRET=<from Slack App>
SLACK_SIGNING_SECRET=<from Slack App>
GATEWAY_TOKEN=gw-secret-token
PORT=3000
WEB_URL=http://localhost:8080
LITELLM_BASE_URL=https://litellm.example.com
LITELLM_API_KEY=sk-your-key
```

### 6b. Start All Services

```bash
POD_IP=gateway docker compose --profile full up --build
```

说明：
- `--profile full` 启动 api 和 web 服务（它们配置了 `profiles: ["full"]`）
- `POD_IP=gateway` 让 Gateway 注册 Docker DNS 名而非容器内部 IP，使得 Docker 内的 API 可通过 `gateway:18789` 转发事件

This starts:

| Service  | Host Port | Description |
|----------|-----------|-------------|
| postgres | 5433      | PostgreSQL 16 |
| api      | 3000      | Nexu API (auto-migrates + seeds dev data) |
| web      | 8080      | Web UI (nginx) |
| gateway  | 18789     | OpenClaw Gateway |

API 启动时自动 seed `pool_local_01`（`pod_ip=gateway`）+ invite code `NEXU2026`。Gateway 等 API 健康后自动拉取配置并启动。

### 7b. Verify

```bash
# API
curl http://localhost:3000/health

# Web
open http://localhost:8080

# Gateway
docker compose logs gateway
# Should show: "Config fetched successfully" + "Starting OpenClaw gateway"
```

### 8b. Register and Test

1. Open `http://localhost:8080`
2. Register with invite code **NEXU2026**
3. Create a bot → Connect Slack → Test in Slack

> **代码变更需重新构建：** `POD_IP=gateway docker compose --profile full up --build` 重新打镜像。日常开发建议用 [Path A](#path-a-pnpm-dev-recommended-for-development)。

---

## Troubleshooting

### Tunnel URL changed
If you restarted cloudflared, update these three places:
1. `apps/api/.env` → `BETTER_AUTH_URL`
2. Slack App → **OAuth & Permissions** → **Redirect URLs**
3. Slack App → **Event Subscriptions** → **Request URL**

Then restart: `pnpm dev` (Path A) or `docker compose --profile full restart api` (Path B).

### "Add to Slack" button is disabled
The `bots` table is empty or the bot belongs to a different user. Check with:
```sql
SELECT b.id, b.user_id, u.email
FROM bots b JOIN "user" u ON b.user_id = u.id;
```

### Slack shows "dispatch_failed" or no events arrive
- Verify Event Subscriptions Request URL shows **Verified**
- Check that `webhook_routes` table has a row for your team ID:
  ```sql
  SELECT * FROM webhook_routes WHERE channel_type = 'slack';
  ```
- If empty, disconnect and re-connect Slack via the UI

### Events arrive but Gateway gets 405 "Method Not Allowed"
The Gateway's Slack webhook handler is not registered. Check in order:

1. Gateway logs should show `[slack] http mode listening at /slack/events/<accountId>` on startup
2. The generated config must have `channels.slack.accounts.<id>.mode` set to `"http"`
3. The config must include `appToken` in each Slack account (even in HTTP mode — the OpenClaw plugin's `isConfigured` check requires it). The config generator adds a placeholder automatically.
4. The config must have a top-level `channels.slack.signingSecret` and `channels.slack.mode: "http"`
5. The `webhookPath` in the config must match what the API forwards to

### Gateway "Missing config" error
- 环境变量是 `OPENCLAW_CONFIG_PATH`，不是 `OPENCLAW_CONFIG`（定义在 `src/config/paths.ts`）
- 路径必须是绝对路径

### Gateway "requires Node >=22.12.0"
- Gateway 强制要求 Node 22+，用 `nvm use 22` 切换
- Docker 方式不需要关心（镜像自带 Node 22）
- Nexu API dev server 可以用 Node 20

### Bot 收到消息但不回复（无错误日志）

这是最难排查的问题。Gateway 的 `prepareSlackMessage` 函数有 ~15 个 `return null` 点，任一条件不满足都会静默丢弃消息。

**最常见原因：`groupPolicy` 默认是 `"allowlist"`**

即使没有显式设置 `groupPolicy`，Gateway 运行时会回退到 `"allowlist"` 模式，导致所有频道消息被丢弃。日志中可能有（需 `--verbose`）：
```
slack: drop channel C123 (groupPolicy=allowlist, matchKey=none matchSource=none)
slack: drop message (channel not allowed)
```

**解决：确保生成的配置中 `channels.slack.groupPolicy` 显式设为 `"open"`。**

检查清单：
1. `groupPolicy: "open"` — 否则频道消息全部被丢弃
2. `requireMention: false` — 否则只响应 @mention
3. `dmPolicy: "open"` + `allowFrom: ["*"]` — 否则私聊被拒
4. 配置中有 `models.providers` — 否则报 "Unknown model"

### Model error: "Unknown model: xxx"
- 检查配置中是否有 `models.providers` 部分
- 检查 `agents.defaults.model.primary` 是否有 `litellm/` 前缀
- 如果 `LITELLM_BASE_URL` / `LITELLM_API_KEY` 环境变量缺失，config 生成器不会生成 `models` 段

### LiteLLM 400 "store: Extra inputs are not permitted"
- OpenClaw 默认向 OpenAI-compatible API 发送 `store: false` 参数
- Bedrock（LiteLLM 后端之一）不支持该字段
- 修复：模型配置中设 `"compat": { "supportsStore": false }`
- Config 生成器已自动设置此项

### LiteLLM 400 "Invalid model name"
- Model ID 必须与 LiteLLM 服务器上注册的完全一致
- 检查：`curl -s $LITELLM_BASE_URL/v1/models -H "Authorization: Bearer $LITELLM_API_KEY"`
- 常见错误：数据库里的 `model_id` 是旧的或不存在的模型名

### Events arrive but bot doesn't reply (API logs show forwarding error)

API 日志显示 `Failed to forward to gateway` 或 `ECONNREFUSED`：

```
[slack-events] forwarding to http://172.21.0.3:18789/slack/events/slack-T123
[slack-events] Failed to forward to gateway: TypeError: fetch failed
```

**原因：`pod_ip` 是 Docker 容器内部 IP，macOS 宿主机无法访问。**

`gateway-entrypoint.sh` 启动时用 `hostname -i` 注册了容器 IP（如 `172.21.0.3`），macOS 上这个 IP 不可路由。

**修复：**
```sql
-- pnpm dev 模式（API 在宿主机，Gateway 端口映射到 127.0.0.1:18789）
UPDATE gateway_pools SET pod_ip = '127.0.0.1' WHERE id = 'pool_local_01';
```

防止 Gateway 重启后覆盖：确保 `docker-compose.yml` 中 `POD_IP` 设置正确（默认 `127.0.0.1`）。

### API 转发时 "Invalid JSON"
- Hono 框架可能在 middleware 中已消费了 request body
- `slack-events.ts` 使用 `c.req.text()` 读取 body，带有 fallback 到 `IncomingMessage`
- 如果仍有问题，检查是否有其他 middleware 提前读了 body

---

## Local vs Production

| 维度 | 本地开发 (pnpm dev) | Docker Compose | 线上 K8s |
|------|---------------------|----------------|---------|
| API + Web | `pnpm dev` 热重载 | Docker 容器 | Docker 容器 |
| Gateway | Docker 或源码 | Docker 容器 | Pod + Sidecar |
| 配置获取 | 手动 curl（源码）/ 自动（Docker） | 自动 | 自动 + 热加载 |
| Pod IP | `127.0.0.1` | `gateway`（Docker DNS） | K8s 分配 |
| 入口流量 | cloudflared 隧道 | cloudflared 隧道 | Ingress / LB |
| 秘钥管理 | `.env` 文件 | `.env` 文件 | K8s Secrets |

K8s 部署详见 [Docker 部署指南](docker-deployment.md) 和 `deploy/k8s/README.md`。
