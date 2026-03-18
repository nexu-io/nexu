# OpenClaw 多租户平台部署方案

## Context

我们要将 openclaw 部署为多租户 SaaS 平台，允许用户创建自己的 clawdbot，连接 Slack 和飞书(Lark) channel。

**核心洞察**：openclaw 原生支持多 Agent + 多 Account + Bindings 路由。一个 gateway 可以通过配置服务多个用户，无需大改核心代码。

**架构选择**：
- 控制面：独立 NestJS 微服务
- 运行时：EKS 共享 Gateway 池（每 Pod 50 用户，~$0.70/用户/月）
- Channel：Slack（共享 App + OAuth）+ 飞书（内置 `extensions/feishu/` 插件，支持多账号 + webhook）
- 前端：独立 React Dashboard
- 飞书插件：使用 openclaw 内置 `extensions/feishu/`（非第三方 feishu-openclaw 桥接）

---

## 架构总览

```
                        用户浏览器
                            |
                   +------------------+
                   |  React Dashboard |
                   +------------------+
                            |
                    +-----------------+
                    | AWS ALB/Ingress |
                    +-----------------+
                     |        |       |
                     v        v       v
              +---------+ +--------+ +----------------+
              | Control | |Webhook | | Gateway Pool   |
              | Plane   | |Router  | | Pods (N个)     |
              | NestJS  | |(3副本) | | 每个50用户     |
              +---------+ +--------+ +----------------+
                  |           |              |
          +-------+-------+  |     +--------+--------+
          v               v  v     v                  v
     PostgreSQL       Redis    EFS/S3            Channel APIs
       (RDS)      (ElastiCache)(Sessions)    (Slack/Feishu)
```

---

## 组件设计

### 1. Control Plane（控制面微服务）

**技术栈**：NestJS + Prisma + BullMQ（复用 refly 已有模式）

**职责**：
- Bot CRUD（创建/更新/删除用户的 bot）
- Channel 连接管理（Slack OAuth、飞书凭证）
- Gateway 池管理（分配 bot 到 Pod、扩缩容、负载均衡）
- Config 生成（从 DB 状态生成 `openclaw.json`）
- 用量追踪和配额管理

**关键 API**：
```
# Bot 管理
POST   /api/v1/bots                          创建 bot
GET    /api/v1/bots                          列出用户的 bots
PATCH  /api/v1/bots/:botId                   更新 bot 配置
DELETE /api/v1/bots/:botId                   删除 bot
POST   /api/v1/bots/:botId/pause             暂停 bot
POST   /api/v1/bots/:botId/resume            恢复 bot

# Channel 连接
POST   /api/v1/bots/:botId/channels/slack/connect     发起 Slack OAuth
GET    /api/v1/bots/:botId/channels/slack/callback     OAuth 回调
POST   /api/v1/bots/:botId/channels/feishu/connect     连接飞书
DELETE /api/v1/bots/:botId/channels/:type               断开 channel
GET    /api/v1/bots/:botId/channels/:type/status        连接状态

# 用量
GET    /api/v1/bots/:botId/usage             用量统计
GET    /api/v1/account/quota                 配额状态

# 内部管理
GET    /api/internal/pools                   池列表
POST   /api/internal/pools/rebalance         重新均衡
POST   /api/internal/bots/:botId/migrate     迁移 bot
```

### 2. Webhook Router（Webhook 路由器）

**技术栈**：轻量 Fastify 服务（3 副本，always-on）

**职责**：
- 接收所有 Slack/飞书 webhook 事件
- 根据 `team_id`（Slack）或 `app_id`（飞书）查 Redis 路由表
- 转发到目标 Gateway Pod
- Pod 未运行时缓冲事件到 SQS 并触发唤醒

**路由表结构**（Redis Hash）：
```
webhook_route:{channel_type}:{external_id} -> {
  pool_id, pod_ip, pod_port, account_id, webhook_path
}
```

### 3. Gateway Pool Pods（共享 Gateway 池）

**核心思路**：利用 openclaw 原生的多 Agent + 多 Account 特性，每个 Pod 运行一个 gateway 进程，服务 N 个用户的 bot。

**每个 Pod 的组成**：
- **主容器**：openclaw gateway 进程
- **Sidecar**：config-sync 容器，轮询控制面获取最新 config，写入共享卷触发 chokidar 热加载

**Config 生成示例**（控制面为每个 Pool Pod 生成）：
```json
{
  "gateway": {
    "port": 18789,
    "bind": "lan",
    "auth": { "mode": "token", "token": "<internal-token>" },
    "reload": { "mode": "hybrid" }
  },
  "agents": {
    "list": [
      { "id": "user-abc-bot-1", "name": "客服Bot", "model": { "primary": "gpt-4o" } },
      { "id": "user-def-bot-2", "name": "助手Bot", "model": { "primary": "claude-sonnet-4-6" } }
    ]
  },
  "channels": {
    "slack": {
      "accounts": {
        "slack-T123": {
          "mode": "http",
          "botToken": "xoxb-...",
          "signingSecret": "...",
          "webhookPath": "/slack/events/slack-T123",
          "enabled": true
        }
      }
    },
    "feishu": {
      "accounts": {
        "feishu-cli_abc": {
          "appId": "cli_abc",
          "appSecret": "...",
          "connectionMode": "webhook",
          "webhookPath": "/feishu/events/feishu-cli_abc",
          "verificationToken": "...",
          "enabled": true
        }
      }
    }
  },
  "bindings": [
    { "agentId": "user-abc-bot-1", "match": { "channel": "slack", "accountId": "slack-T123" } },
    { "agentId": "user-def-bot-2", "match": { "channel": "feishu", "accountId": "feishu-cli_abc" } }
  ]
}
```

这完全兼容现有的 `OpenClawConfig` 类型和路由系统，**不需要改 openclaw 核心代码**。

**Config 同步流程**：
1. 用户在 Dashboard 修改 bot 配置
2. Control Plane 更新 DB，重新生成该 Pool 的 config.json
3. Redis PubSub 通知 Sidecar
4. Sidecar 拉取新 config，写入 `/etc/openclaw/config.json`
5. openclaw chokidar watcher 检测文件变更，触发热加载

**资源规格**：
```yaml
# 每个 Pool Pod
resources:
  requests: { cpu: 1000m, memory: 2Gi }
  limits:   { cpu: 2000m, memory: 4Gi }
# 50 用户/Pod, 每用户 ~40MB 内存开销
```

### 4. Slack 共享 App 集成

**模型**：创建一个中央 Slack App，所有用户通过 OAuth 授权安装到自己的 workspace。

**OAuth 流程**：
1. 用户点击 "Add to Slack" → 重定向到 `slack.com/oauth/v2/authorize`
2. 用户授权 → 回调 `/api/v1/bots/:botId/channels/slack/callback`
3. Control Plane 用 `code` 换取 `bot_token` + `team_id`
4. 存储加密凭证到 DB
5. 更新 Pool config（添加 Slack account + binding）
6. 更新 Redis 路由表（team_id → pool_id）
7. Gateway 热加载新配置，开始处理消息

**Slack App Manifest 要点**：
- Socket Mode: OFF（用 HTTP 模式）
- Event Subscriptions: 指向 Webhook Router URL
- OAuth Scopes: `chat:write`, `channels:history`, `channels:read`, `groups:history`, `im:history`, `im:read`, `im:write`

### 5. 飞书集成

**两种模式**：

a) **自建应用**（MVP 阶段）：用户在飞书开放平台创建应用，填入 `app_id` + `app_secret`
b) **ISV 共享应用**（后续）：类似 Slack OAuth，用户一键授权安装

**使用 openclaw 内置 `extensions/feishu/`**：
- 支持多账号：`channels.feishu.accounts.{id}`
- 支持 webhook 模式：`connectionMode: "webhook"`（适合共享路由）
- 支持 websocket 模式：`connectionMode: "websocket"`（适合自建应用直连）

---

## 数据模型

```sql
-- 用户（与现有 auth 系统对接）
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     VARCHAR(255) UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    display_name    VARCHAR(255),
    plan            VARCHAR(50) DEFAULT 'free',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Bot 实例
CREATE TABLE bots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL,          -- 用作 openclaw agent ID
    system_prompt   TEXT,
    model_provider  VARCHAR(50) DEFAULT 'openai',
    model_id        VARCHAR(100) DEFAULT 'gpt-4o',
    agent_config    JSONB DEFAULT '{}',
    tools_config    JSONB DEFAULT '{}',
    status          VARCHAR(20) DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, slug)
);

-- Channel 连接
CREATE TABLE bot_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    channel_type    VARCHAR(50) NOT NULL,            -- 'slack', 'feishu'
    account_id      VARCHAR(255) NOT NULL,
    status          VARCHAR(30) DEFAULT 'pending',
    channel_config  JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bot_id, channel_type, account_id)
);

-- 加密凭证（AWS KMS 信封加密）
CREATE TABLE channel_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_channel_id  UUID NOT NULL REFERENCES bot_channels(id) ON DELETE CASCADE,
    credential_type VARCHAR(50) NOT NULL,
    encrypted_value BYTEA NOT NULL,
    kms_key_arn     VARCHAR(512) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bot_channel_id, credential_type)
);

-- Gateway 池
CREATE TABLE gateway_pools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_name       VARCHAR(255) NOT NULL UNIQUE,
    pool_type       VARCHAR(20) DEFAULT 'shared',   -- shared, dedicated
    max_bots        INTEGER DEFAULT 50,
    current_bots    INTEGER DEFAULT 0,
    status          VARCHAR(30) DEFAULT 'pending',
    config_version  INTEGER DEFAULT 0,
    pod_ip          VARCHAR(45),
    last_heartbeat  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Bot → Pool 分配
CREATE TABLE gateway_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    pool_id         UUID NOT NULL REFERENCES gateway_pools(id),
    assigned_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bot_id)
);

-- Webhook 路由（快速查找用）
CREATE TABLE webhook_routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_type    VARCHAR(50) NOT NULL,
    external_id     VARCHAR(255) NOT NULL,           -- Slack team_id / Feishu app_id
    pool_id         UUID NOT NULL REFERENCES gateway_pools(id),
    bot_channel_id  UUID NOT NULL REFERENCES bot_channels(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(channel_type, external_id)
);

-- 用量统计（小时聚合）
CREATE TABLE usage_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    hour            TIMESTAMPTZ NOT NULL,
    messages_in     INTEGER DEFAULT 0,
    messages_out    INTEGER DEFAULT 0,
    tokens_in       BIGINT DEFAULT 0,
    tokens_out      BIGINT DEFAULT 0,
    UNIQUE(bot_id, hour)
);
```

---

## openclaw 最小化改动

**核心原则**：Phase 1 (MVP) 零改动，Phase 2 起按需添加。

### Phase 2 改动（2处）

**改动 1：Prometheus metrics 端点**
- 文件：`src/gateway/server-http.ts`
- 内容：添加 `GET /metrics` 端点，暴露消息数/token 数/session 数等指标
- 风险：低（纯新增，不影响现有逻辑）

**改动 2：Config reload API 触发**
- 文件：`src/gateway/config-reload.ts`
- 内容：导出 `triggerReload()` 函数，添加 `POST /_internal/reload` 端点
- 目的：替代 chokidar 的 200-300ms 防抖延迟，实现亚秒级配置更新
- 风险：低（现有 reload 逻辑不变，仅新增触发路径）

**不需要改动的部分**（利用现有特性）：
- Config 加载：chokidar 文件监听已内置，sidecar 写文件即可触发
- Session 存储：设 `OPENCLAW_STATE_DIR=/data/state` 指向 EFS，各 agent 自动隔离目录
- Channel 多账号：`channels.slack.accounts` / `channels.feishu.accounts` 已支持
- Bindings 路由：`bindings[].match.accountId` 已支持按账号路由到 agent
- Gateway 认证：`gateway.auth.mode: "token"` 已支持
- Slack HTTP 模式：`channels.slack.accounts.{id}.mode: "http"` 已支持
- 飞书 webhook 模式：`channels.feishu.accounts.{id}.connectionMode: "webhook"` 已支持

---

## K8s 部署规格

### Gateway Pool Pod
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-gateway-pool
  namespace: openclaw-platform
spec:
  replicas: 2   # HPA 按需扩缩
  template:
    spec:
      initContainers:
        - name: config-init     # 启动时从控制面拉取 config
          image: openclaw-platform/config-sidecar:latest
      containers:
        - name: gateway
          image: openclaw-platform/gateway:latest
          resources:
            requests: { cpu: 1000m, memory: 2Gi }
            limits:   { cpu: 2000m, memory: 4Gi }
          env:
            - name: OPENCLAW_CONFIG_PATH
              value: /etc/openclaw/config.json
            - name: OPENCLAW_STATE_DIR
              value: /data/state
          volumeMounts:
            - name: config-volume
              mountPath: /etc/openclaw
            - name: session-data
              mountPath: /data/state
        - name: config-sync    # Sidecar: 监听 Redis PubSub, 同步 config
          image: openclaw-platform/config-sidecar:latest
          resources:
            requests: { cpu: 50m, memory: 64Mi }
      volumes:
        - name: config-volume
          emptyDir: {}
        - name: session-data
          persistentVolumeClaim:
            claimName: openclaw-sessions-efs
```

---

## 成本估算

| 规模 | 基础设施月费 | 每用户月费 | 说明 |
|------|------------|-----------|------|
| 100 用户 | ~$1,160 | ~$11.60 | 1 Pool Pod, 共用现有 RDS/Redis |
| 1,000 用户 | ~$1,900 | ~$1.90 | 5 Pool Pods |
| 10,000 用户 | ~$6,800 | ~$0.68 | 30 Pool Pods, 规模效应显著 |

（不含 LLM API 费用，按用量 passthrough 计费）

---

## 分阶段实施计划

### Phase 1: MVP（第 1-4 周）— 目标 100 用户

**不改 openclaw 代码**，验证多租户 config 生成模式。

1. **Control Plane 脚手架**
   - NestJS 项目 + Prisma schema + 核心表
   - Bot CRUD API + JWT 认证
   - Config 生成器：DB → `OpenClawConfig` JSON

2. **单 Gateway Pool Pod**
   - 手动部署 1 个 Pod
   - Config 通过 ConfigMap 挂载，手动更新后 Pod 重启

3. **Slack OAuth 流程**
   - 创建中央 Slack App
   - OAuth2 redirect → token exchange → 存储凭证
   - 生成 config 中的 slack account + binding

4. **飞书自建应用模式**
   - 用户填 app_id/app_secret
   - websocket 模式直连（最简单，不需要 webhook router）

5. **Dashboard 骨架**
   - React + Ant Design
   - Bot 创建/配置页
   - "Add to Slack" 按钮 + 飞书凭证表单

### Phase 2: 生产就绪（第 5-8 周）— 目标 1,000 用户

6. **Webhook Router 部署**
   - Fastify 服务，3 副本
   - Slack 和飞书切换到 HTTP/webhook 模式
   - Redis 路由缓存

7. **Config Sync Sidecar**
   - 轮询 + Redis PubSub 通知
   - 写入文件触发 chokidar 热加载

8. **多 Pool 管理**
   - 自动创建新 Pool（现有 Pool 满时）
   - Bot 分配算法（优先同 model provider 的 Pool）
   - HPA 按 Pod 利用率扩缩

9. **Prometheus Metrics**（openclaw 改动 1）
   - 添加 `/metrics` 端点
   - 接入现有 Grafana 监控面板

10. **用量追踪**
    - BullMQ job 聚合 gateway 日志中的消息/token 计数

### Phase 3: 规模化（第 9-12 周）— 目标 10,000 用户

11. **Config Reload API**（openclaw 改动 2）
    - 亚秒级配置更新

12. **Bot 迁移**
    - Pool 间 graceful 迁移（drain + reassign）
    - 高流量用户升级到独立 Pod

13. **Scale-to-Zero**
    - KEDA 基于 SQS 队列深度触发扩缩
    - 空闲 Pool 缩容到 0

14. **飞书 ISV 共享应用**
    - 类似 Slack 的一键授权安装流程

---

## 关键文件参考

| 用途 | openclaw 文件 |
|------|-------------|
| Config 根类型（控制面必须生成兼容的 JSON） | `src/config/types.openclaw.ts` |
| Bindings 路由解析 | `src/routing/bindings.ts`, `src/routing/resolve-route.ts` |
| Config 热加载机制 | `src/gateway/config-reload.ts` |
| Slack HTTP 模式 | `src/slack/monitor/provider.ts`, `src/slack/http/registry.ts` |
| 飞书插件（内置） | `extensions/feishu/src/monitor.ts`, `extensions/feishu/src/channel.ts` |
| Session 路径解析 | `src/config/sessions/paths.ts` |
| Gateway HTTP server | `src/gateway/server-http.ts` |
| Agent 作用域 | `src/agents/agent-scope.ts` |

| 用途 | refly-infra 文件 |
|------|-----------------|
| K8s 部署模式参考 | `kubernetes/base/core/refly-api/deployment.yml` |
| External Secrets 模式 | `kubernetes/base/infrastructure/external-secrets/` |
| Terraform EKS 模块 | `infra/stacks/prod/eks.tf` |
| ConfigMap 模式 | `kubernetes/base/core/refly-api/configmap.yml` |

---

## 验证方式

### MVP 验证步骤
1. Control Plane 启动，创建 bot → DB 中有记录
2. 连接 Slack OAuth → 凭证存储，config 生成包含正确的 slack account + binding
3. Gateway Pod 加载 config → `openclaw agents list --bindings` 显示所有 agent 和绑定
4. 从 Slack 发消息 → Webhook Router 路由到正确 Pod → agent 回复
5. 从飞书发消息 → 同上
6. Dashboard 显示 bot 状态和用量

### 生产验证步骤
1. 创建 50+ bot → 自动分配到 Pool，config 热加载无重启
2. Pool 满 → 自动创建新 Pool Pod
3. 单个 bot 崩溃 → 不影响同 Pool 其他 bot
4. `kubectl delete pod pool-X` → Pod 重建，config 从控制面恢复，sessions 从 EFS 恢复
5. Prometheus 面板显示各 bot 消息量、token 用量、延迟

---

## 本地实验验证记录（2026-02-25）

以下实验在 macOS 本地环境（Node 22.22.0）完成，验证方案核心假设。

### 实验 1：多 Agent + 多 Account + Bindings 路由

**方法**：创建包含 3 个 agent、2 个 feishu account、2 个 binding 的 config.json，运行 `agents list --bindings`。

**结果**：通过。3 个 agent 全部正确解析，binding 正确映射 feishu account 到对应 agent。
```
- tenant-a-bot (default) → feishu accountId=tenant-a-feishu
- tenant-b-bot            → feishu accountId=tenant-b-feishu
- tenant-c-bot            → (无 binding，正确)
```

### 实验 2：Config 热加载（运行中新增 agent）

**方法**：gateway 运行中，修改 config.json 新增 tenant-d-bot agent + feishu account + binding。

**结果**：通过。chokidar 检测到三次变更，全部动态应用，无需重启：
```
[reload] config change detected; evaluating reload (agents.list) → applied
[reload] config change detected; evaluating reload (bindings) → applied
[reload] config change detected; evaluating reload (channels.feishu.accounts.tenant-d-feishu) → hot reload applied
```
验证后 `agents list --bindings` 显示 tenant-d-bot 及其 binding 已生效。gateway PID 不变。

### 实验 3：Session/Workspace 目录隔离

**结果**：通过。每个 agent 自动获得独立目录：
```
tenant-a-bot → workspace: /tmp/.../tenant-a, agent dir: .../agents/tenant-a-bot/agent
tenant-b-bot → workspace: /tmp/.../tenant-b, agent dir: .../agents/tenant-b-bot/agent
（各 agent 互不交叉）
```

### 实验 4：每 Agent 内存开销

**方法**：分别用 3 / 4（热加载后）/ 50 个 agent 启动 gateway，测量进程 RSS。

| Agent 数 | RSS (MB) | 增量 |
|----------|----------|------|
| 3 agents | 40.8 MB | 基线 |
| 4 agents（热加载后）| 40.8 MB | ~0 MB |
| **50 agents** | **40.7 MB** | **~0 MB** |

**结论**：空闲 agent 内存开销接近零。每 Pod 承载量远超最初估算的 50 bot，空闲状态可承载数百甚至上千 bot。实际瓶颈将是活跃会话时的 LLM context 内存，而非 agent 定义本身。

### 实验 5：飞书插件多账号解析和启动

**方法**：配置 2 个 feishu account（1 个真实 app_id + 1 个 fake），启动 gateway。

**结果**：通过。两个账号独立初始化：
```
feishu[fake-account]: bot open_id resolved: unknown           → fake 账号被独立处理
feishu[real-account]: bot open_id resolved: ou_d835720454...  → 真实账号成功解析 bot ID
```
每个账号独立启动 WebSocket 连接，互不影响。fake 账号因凭证无效连接失败（预期行为），不影响 real 账号。

### 实验结论

| 假设 | 结果 | 对方案的影响 |
|------|------|------------|
| 多 Agent + Bindings 路由可行 | **通过** | 核心方案成立 |
| Config 热加载不重启 | **通过** | Sidecar 写文件即可动态更新 |
| 目录隔离 | **通过** | 用户数据天然隔离 |
| 内存开销可控 | **远好于预期** | 每 Pod 密度可大幅提升，成本进一步降低 |
| 飞书多账号 | **通过** | 内置 feishu 插件满足需求 |
