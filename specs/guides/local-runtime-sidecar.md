# 本地 Runtime Sidecar 开发与使用指南（对接本地 OpenClaw）

> Deprecated: 本文描述的是旧的 `apps/api` + `apps/gateway` 本地联调路径。
> 当前本地/桌面主路径已切换为 controller-first，请优先使用 `pnpm desktop:start` 和 `specs/guides/desktop-runtime-guide.md`。
> 仅在排查遗留 SaaS / sidecar 行为时参考本文。

本文说明如何在本机启动并联调以下组件：

- `apps/api`（控制面）
- `apps/gateway`（配置同步与心跳）
- 本地 OpenClaw Gateway 实例（运行面）

目标是验证完整链路：

1. API 生成 pool 配置快照
2. sidecar 轮询拉取最新配置并原子写盘
3. OpenClaw 读取配置并处理 Slack 事件

## 一、前置条件

- Node 22+（建议统一 Node 22）
- pnpm 9+
- Docker（用于本地 PostgreSQL）
- 本地 OpenClaw 仓库（已 `pnpm install && pnpm build`）
- 已完成 Slack 本地测试基础配置（可参考 `specs/guides/local-slack-testing.md`）

## 二、启动顺序（建议）

按以下顺序启动，最稳定：

1. PostgreSQL
2. Nexu API
3. OpenClaw Gateway
4. Runtime Sidecar

## 三、准备数据库与 API

### 1) 启动数据库

```bash
docker compose up -d
```

### 2) 配置环境变量

根目录 `.env` 至少包含：

```env
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:3000
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

GATEWAY_TOKEN=gw-secret-token
INTERNAL_API_TOKEN=change-me-internal-token

SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...

PORT=3000
WEB_URL=http://localhost:5173
```

> 备注：当前 sidecar 与 API 走的是 internal HTTP 接口，使用 `INTERNAL_API_TOKEN` 做机器鉴权。

### 3) 启动 API

```bash
pnpm --filter @nexu/api dev
```

API 启动会执行迁移逻辑，确保 `gateway_pools`、`pool_config_snapshots` 等表可用。

## 四、准备本地 Pool 与 Bot 绑定

如果你还没把 bot 绑定到本地 pool，可执行：

```sql
-- 连接数据库: postgresql://nexu:nexu@localhost:5433/nexu_dev

INSERT INTO gateway_pools (
  id, pool_name, pool_type, status, pod_ip, created_at
) VALUES (
  'pool_local_01', 'pool-local-01', 'shared', 'active', '127.0.0.1', NOW()::text
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  pod_ip = EXCLUDED.pod_ip;

-- 将目标 bot 绑定到该 pool
UPDATE bots
SET pool_id = 'pool_local_01', updated_at = NOW()::text
WHERE id = '<your-bot-id>';
```

如果该 bot 已连接 Slack，建议同步 webhook 路由：

```sql
UPDATE webhook_routes
SET pool_id = 'pool_local_01', updated_at = NOW()::text
WHERE bot_id = '<your-bot-id>' AND channel_type = 'slack';
```

## 五、启动本地 OpenClaw Gateway

先准备一个配置文件路径（sidecar 会写入）：

```bash
mkdir -p /tmp/openclaw
touch /tmp/openclaw/config.json
```

在 OpenClaw 仓库内启动 Gateway：

```bash
OPENCLAW_CONFIG_PATH=/tmp/openclaw/config.json \
node dist/index.js gateway run --bind loopback --port 18789 --force --verbose
```

建议先保持该终端窗口不关闭，用于观察 reload 与事件处理日志。

## 六、启动 Runtime Sidecar

在 Nexu 仓库新开终端，设置 sidecar 环境变量：

```bash
export RUNTIME_POOL_ID=pool_local_01
export INTERNAL_API_TOKEN=change-me-internal-token
export RUNTIME_API_BASE_URL=http://localhost:3000
export RUNTIME_POD_IP=127.0.0.1
export OPENCLAW_CONFIG_PATH=/tmp/openclaw/config.json
export OPENCLAW_GATEWAY_READY_URL=http://localhost:18789/health

export RUNTIME_POLL_INTERVAL_MS=2000
export RUNTIME_POLL_JITTER_MS=300
export RUNTIME_MAX_BACKOFF_MS=30000
export RUNTIME_REQUEST_TIMEOUT_MS=3000
export RUNTIME_HEARTBEAT_INTERVAL_MS=5000
```

启动 sidecar：

```bash
pnpm --filter @nexu/gateway dev
```

正常日志应包含：

- `pool registered`
- `applied new pool config`

## 七、联调验证清单

### 1) 验证配置快照接口

```bash
curl -s -H "x-internal-token: $INTERNAL_API_TOKEN" \
  "http://localhost:3000/api/internal/pools/pool_local_01/config/latest" | jq .
```

关注字段：

- `version`
- `configHash`
- `config.channels.slack`
- `config.bindings`

### 2) 验证 sidecar 已写盘

```bash
ls -l /tmp/openclaw/config.json
```

并检查文件内容确实是完整 OpenClaw 配置 JSON。

### 3) 验证热更新

修改 bot（例如 pause/resume、更新模型或提示词）后：

- sidecar 应打印 `applied new pool config`
- Gateway 日志应出现配置变更/reload 相关信息

### 4) 验证 Slack 事件转发

触发 Slack 消息后，API 日志应出现转发目标：

- `forwarding to http://127.0.0.1:18789/slack/events/<accountId>`

若 Gateway 可正常处理，Slack 侧可收到回复。

## 八、常见问题

### 1) sidecar 报 401 Unauthorized

- 检查 API 与 sidecar 的 `INTERNAL_API_TOKEN` 是否一致
- 检查请求头是否带 `x-internal-token`

### 2) sidecar 轮询失败并退避

- 确认 `RUNTIME_API_BASE_URL` 正确
- 确认 API 已启动且 `pool_local_01` 存在

### 3) Gateway 没有响应 Slack

- 检查 `gateway_pools.pod_ip` 是否是 `127.0.0.1`
- 检查 `webhook_routes.pool_id` 是否指向 `pool_local_01`
- 检查生成配置中的 `channels.slack.accounts.<accountId>.webhookPath`

### 4) 配置更新了但 Gateway 不生效

- 确认 sidecar 正在写 `OPENCLAW_CONFIG_PATH`
- 确认 Gateway 进程启动时使用的是同一路径
- 确认 Gateway 运行参数启用了 reload 能力（当前默认 `hybrid`）

## 九、推荐开发流程

1. 先启动 API + Gateway + sidecar
2. 在 Web 端改 bot/channel
3. 观察 sidecar 与 Gateway 日志
4. 需要排查时优先看：
   - `/api/internal/pools/{poolId}/config/latest`
   - `/tmp/openclaw/config.json`
   - API 的 Slack 转发日志

这样可以快速定位问题是在控制面、sidecar 还是 Gateway 运行面。
