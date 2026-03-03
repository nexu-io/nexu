---
name: prod-ops
description: Use when the user says "production", "prod", "deploy to prod", "run migration", "connect to prod DB", "check prod", "prod secrets", or needs any production environment operations. Covers EKS, RDS, SSM tunnels, migrations, secrets, and post-deploy tasks.
---

# Nexu Production Operations

Production environment operations for the Nexu platform on AWS (EKS + RDS).

## MANDATORY: Confirmation Before Every Action

**This skill operates on PRODUCTION. Every command that touches production state MUST be confirmed with the user before execution.**

Classify every operation:

| Level | Examples | Rule |
|-------|---------|------|
| **READ-ONLY** | `kubectl get pods`, `kubectl logs`, `curl .../health`, list secret keys | Show command, execute after user approves |
| **WRITE** | `kubectl delete pod`, run migrations, store secrets, sync skills, `kubectl exec` | Show command + explain impact, wait for explicit "yes" |
| **DESTRUCTIVE** | DROP/DELETE/TRUNCATE on DB, force-delete PVC, modify sessions.json/config.json on pods | **REFUSE by default.** Explain why it's dangerous. Only proceed if user insists after seeing the risks. |

**NEVER auto-execute any production command.** Always present the command first and wait for approval.

**NEVER run `kubectl exec` to write files on pods** (sessions.json, config.json, or any state file). Restart the pod instead.

## Credential Rules

**NEVER hardcode or echo credentials in commands, output, or files.**

All credentials must be fetched at runtime from K8s secrets:

```bash
# DB password
DB_PASS=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.DATABASE_PASSWORD}' | base64 -d)

# Internal API token
PROD_TOKEN=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.INTERNAL_API_TOKEN}' | base64 -d)

# Full DB connection string
DB_URL="postgresql://nexu_app:${DB_PASS}@localhost:5434/nexu"
```

Never store credentials in:
- Skill files, CLAUDE.md, or any committed file
- Shell history (use variables, not inline literals)
- Log output or error messages

## Quick Reference

| Resource | Value |
|----------|-------|
| EKS cluster | `nexu-prod-eks` (us-east-1) |
| K8s namespace | `nexu` |
| SSM jump host | `i-08ffa2a4100b49346` |
| Local DB tunnel port | `5434` |
| DB name | `nexu` |
| DB user | `nexu_app` |
| K8s secret name | `nexu-secrets` |
| RDS host | Fetch from K8s secret `DATABASE_HOST` or use SSM tunnel |

## Operations

### 1. Connect to EKS Cluster

```bash
aws eks update-kubeconfig --region us-east-1 --name nexu-prod-eks
kubectl get pods -n nexu
```

Verify pods: `nexu-api`, `nexu-gateway-*`, `nexu-web`.

### 2. Connect to Production Database

**Step A — SSM tunnel** (keep terminal open):

```bash
RDS_HOST=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.DATABASE_HOST}' | base64 -d)
aws ssm start-session \
  --target "i-08ffa2a4100b49346" \
  --document-name "AWS-StartPortForwardingSessionToRemoteHost" \
  --parameters "{\"host\":[\"${RDS_HOST}\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5434\"]}"
```

**Step B — Connect** (in another terminal):

```bash
DB_PASS=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.DATABASE_PASSWORD}' | base64 -d)
psql "postgresql://nexu_app:${DB_PASS}@localhost:5434/nexu"
```

### 3. Run Migrations

After establishing the SSM tunnel:

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
DB_PASS=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.DATABASE_PASSWORD}' | base64 -d)
node -e "import('./apps/api/src/db/migrate.ts').then(m => m.migrate('postgresql://nexu_app:${DB_PASS}@localhost:5434/nexu')).catch(e => { console.error(e); process.exit(1); })"
```

Or run specific DDL directly via psql. Always use `IF NOT EXISTS` for idempotency.

**Do NOT use `drizzle-kit push`** — it tries to drop better-auth tables.

### 4. Port-Forward to Internal Services

```bash
# API (port 3001 locally → 3000 in cluster)
kubectl port-forward -n nexu svc/nexu-api 3001:3000

# Gateway (port 18790 locally → 18789 in cluster)
kubectl port-forward -n nexu svc/nexu-gateway 18790:18789
```

### 5. Read Production Secrets

```bash
# List all secret keys
kubectl get secret -n nexu nexu-secrets -o json | jq -r '.data | keys[]'

# Read a specific secret (never echo to logs)
kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.INTERNAL_API_TOKEN}' | base64 -d
```

### 6. Store Pool Secrets (Post-Deploy)

After deploying code that includes the PUT secrets endpoint:

```bash
PROD_TOKEN=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.INTERNAL_API_TOKEN}' | base64 -d)
kubectl port-forward -n nexu svc/nexu-api 3001:3000 &

# Insert secrets for each pool (pool_prod_01, gateway_pool_1, gateway_pool_2)
curl -X PUT http://localhost:3001/api/internal/pools/<poolId>/secrets \
  -H "x-internal-token: ${PROD_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"secrets":{"KEY_NAME":"value"}}'
```

Secrets are encrypted by the API using the production `ENCRYPTION_KEY`. You cannot INSERT encrypted values directly via SQL.

### 7. Sync Skills to Production

```bash
PROD_TOKEN=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.INTERNAL_API_TOKEN}' | base64 -d)
kubectl port-forward -n nexu svc/nexu-api 3001:3000 &

node -e "
const fs = require('fs');
const skillMd = fs.readFileSync('$HOME/.openclaw/skills/<skill-name>/SKILL.md', 'utf8');
const extraFiles = {};  // e.g. { 'scripts/deploy.sh': fs.readFileSync('...', 'utf8') }
fetch('http://localhost:3001/api/internal/skills/<skill-name>', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'x-internal-token': '${PROD_TOKEN}' },
  body: JSON.stringify({ content: skillMd, files: extraFiles, status: 'active' })
}).then(r => r.json()).then(console.log);
"
```

### 8. Check Deployed Version

```bash
curl -s http://localhost:3001/health | jq .metadata.commitHash
# Compare with: git log --oneline origin/main -1
```

### 9. View Pod Logs

```bash
kubectl logs -n nexu -l app=nexu-api --tail=100 -f
kubectl logs -n nexu nexu-gateway-1 --tail=100 -f
```

### 10. Restart a Gateway Pod (Safe Method)

When a gateway pod needs recovery, **always restart the pod** — never modify files inside it.

```bash
kubectl delete pod nexu-gateway-<N> -n nexu
# K8s auto-recreates pod, sidecar re-syncs config from API, sessions rebuild on next message
```

PVC data (skill files) survives pod restart. Only in-memory state (sessions) is lost for that pod.

## Production Pool IDs

| Pool ID | Pool Name | Notes |
|---------|-----------|-------|
| pool_prod_01 | prod-pool-01 | Primary production pool |
| gateway_pool_1 | gateway_pool_1 | Additional gateway |
| gateway_pool_2 | gateway_pool_2 | Additional gateway |

## Dangerous Operations — NEVER Do These

### NEVER overwrite or reset sessions.json

**Do NOT write to `sessions.json` on gateway pods.** This file holds all active conversation context for every bot session. Overwriting it causes:

1. **All conversation history lost** — unrecoverable, no backups exist
2. **OpenClaw process crash** — detects file change mid-run, exits and restarts
3. **OpenClaw doctor overwrites config** — on restart, doctor auto-runs and removes Nexu-generated config fields (`streaming`, `nativeStreaming`, etc.)
4. **Sidecar won't auto-fix config** — it tracks config hash in memory, doesn't know disk was changed
5. **Shell escaping traps** — `find -exec sh -c 'echo {} > "$1"'` writes the file path, not `{}`

**Incident (2026-03-03):** `sessions.json` was overwritten with `{}` on gateway-1 and corrupted on gateway-2 (file path string written instead of JSON). Result: all session context lost across both gateways, gateway-2 Discord bots went down. Required pod restart to recover (sessions still lost).

### NEVER modify config.json on gateway pods

OpenClaw's `doctor` auto-runs on restart and may overwrite `/etc/openclaw/config.json`. The sidecar won't re-sync because it tracks the API config hash in memory, not the disk file. If config gets corrupted, restart the pod.

### NEVER use kubectl exec to write state files

Any `kubectl exec ... > file` or `kubectl exec ... sh -c "echo ... > file"` on gateway pods risks corrupting state that OpenClaw or the sidecar manages. Always restart the pod to get a clean state.

## Rules

1. **Never hardcode credentials** — always fetch from K8s secrets at runtime
2. **Always use SSM tunnel** for DB access — RDS is in a private subnet
3. **Never run `drizzle-kit push`** against production — it drops auth tables
4. **Use `IF NOT EXISTS`** for all DDL statements
5. **Secrets go through the API** — never insert encrypted values directly via SQL
6. **Confirm with user** before ANY production command — read-only included
7. **Keep SSM tunnel terminal open** — closing it drops the connection
8. **Kill port-forwards** when done — `pkill -f "kubectl port-forward.*nexu"`
9. **Never overwrite sessions.json** — restart the pod instead
10. **Never manually edit config.json on pods** — restart the pod to re-sync from API
11. **Never use kubectl exec to write files on pods** — restart instead
