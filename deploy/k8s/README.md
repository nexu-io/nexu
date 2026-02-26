# K8s 部署配置 (Kustomize)

Nexu 平台的 Kubernetes 部署清单，使用 Kustomize 管理 base + overlays。

## 组件

- `base/nexu-api/` — Nexu API Deployment + Service
- `base/nexu-web/` — Dashboard Deployment + Service (nginx)
- `base/gateway-pool/` — OpenClaw Gateway Deployment + Service + HPA
- `base/config/` — ConfigMap + Secrets
- `base/ingress/` — AWS ALB Ingress
- `overlays/dev/` — 开发环境 (单副本, 低资源)
- `overlays/prod/` — 生产环境 (多副本, 正式域名, ACM 证书)

## 部署

```bash
# 开发环境
kubectl kustomize overlays/dev/ | kubectl apply -f -

# 生产环境
kubectl kustomize overlays/prod/ | kubectl apply -f -
```

## 镜像构建

```bash
# 从项目根目录构建
docker build -f apps/api/Dockerfile -t nexu-api .
docker build -f apps/web/Dockerfile -t nexu-web .
docker build -f apps/gateway/Dockerfile -t nexu-gateway .
```

## 注意事项

- Secrets 中的值为占位符，生产环境应使用 ExternalSecrets 或 AWS Secrets Manager
- ECR image 路径需替换 `ACCOUNT_ID` 和 `REGION`
- Ingress 域名和 ACM 证书 ARN 需替换为实际值
- Gateway 不直接对外暴露，Nexu API 作为 Slack 事件代理内部转发
