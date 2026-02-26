# Nexu Helm Chart

This chart deploys a full Nexu stack in Kubernetes:

- `web` deployment + service
- `api` deployment + service
- `gateway` deployment + service + optional HPA
- shared `ConfigMap` and `Secret`
- NGINX `Ingress`

## Quick Start

```bash
helm upgrade --install nexu ./deploy/k8s/helm/nexu \
  --namespace nexu \
  --create-namespace
```

## Configure Images

```bash
helm upgrade --install nexu ./deploy/k8s/helm/nexu \
  --namespace nexu \
  --set api.image.repository=ghcr.io/your-org/nexu-api \
  --set web.image.repository=ghcr.io/your-org/nexu-web \
  --set gateway.image.repository=ghcr.io/your-org/nexu-gateway \
  --set api.image.tag=v1.0.0 \
  --set web.image.tag=v1.0.0 \
  --set gateway.image.tag=v1.0.0
```

## Configure Ingress (NGINX)

Set host and optional TLS:

```bash
helm upgrade --install nexu ./deploy/k8s/helm/nexu \
  --namespace nexu \
  --set ingress.hosts[0].host=app.nexu.example.com \
  --set ingress.tls[0].hosts[0]=app.nexu.example.com \
  --set ingress.tls[0].secretName=nexu-tls
```

## Sensitive Values

Do not keep production secrets in `values.yaml`. Pass secrets with CI/CD or use `ExternalSecrets`.
