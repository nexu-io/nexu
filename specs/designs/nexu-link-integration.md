# Nexu ↔ Link Gateway 技术对接方案

> **参与方**：Nexu Desktop（`powerformer/apps`）× Link Gateway（`nexu-io/link`，Go 服务）
>
> **目标**：桌面端用户通过 Cloud Connection 流程获取 API Key，用该 Key 调用 Link Gateway 的 OpenAI 兼容接口使用云端模型。
>
> **本文档重点**：描述整体架构，并列出 **Link 侧需要确认和完成的事项**。Nexu 侧的改动由我们自行处理。

---

## 1. 系统架构

```
┌───────────────────────────────────────────────────────────────┐
│  Nexu Desktop (Electron)                                      │
│                                                               │
│  ┌─────────────────┐   ┌──────────────────┐                   │
│  │  Desktop UI     │   │  Local API       │                   │
│  │  (Renderer)     │──▶│  (localhost:50800)│                   │
│  │                 │   │                  │                   │
│  │  - Welcome Page │   │  - cloud-connect │                   │
│  │  - Models Page  │   │  - cloud-status  │                   │
│  │  - Control Panel│   │  - config-gen    │                   │
│  └─────────────────┘   └──────┬───────────┘                   │
│                               │                               │
└───────────────────────────────┼───────────────────────────────┘
                                │ HTTPS
                 ┌──────────────┼──────────────┐
                 │              ▼              │
                 │  Cloud (同一 PostgreSQL)     │
                 │                             │
                 │  ┌───────────────────────┐  │
                 │  │  Nexu Cloud API       │  │
                 │  │  (nexu-link.xxx.net)  │  │
                 │  │                       │  │
                 │  │  - /api/auth/*        │  │
                 │  │  - better-auth        │  │
                 │  │  - device-authorize   │  │
                 │  └───────────┬───────────┘  │
                 │              │              │
                 │  ┌───────────▼───────────┐  │
                 │  │  Link Gateway         │  │
                 │  │  (Go, port 8080)      │  │
                 │  │                       │  │
                 │  │  - /v1/models         │  │
                 │  │  - /v1/chat/completions│ │
                 │  │  - /v1/embeddings     │  │
                 │  │  - /v1/responses      │  │
                 │  └───────────────────────┘  │
                 │                             │
                 │  ┌───────────────────────┐  │
                 │  │  PostgreSQL           │  │
                 │  │  public.api_keys (共享)│  │
                 │  │  link.providers       │  │
                 │  │  link.models          │  │
                 │  │  link.usage_events    │  │
                 │  └───────────────────────┘  │
                 └─────────────────────────────┘
```

**核心对接点**：`public.api_keys` 表——Nexu 写入（用户授权桌面设备时生成 Key），Link 读取验证（用户调用 LLM 时）。

---

## 2. 端到端流程

```
Phase 1: 设备注册
  桌面端 Local API → POST cloud/api/auth/desktop-device-register
                      { deviceId, deviceSecretHash }
  桌面端打开浏览器 → cloud/auth?desktop=1&device_id=xxx

Phase 2: 用户登录并授权（在浏览器中完成）
  用户登录（better-auth: Email+OTP / Google OAuth）
  前端自动调 → POST cloud/api/v1/auth/desktop-authorize { deviceId }
  云端生成 API Key：
    rawKey = "nxk_" + randomBytes(32).base64url
    keyPrefix = rawKey.slice(0, 12)
    keyHash = bcrypt(rawKey, 10)
    INSERT INTO public.api_keys (...)

Phase 3: 桌面端轮询取回 Key
  Local API 轮询 → POST cloud/api/auth/desktop-poll
                    { deviceId, deviceSecret }
  云端返回 → { status: "completed", apiKey: "nxk_...", userId, ... }

Phase 4: 桌面端通过 Link Gateway 使用模型
  GET  link-gateway/v1/models               ← Link 验证 api_keys
  POST link-gateway/v1/chat/completions     ← Link 路由到 Bifrost
  Authorization: Bearer nxk_...
```

---

## 3. 兼容性确认（已验证，无需改动）

| 项目 | 结论 |
|------|------|
| **`api_keys` 表 Schema** | 完全兼容。Nexu (Drizzle) 和 Link (pgx) 读写的列名、类型完全一致 |
| **API Key 格式** | 兼容。Nexu 生成 `nxk_...`，Link 按 12-char prefix 或 firstSegment 查找均可匹配 |
| **`user_id` 含义** | 兼容。Nexu 存 `users.id` (cuid2)，Link 只做归属记录不做关联查询 |
| **Hash 算法** | ⚠️ **Nexu 侧需改为 bcrypt**（原为 SHA256）。Link 侧无需改动。**我们会自行处理** |

---

## 4. Link 侧需要确认和完成的事项

### 4.1 🔴 Ingress 路由：`/v1` 路径冲突

PR #6 的 Helm Ingress 已有如下路由：

```yaml
paths:
  - path: /v1
    pathType: Prefix
    service: api          # ← Nexu API
  - path: /api
    pathType: Prefix
    service: api
  - path: /
    pathType: Prefix
    service: web
```

Link Gateway 也需要 `/v1/*`（`/v1/models`, `/v1/chat/completions` 等）。**两者冲突**。

**需要 Link 侧决定方案**：

| 方案 | 说明 | Nexu 侧配置 |
|------|------|-------------|
| **A. 独立域名**（推荐） | Link Gateway 用独立域名如 `gateway.nexu-link.powerformer.net` | 在 Cloud Profile 页面把该 profile 的 `linkUrl` 设为 `https://gateway.nexu-link.powerformer.net` |
| **B. 独立路径前缀** | Link Gateway 挂在 `/link/v1/*` 下 | 在 Cloud Profile 页面把该 profile 的 `linkUrl` 设为 `https://nexu-link.powerformer.net/link` |
| **C. 精细路由** | `/v1/chat/*`, `/v1/models`, `/v1/embeddings` → Link；其余 `/v1/*` → Nexu API | 在 Cloud Profile 页面把该 profile 的 `linkUrl` 设为 `https://nexu-link.powerformer.net` |

确认后把对应地址写入 Cloud Profile 即可，不再需要通过环境变量手动配置。

---

### 4.2 🔴 部署上线

目前 `nexu-link.powerformer.net` DNS 无记录，服务未部署。需要：

- [ ] DNS 记录指向 EKS Ingress
- [ ] Helm chart 部署 Nexu API + Web + Link Gateway
- [ ] PostgreSQL 实例就绪，Nexu API 和 Link Gateway 均可连接

---

### 4.3 🟡 数据库 Migration 顺序

共享 PostgreSQL 上需要按顺序运行：

1. **Nexu API migrations**（Drizzle，建表 `public.*`）——包括 `api_keys` 和 `desktop_device_authorizations`
2. **Link migrations**（golang-migrate，建 `link.*` schema）

**确认点**：Link 的 `scripts/seed-local-db.sh` 是否会创建 `public.api_keys` 表？如果是，生产环境需跳过（由 Nexu migration 创建），或确保用 `IF NOT EXISTS`。

数据库 Schema 全景：

```
PostgreSQL (共享实例)
├── public schema (Nexu API 管理)
│   ├── user, session              ← better-auth
│   ├── users                      ← Nexu 应用用户
│   ├── api_keys                   ← 🔗 共享！Nexu 写入, Link 读取
│   ├── desktop_device_authorizations ← 设备授权临时表
│   ├── bots, channels, ...        ← Nexu 业务表
│   └── model_providers            ← BYOK provider 配置
│
└── link schema (Link Gateway 管理)
    ├── providers                  ← 云端 Provider 配置
    ├── models                     ← 云端模型目录
    └── usage_events               ← 调用量记录
```

---

### 4.4 🟡 模型目录配置

Link 的 `link.providers` + `link.models` 表决定了桌面端用户连接云端后能看到哪些模型。

需要 Link 侧配置生产环境的 Provider 和 Model 记录：
- 实际的 Provider（Bedrock / Vertex / Azure，配真实 credentials）
- 对应的 Model（如 `claude-sonnet-4-5`, `gemini-2.5-flash` 等，`status = 'active'`）

桌面端通过 `GET /v1/models` 获取列表，响应格式（已确认兼容）：
```json
{
  "object": "list",
  "data": [
    { "id": "claude-sonnet-4-5", "object": "model", "created": 1234567890, "owned_by": "bedrock" },
    { "id": "gemini-2.5-flash", "object": "model", "created": 1234567890, "owned_by": "vertex" }
  ]
}
```

---

### 4.5 🟢 API Key 认证 — Link 无需代码改动

我们会将 Key 生成改为 bcrypt hash（与 Link 的 `AuthenticateAPIKey` 一致）。对接后：

- Nexu 写入 `api_keys`：`key_hash` = bcrypt, `key_prefix` = 前 12 字符, `status` = "active"
- Link 读取验证：按 `key_prefix` 查找候选行 → `bcrypt.CompareHashAndPassword` 逐行比对 → 匹配

Link 侧零改动。

---

## 5. 联调检查清单

### 前置条件（按顺序）

- [ ] **Link**: DNS `nexu-link.powerformer.net` 解析正常
- [ ] **Link**: 确认 Ingress 路由方案（4.1 的 A/B/C 选一个，告知我们）
- [ ] **Link**: PostgreSQL 共享实例就绪
- [ ] **Link**: Nexu API migration 已运行（含 `api_keys`, `desktop_device_authorizations`）
- [ ] **Link**: Link migration 001 已运行（`link.providers`, `link.models`, `link.usage_events`）
- [ ] **Link**: 至少配置一个 active provider + model
- [ ] **Nexu**: `desktop-auth-routes.ts` 改为 bcrypt（我们自行完成）

### 联调步骤

```bash
# 1. 健康检查
curl https://<link-domain>/healthz

# 2. 模型列表（用 seed key 测试）
curl https://<link-domain>/v1/models \
  -H "Authorization: Bearer sk-local-test"

# 3. 设备注册（Nexu Cloud API）
curl -X POST https://<cloud-domain>/api/auth/desktop-device-register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-001","deviceSecretHash":"..."}'

# 4. 端到端：桌面端 Connect → 浏览器登录 → 轮询取 Key → 调用 /v1/models
```
