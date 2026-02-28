# Local Slack Testing Guide

How to receive Slack event callbacks on your local machine and optionally run a Gateway for end-to-end AI responses.

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

## Prerequisites

- Docker (for PostgreSQL)
- pnpm 9+
- Node 20+ (Node 22+ required for Gateway)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`)
- A Slack workspace where you have admin access
- (Optional) [OpenClaw](https://github.com/openclaw/openclaw) repo cloned locally — for running Gateway

## Part 1: API + Slack Events

### 1. Start Database

```bash
docker compose up -d
```

This starts PostgreSQL on port 5433. Tables are auto-migrated on API startup.

### 2. Create a Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it anything (e.g. "Nexu Dev"), pick your workspace
3. Note down from **Basic Information**:
   - **Signing Secret**
4. Note down from **Settings → Install App** (or after OAuth):
   - The Client ID and Client Secret are in **Basic Information** → **App Credentials**

#### Bot Token Scopes

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

### 4. Configure Environment

Copy `.env.example` and fill in:

```bash
cp apps/api/.env.example apps/api/.env
```

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
```

**Important:** `BETTER_AUTH_URL` must be the cloudflared tunnel URL (HTTPS).

### 5. Configure Slack App URLs

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

Slack will send a `url_verification` challenge. If the API is running, it should show **Verified** automatically.

**Subscribe to bot events** → Add:
- `app_mention` — triggers when someone @mentions your bot
- `message.im` — triggers on direct messages to your bot

Click **Save Changes**.

### 6. Start Dev Server

```bash
pnpm dev
```

This starts:
- API on `http://localhost:3000`
- Web on `http://localhost:5173`

### 7. Create a Test Account

1. Open `http://localhost:5173` in your browser
2. Use invite code `NEXU2026` to register
3. A default bot needs to exist — create one via DB if needed:

```sql
-- Connect to: postgresql://nexu:nexu@localhost:5433/nexu_dev
INSERT INTO bots (id, user_id, name, slug, system_prompt, created_at, updated_at)
VALUES (
  'bot_dev_01',
  '<your-user-id-from-user-table>',
  'Dev Bot',
  'dev-bot',
  'You are a helpful assistant.',
  NOW()::text,
  NOW()::text
);
```

### 8. Connect Slack via OAuth

1. Go to **Channels** page in the web UI
2. Click **Add to Slack**
3. Authorize in Slack
4. You should see "Connected" status

### 9. Test Events (API Only)

In your Slack workspace:
- **@mention the bot** in a channel (after inviting it with `/invite @BotName`)
- **DM the bot** directly (find it under Apps in the sidebar)

You should see in the API logs:
```
[slack-events] team=T12345 event=app_mention (no gateway pod — logged only)
[slack-events] payload: { ... }
```

At this point, the API receives and logs events but the bot can't respond without a Gateway.

---

## Part 2: Gateway (End-to-End AI Responses)

To make the bot actually respond, you need to run an OpenClaw Gateway locally.

> **本地开发模式说明：** Gateway 直接从 OpenClaw 源码仓库 `dist/index.js` 启动，通过 `OPENCLAW_CONFIG_PATH` 指向 Nexu API 动态生成的配置文件。DB 中 `pod_ip=127.0.0.1` 使事件在本机内转发。配置变更后需手动重新生成并重启 Gateway。线上部署的区别见文末 [Local vs Production](#local-vs-production) 部分。

### Prerequisites

- Node 22+ (`nvm install 22 && nvm use 22`) — **Gateway 强制要求 22.12.0+**，dev server 可用 Node 20
- OpenClaw repo cloned: `git clone https://github.com/openclaw/openclaw.git && cd openclaw && pnpm install && pnpm build`
- LiteLLM proxy 或其他 OpenAI-compatible API endpoint

### 1. Set Up a Gateway Pool

Create a gateway pool record and link your bot to it:

```sql
-- Connect to: postgresql://nexu:nexu@localhost:5433/nexu_dev

-- Create gateway pool (pointing to localhost)
INSERT INTO gateway_pools (id, name, pod_ip, status, created_at)
VALUES ('pool_local_01', 'local-dev', '127.0.0.1', 'active', NOW()::text);

-- Assign bot to pool
UPDATE bots SET pool_id = 'pool_local_01' WHERE id = '<your-bot-id>';

-- Verify webhook_routes has pool assignment
UPDATE webhook_routes SET pool_id = 'pool_local_01' WHERE channel_type = 'slack';
```

### 2. Configure LiteLLM Provider

Config 生成器通过环境变量配置 LiteLLM。在 `apps/api/.env` 中添加：

```env
LITELLM_BASE_URL=https://litellm.example.com
LITELLM_API_KEY=sk-your-key
```

**重要：** 设好后需重启 dev server（或 `touch apps/api/src/index.ts` 让 tsx watch 重新加载）。

确认你的 bot 使用的 `model_id` 在 LiteLLM 上可用：

```bash
# 查看可用模型
curl -s $LITELLM_BASE_URL/v1/models -H "Authorization: Bearer $LITELLM_API_KEY" \
  | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data']]"

# 更新 bot 的 model_id（必须与上面列表中的某个匹配）
psql "postgresql://nexu:nexu@localhost:5433/nexu_dev" \
  -c "UPDATE bots SET model_id = 'anthropic/claude-sonnet-4' WHERE slug = 'my-bot';"
```

### 3. Generate Gateway Config

API 从数据库动态生成配置（含 LiteLLM provider、Slack credentials、policy 设置）：

```bash
curl -s http://localhost:3000/api/internal/pools/pool_local_01/config \
  -H "Authorization: Bearer gw-secret-token" \
  | python3 -m json.tool > gateway-config.json
```

验证关键字段：
```bash
# 应该看到 litellm/ 前缀
python3 -c "import json; d=json.load(open('gateway-config.json')); print('model:', d['agents']['defaults']['model']['primary'])"
# → model: litellm/anthropic/claude-sonnet-4

# 应该看到 models.providers.litellm
python3 -c "import json; d=json.load(open('gateway-config.json')); print('has models:', 'models' in d)"
# → has models: True

# 应该看到 groupPolicy: open
python3 -c "import json; d=json.load(open('gateway-config.json')); print('groupPolicy:', d['channels']['slack']['groupPolicy'])"
# → groupPolicy: open
```

如果 `has models: False`，说明环境变量没生效 — 检查 `.env` 是否有 `LITELLM_BASE_URL` 和 `LITELLM_API_KEY`，重启 dev server。

### 4. Start Gateway

```bash
# 切换到 Node 22（Gateway 强制要求）
nvm use 22

# 进入 OpenClaw 目录
cd /path/to/openclaw

# 启动 Gateway
OPENCLAW_CONFIG_PATH=/path/to/gateway-config.json \
  node dist/index.js gateway run --bind loopback --port 18789 --force --verbose
```

正常启动日志：
```
[gateway] agent model: litellm/anthropic/claude-sonnet-4
[gateway] listening on ws://127.0.0.1:18789 (PID xxxxx)
[slack] [slack-t123] starting provider
[slack] http mode listening at /slack/events/slack-T123
```

> **关键注意事项：**
> - 环境变量是 `OPENCLAW_CONFIG_PATH`（不是 `OPENCLAW_CONFIG`）
> - 入口是 `dist/index.js`（需先 `pnpm build`），不是 chunk 文件
> - `--verbose` 加上有助于调试，可以看到每条消息的处理过程
> - `--force` 跳过端口占用检查

### 5. Test End-to-End

1. In Slack, @mention your bot or DM it
2. Watch the API logs for event forwarding:
   ```
   [slack-events] forwarding to http://127.0.0.1:18789/slack/events/slack-T123
   [slack-events] gateway responded: status=200
   ```
3. Watch the Gateway logs for AI processing:
   ```
   [agent/embedded] embedded run start: provider=litellm model=anthropic/claude-sonnet-4
   [agent/embedded] embedded run agent end: isError=false
   slack: delivered 1 reply to channel:C123
   ```
4. The bot should reply in Slack!

---

## Troubleshooting

### Tunnel URL changed
If you restarted cloudflared, update these three places:
1. `apps/api/.env` → `BETTER_AUTH_URL`
2. Slack App → **OAuth & Permissions** → **Redirect URLs**
3. Slack App → **Event Subscriptions** → **Request URL**

Then restart the dev server (`pnpm dev`).

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
The Gateway's Slack webhook handler is not registered. Check these in order:

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

### API 转发时 "Invalid JSON"
- Hono 框架可能在 middleware 中已消费了 request body
- `slack-events.ts` 使用 `c.req.text()` 读取 body，带有 fallback 到 `IncomingMessage`
- 如果仍有问题，检查是否有其他 middleware 提前读了 body

---

## Local vs Production

| 维度 | 本地开发 | 线上 K8s |
|------|---------|---------|
| Gateway 启动 | 手动 `node dist/index.js gateway run` | Pod 容器自动启动 |
| 配置获取 | 手动 curl 保存文件，`OPENCLAW_CONFIG_PATH` 指向 | Pod 启动时调 `GET /api/internal/pools/{poolId}/config` 拉取 |
| 配置更新 | 手动重新生成 + 重启 | `reload.mode: "hybrid"` 热加载，或 API 触发 |
| Pod IP | `127.0.0.1` 硬编码 | K8s 分配，写入 `gateway_pools.pod_ip` |
| 入口流量 | cloudflared 隧道 | K8s Ingress / Load Balancer |
| Node 版本 | `nvm use 22` 手动切 | Docker 镜像固定 Node 22+ |
| 秘钥管理 | `.env` 文件 | K8s Secrets 注入 |

### 上线需要改什么

总结：需要把 Gateway 容器化并实现启动时自动拉配置 + 注册 Pod IP，将 Slack 入口域名和秘钥迁移到 K8s Ingress/Secrets，实现 Config Sync Sidecar 完成配置变更通知链路（Gateway 的 chokidar 文件监听已内置，Sidecar 监听 Redis PubSub 后拉配置写文件即可触发热加载），以及将 Gateway 网络绑定从 loopback 改为 lan 以接受跨 Pod 流量。

1. **Gateway Docker 镜像** — 基于 OpenClaw 构建，启动脚本在 entrypoint 中调用 Nexu API 拉取配置：
   ```bash
   # entrypoint.sh 示意
   curl -s http://nexu-api:3000/api/internal/pools/$POOL_ID/config \
     -H "Authorization: Bearer $GATEWAY_TOKEN" \
     -o /app/config.json
   OPENCLAW_CONFIG_PATH=/app/config.json node dist/index.js gateway run --bind lan --port 18789
   ```

2. **Pod IP 注册** — Pod 启动后需将自身 IP 写回 `gateway_pools.pod_ip`（通过 K8s downward API 或启动脚本调 Nexu API）

3. **Config Sync Sidecar** — Gateway 的 chokidar 文件监听已内置，不需要改 Gateway 代码。需要实现一个 Sidecar 容器（设计文档：`docs/design-docs/openclaw-multi-tenant.md`），职责：
   - 监听 Redis PubSub 的配置变更通知
   - 调 `GET /api/internal/pools/{poolId}/config` 拉最新配置
   - 原子写入共享卷 `/etc/openclaw/config.json`（写 temp 文件再 rename）
   - Gateway chokidar 自动检测到文件变更并热加载，零重启

4. **Slack Event Subscriptions URL** — 从 cloudflared 隧道改为正式域名：
   ```
   https://api.nexu.example.com/api/slack/events
   ```

5. **环境变量** — `.env` 中的秘钥改为 K8s Secrets：
   - `LITELLM_BASE_URL` / `LITELLM_API_KEY` → Secret
   - `GATEWAY_TOKEN` → Secret
   - `ENCRYPTION_KEY` → Secret
   - `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` → Secret

6. **`gateway.bind`** — 从 `"loopback"` 改为 `"lan"`。loopback 只绑 `127.0.0.1`，K8s 中 API Pod 和 Gateway Pod 是不同 IP，需要 `lan`（绑 `0.0.0.0`）才能接受跨 Pod 的事件转发请求
