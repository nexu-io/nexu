# Nexu

OpenClaw 多租户平台 — 让用户创建自己的 AI Bot，一键连接 Slack。

## 架构

```
用户浏览器 → Web (React + Ant Design)
                ↓
          API (Hono + Drizzle + Zod)  ←→  PostgreSQL / Redis
                ↓
          Webhook Router  →  Gateway Pool Pods (OpenClaw)
                                    ↓
                              Slack API
```

**核心思路**：利用 OpenClaw 原生多 Agent + 多 Account + Bindings 路由，一个 Gateway 进程通过配置服务多个用户的 Bot，无需改 OpenClaw 核心代码。

## 目录结构

```
nexu/
├── docs/
│   ├── designs/             # 架构设计
│   └── references/          # 编码参考（API 模式、Config schema、基础设施）
├── experiments/             # 验证实验脚本（已通过）
├── apps/
│   ├── api/                 # Hono + Drizzle + Zod OpenAPI 后端
│   └── web/                 # React + Ant Design 前端
├── packages/
│   └── shared/              # 共享 Zod schema / 类型
└── deploy/
    └── k8s/                 # K8s 部署配置
```

## 技术栈

| Layer | Technology |
|-------|-----------|
| **API** | Hono + @hono/zod-openapi + Drizzle + better-auth |
| **Web** | React + Ant Design + Vite + @hey-api/openapi-ts |
| **Validation** | Zod（全链路类型安全，禁止 any） |
| **Database** | PostgreSQL (dev: SQLite) + Drizzle ORM (no FK) |
| **Gateway Runtime** | OpenClaw (多 Agent 共享进程模式) |
| **Channels** | Slack (共享 App + OAuth) |
| **Lint/Format** | Biome |
| **Package Manager** | pnpm workspaces |
| **Infrastructure** | AWS EKS / RDS / ElastiCache / S3 |

## 本地开发

### 首次设置

```bash
pnpm install
pnpm build                                # 构建 shared 包
docker compose up postgres -d             # 启动 PostgreSQL (:5433)
cp apps/api/.env.example apps/api/.env    # 复制环境变量模板，按需填写
pnpm db:push                              # 推送数据库 schema
pnpm seed                                 # 创建 gateway pool + 邀请码
```

### 日常启动

```bash
# Terminal 1: API (:3000) + Web (:5173)
pnpm dev

# Terminal 2: Sidecar + OpenClaw Gateway（轮询 API 拉配置，自动管理 OpenClaw 进程）
pnpm dev:sidecar
```

> Sidecar 每 2 秒从 API 拉最新配置写入 `.openclaw/openclaw.json`，并自动启动和管理 OpenClaw Gateway 进程（:18789）。Web 上改了 channel/bot 后无需重启，OpenClaw 监听文件变更自动热重载。

只做前端/API 开发时，只跑 `pnpm dev` 即可。需要端到端测试 Slack/Discord/飞书时再启动 Sidecar。


## 相关仓库

- [agent-digital-cowork](https://github.com/refly-ai/agent-digital-cowork) — 产品规划、Spec、原型
- [cloudspec](https://github.com/refly-ai/cloudspec) — 技术栈参考（同栈）
- [openclaw](https://github.com/openclaw/openclaw) — 上游 OpenClaw 项目
- [refly-infra](https://github.com/refly-ai/refly-infra) — 基础设施
