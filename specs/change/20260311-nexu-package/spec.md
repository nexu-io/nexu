---
id: "20260311-nexu-package"
name: "Nexu Package"
status: new
created: "2026-03-11"
---

## Overview

调研 Nexu 项目打包时 OpenClaw 将会占据的体积

## Research

### Nexu 与 OpenClaw 的关系

- Nexu 是 控制面（Control Plane），OpenClaw 是 运行时引擎（Runtime Plane）。  
- Nexu 负责多租户数据管理（bot、channel、凭证、路由、pool）并生成 OpenClaw 配置；OpenClaw 负责实际消息处理与 agent 执行。
- 当前集成的版本： 2026.3.7 (apps/gateway/Dockerfile)

#### 启动方式

OpenClaw 以 CLI 启动为独立进程，由 Nexu gateway sidecar 托管（启动、健康检查、重启）。  

- 通过 npm install -g openclaw@... 安装 CLI（apps/gateway/Dockerfile）
- @nexu/gateway 用 spawn(OPENCLAW_BIN, ["gateway", ...]) 拉起它（apps/gateway/src/openclaw-process.ts）
- 作为独立子进程运行，由 sidecar 负责配置下发、健康检查和重启治理

#### 通信方式

Nexu 通过“文件 + HTTP + CLI + 子进程管理”与 OpenClaw 通信，没有直接的 in-process API 调用

- 配置通道（主通道）：Nexu API 生成 OpenClaw JSON 配置；gateway sidecar 拉取后写到 OPENCLAW_CONFIG_PATH，OpenClaw 通过文件 watcher 热加载（apps/gateway/src/config.ts、apps/api/src/routes/pool-routes.ts）。
- 事件通道（HTTP）：Slack 事件先到 Nexu API /api/slack/events，完成路由和验签后，再转发到 OpenClaw 的 HTTP 入口 http://{podIp}:18789/slack/events/{accountId}（apps/api/src/routes/slack-events.ts）。
- 进程控制通道（本机进程）：Nexu gateway 进程直接 spawn OpenClaw 子进程，并做重启治理（apps/gateway/src/openclaw-process.ts）。
- 健康检查通道（CLI）：Nexu 定期执行 openclaw health --json / openclaw status --deep --json 来判断可用性，不是走 SDK（apps/gateway/src/gateway-health.ts）。
- 状态文件通道（共享目录）：通过 OPENCLAW_STATE_DIR 共享技能、上下文等运行时文件（如 skills、nexu-context.json），用于能力同步和运行态对齐（apps/gateway/src/config.ts、apps/gateway/src/bootstrap.ts）。

### OpenClaw 对打包体积的贡献

约定：

- 以 Nexu 当前 pin 的 OpenClaw 版本 2026.3.7 为准（apps/gateway/Dockerfile）
- 假设 “Electron + 内置 OpenClaw + 单架构” 的打包方式
- 不考虑压缩，好计算

估算对 Nexu 打包体积的贡献：约 600MB ~ 700MB

#### 口径一：npm install openclaw

```bash
# 1) 拉取 openclaw 包元信息（确认版本）
npm view openclaw@2026.3.7 version dist.unpackedSize

# 2) 单独安装 openclaw（不跑脚本，避免额外噪音）
mkdir -p /tmp/nexu-size-check/install-2026-3-7
cd /tmp/nexu-size-check/install-2026-3-7
npm init -y
npm i openclaw@2026.3.7 --ignore-scripts --no-fund --no-audit

# 3) 量体积
du -sh node_modules
du -sh node_modules/openclaw
```

体积：

- 整个 node_modules：约 667MB
- 其中本体 node_modules/openclaw：约 167MB
- 其余依赖：约 500MB

#### 口径二：源码仓库 npm pack + npm install（2026.3.7 分支）

```bash
cd /Users/william/projects/openclaw
npm pack --ignore-scripts

mkdir -p /tmp/nexu-size-check/openclaw-local-pack-2026-3-7
cd /tmp/nexu-size-check/openclaw-local-pack-2026-3-7
npm init -y
npm i /Users/william/projects/openclaw/openclaw-2026.3.7.tgz --ignore-scripts --no-fund --no-audit

du -sh node_modules
du -sh node_modules/openclaw
```

体积：

- 整个 node_modules：约 617MB
- 其中本体 node_modules/openclaw：约 115MB
- 其余依赖：约 502MB

#### 口径三：源码仓库 npm install（估算）（2026.3.7 分支）

```bash
rm -rf node_modules package-lock.json && npm install --omit=dev --ignore-scripts --no-fund --no-audit && du -sh node_modules
```

体积：532M

### 其他

https://github.com/openclaw/openclaw/issues/20464

## Design

<!-- Technical approach, architecture decisions -->

## Plan

<!-- Break down implementation and verification into steps -->

- [ ] Phase 1: Implement the first part of the feature
  - [ ] Task 1
  - [ ] Task 2
  - [ ] Task 3
- [ ] Phase 2: Implement the second part of the feature
  - [ ] Task 1
  - [ ] Task 2
  - [ ] Task 3
- [ ] Phase 3: Test and verify
  - [ ] Test criteria 1
  - [ ] Test criteria 2

## Notes

<!-- Optional: Alternatives considered, open questions, etc. -->
