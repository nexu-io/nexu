# 可用基础设施

Nexu 部署在 refly 的 AWS 基础设施上（us-east-1）。以下是可直接使用的组件。

## 计算

| 组件 | 规格 | 说明 |
|------|------|------|
| **EKS 集群** | K8s 1.34, m6a.xlarge 节点 | 3 AZ, 2-6 节点自动伸缩 |
| **ArgoCD** | GitOps 部署 | App-of-Apps 模式，Kustomize overlay |

## 数据存储

| 组件 | 规格 | 连接方式 |
|------|------|---------|
| **PostgreSQL** | RDS db.r8g.large, v16.8, Multi-AZ | `DATABASE_URL` 环境变量 |
| **Redis** | ElastiCache cache.r7g.large × 2, v7.1, TLS | `REDIS_URL` 或 `REDIS_HOST` + `REDIS_PORT` + `REDIS_PASSWORD` |
| **S3** | 多个 bucket（private, images, tempo） | IRSA 认证，无需 access key |
| **EFS** | 共享文件系统 | K8s PVC, ReadWriteMany |

## 消息队列

| 组件 | 用途 |
|------|------|
| **SQS** | 异步任务（文档处理、图片转换等），每个队列配 DLQ |
| **BullMQ** (Redis) | 应用内 job 队列（NestJS @nestjs/bullmq） |

## 秘钥管理

| 组件 | 用途 |
|------|------|
| **AWS Secrets Manager** | 存储数据库密码、API key、JWT secret 等 |
| **External Secrets Operator** | 自动同步 Secrets Manager → K8s Secret |
| **AWS KMS** | 信封加密（加密用户的 channel 凭证） |

## 认证

| 组件 | 说明 |
|------|------|
| **JWT** | 7 天过期, 30 天 refresh token |
| **OAuth** | GitHub, Google（已有回调配置） |
| **API Key** | `rf_` 前缀，hash 存储，用于 CLI 认证 |
| **IRSA** | K8s Service Account → IAM Role，用于 AWS 服务访问 |

## 网络 & 入口

| 组件 | 说明 |
|------|------|
| **NGINX Ingress** | TLS 终止 (Let's Encrypt), WebSocket 支持, 50MB body limit |
| **ALB** | AWS Application Load Balancer, 前置 NGINX |
| **域名** | `*.refly.ai`（可为 Nexu 添加子域） |

## 可观测性

| 组件 | 用途 | 接入方式 |
|------|------|---------|
| **Prometheus** | 指标采集 | `/metrics` 端点, ServiceMonitor |
| **Grafana** | 监控面板 | `grafana.refly.ai` |
| **Loki** | 日志聚合 | stdout JSON → Alloy DaemonSet → Loki |
| **Tempo** | 分布式追踪 | OTLP → `otel-collector.refly-observability.svc:4318` |
| **Langfuse** | LLM 调用追踪 | `langfuse-web.refly-observability.svc:3000` |
| **Sentry** | 错误追踪 | `SENTRY_DSN` 环境变量 |

## Nexu 专用资源（待创建）

部署 Nexu 时需要新建以下资源：

```
K8s Namespace:  openclaw-platform
ECR 仓库:       nexu-control-plane, nexu-webhook-router, nexu-gateway
RDS:            复用现有 PostgreSQL（新建 schema: nexu）
Redis:          复用现有 ElastiCache（key prefix: nexu:）
S3:             复用或新建 bucket（session 数据）
EFS:            新建 PVC（Gateway session/workspace 存储）
Secrets:        openclaw-platform/* (Secrets Manager)
域名:           api.nexu.refly.ai, app.nexu.refly.ai
```
