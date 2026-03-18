# Sandbox 隔离部署指南

## 概述

Sandbox 为每个 agent 创建独立的 Docker 容器执行 shell 命令，实现文件系统隔离（agent 之间互不可见）。Gateway 进程仍处理 web search/fetch/message 等非 exec 操作。

## 前置条件

- 代码分支 `feat/feedback-image-embed` 已合并到 main
- CI 构建完成：`nexu-gateway` 和 `nexu-sandbox` 镜像已推送到 ECR

## 部署步骤

### 1. 更新 GitOps repo 的生产 values

```yaml
gateway:
  sandbox:
    enabled: true
    sandboxImage: "<ECR_REGISTRY>/nexu-sandbox:latest"
```

### 2. 删除 StatefulSet（保留 Pod）

由于新增了 `docker-data` volumeClaimTemplate（不可变字段），需要先删除 StatefulSet 再重建。

```bash
kubectl -n nexu delete statefulset nexu-gateway --cascade=orphan
```

- `--cascade=orphan` 保留现有 Pod 和 PVC，用户无感
- 操作窗口几秒，期间 Pod 正常服务但无控制器管理

### 3. 触发 ArgoCD Sync

```bash
# 手动触发（或等自动同步）
argocd app sync nexu
```

ArgoCD 重建 StatefulSet（含 DinD sidecar + docker-data PVC），触发滚动重启。

### 4. 验证

```bash
# 检查 DinD sidecar 是否运行
kubectl -n nexu exec -it nexu-gateway-1 -c dind -- docker info

# 检查 sandbox 镜像是否已拉取
kubectl -n nexu exec -it nexu-gateway-1 -c dind -- docker images | grep nexu-sandbox

# 查看 sandbox 容器（发送消息触发 exec 后才会出现）
kubectl -n nexu exec -it nexu-gateway-1 -c dind -- docker ps
```

### 5. 隔离验证

让 agent 执行以下命令：

```bash
# 应该只能看到自己的目录
ls /data/openclaw/agents/

# 应该不存在
cat /etc/openclaw/config.json

# 应该能正常安装
apt-get update && apt-get install -y jq

# 应该能正常工作
npm install lodash
```

## 回滚

如需关闭 sandbox：

```yaml
gateway:
  sandbox:
    enabled: false
```

由于 `docker-data` PVC 是无条件创建的，关闭 sandbox 不涉及 volumeClaimTemplate 变更，直接滚动更新即可，无需删除 StatefulSet。

## 架构

```
Pod: nexu-gateway-N
├── gateway container
│   ├── OpenClaw 进程（处理消息路由、web search、fetch 等）
│   ├── DOCKER_HOST=tcp://localhost:2375
│   └── 挂载：/etc/openclaw (config), /data/openclaw (PVC)
├── dind container (sandbox 启用时)
│   ├── dockerd（DNS 转发到 K8s DNS）
│   ├── startupProbe + livenessProbe: docker info
│   └── 挂载：/var/lib/docker (PVC), /data/openclaw (PVC)
└── Volumes
    ├── openclaw-data PVC (20Gi) — agent 数据、sessions、skills
    └── docker-data PVC (10Gi) — Docker 镜像缓存、容器 layer
```

### Sandbox 容器内可见

| 宿主路径 | 权限 | 说明 |
|---------|------|------|
| `/data/openclaw/agents/{agentId}/` | rw | agent 自己的 workspace（自动挂载） |
| `/data/openclaw/skills/` | ro | skill 脚本 |
| `/data/openclaw/media/` | rw | 媒体文件（inbound + outbound） |
| `/data/openclaw/nexu-context.json` | ro | API URL 和 pool ID |

### Sandbox 容器外不可见

- 其他 agent 的目录
- `/etc/openclaw/config.json`（含凭据）
- 宿主文件系统
- cron、delivery-queue 等 gateway 内部目录

## 容器生命周期

- **Lazy 创建：** 首次 exec 时才创建容器，不占用空闲资源
- **复用：** `scope: "agent"` — 同一 agent 的多次 exec 复用同一容器
- **回收：** idle 4 小时后自动回收，最长存活 3 天
- **重启后：** agent 的 workspace 数据在 PVC 上不受影响，容器内 apt-get 安装的包需重新安装

## 新增 Skill 依赖

如果某个 skill 需要新的系统依赖：

1. 编辑 `apps/gateway/Dockerfile.sandbox`
2. 添加 `apt-get install` 或 `npm install -g`
3. 推送代码，CI 自动构建新的 `nexu-sandbox` 镜像
4. 重启 gateway pod（或等 container prune 后自动拉取新镜像）
