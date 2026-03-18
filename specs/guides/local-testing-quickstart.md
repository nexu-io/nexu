# 本地测试快速教程

这是一份最小可运行版本的本地测试指南：

- 配好 PostgreSQL 连接
- 本地准备好 OpenClaw 实例（用于后续联调）
- 直接执行 `pnpm dev` 跑起 Nexu

适合先把开发环境快速跑通，再逐步做 Slack/Gateway 端到端测试。

## 1) 前置条件

- Node.js 20+
- pnpm 9+
- Docker（用于本地 PostgreSQL）
- 本地 OpenClaw 仓库（至少完成一次安装）

## 2) 启动 PostgreSQL

在仓库根目录执行：

```bash
docker compose up postgres -d
```

默认会在本机暴露 `5433` 端口。

## 3) 配置 API 环境变量

```bash
cp apps/api/.env.example apps/api/.env
```

最少确认以下字段（其余保持默认即可）：

```env
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev
BETTER_AUTH_SECRET=nexu-dev-secret-change-in-production
BETTER_AUTH_URL=http://localhost:3000
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
GATEWAY_TOKEN=gw-secret-token
PORT=3000
WEB_URL=http://localhost:5173
```

## 4) 本地安装 OpenClaw（一次性）

推荐用一条命令安装：

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

如果你需要从源码安装，再使用：

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm build
```

说明：这一步是“本地已具备 OpenClaw 实例”的准备动作。当前快速教程不要求你马上启动 OpenClaw 进程。

## 5) 启动 Nexu

回到 Nexu 仓库根目录执行：

```bash
pnpm dev
```

启动后默认访问：

- API: `http://localhost:3000`
- Web: `http://localhost:5173`

## 6) 快速自检

- 打开 `http://localhost:5173`，确认页面可访问
- 访问 `http://localhost:3000/health`，确认 API 健康

到这里就完成了最小本地测试环境。若你要继续做 Slack/网关联调，请看：

- `specs/guides/local-slack-testing.md`
- `specs/guides/local-runtime-sidecar.md`
