# Scoped Secrets — Production Migration Plan

**Date:** 2026-03-03
**PR:** #54 (`feat/secret-broker-sidecar`)
**Branch:** 21 commits on `feat/secret-broker-sidecar`

## Current Production State

| Component | Current State |
|-----------|--------------|
| API + Gateway image | `sha-ff1db45` (commit: fix onboarding avatar #52) |
| Main branch HEAD | `acd8a47` (ci: CORS proxy worker #47) |
| K8s Secrets | Has `INTERNAL_API_TOKEN`, `GATEWAY_TOKEN` (legacy), `ENCRYPTION_KEY` — **no `SKILL_API_TOKEN`** |
| Gateway env vars | `INTERNAL_API_TOKEN` from secret — **no `SKILL_API_TOKEN`** |
| API env | `envFrom: secretRef` (gets all secrets automatically) |
| `pool_secrets` table | No `scope` column |
| `nexu-context.json` | Contains `internalToken` + `secrets` (old behavior) |
| OpenClaw child process | Inherits full gateway env including `INTERNAL_API_TOKEN` |
| Session endpoints | Unauthenticated (no `requireInternalToken`) |

## What Changes

| Before | After |
|--------|-------|
| OpenClaw inherits `INTERNAL_API_TOKEN` | Stripped from child env, only `SKILL_API_TOKEN` passed |
| `nexu-context.json` has `internalToken` + `secrets` | Only `apiUrl`, `poolId`, `agents` — no tokens or secrets |
| No scoped secrets | `pool_secrets.scope` column: `"pool"` or `"skill:name"` |
| Skills can't fetch own secrets | `GET /api/internal/secrets/:skillName` with skill token |
| Artifact endpoints accept any internal token | Require `SKILL_API_TOKEN` or `INTERNAL_API_TOKEN` |
| Session endpoints unauthenticated | Require `INTERNAL_API_TOKEN` |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Gateway crash on boot (missing `SKILL_API_TOKEN`) | **HIGH** | Add secret BEFORE deploying new image |
| Session endpoints break (now require auth) | **LOW** | Only called by gateway sidecar, which uses `INTERNAL_API_TOKEN` |
| Existing pool_secrets migration | **LOW** | `scope` column defaults to `"pool"` — all existing secrets remain accessible |
| OpenClaw process loses env vars | **LOW** | Only `INTERNAL_API_TOKEN` and `ENCRYPTION_KEY` stripped — these were never used by skills |

## Migration Steps

### Pre-flight (read-only verification)

```bash
# 1. Verify cluster access
kubectl get pods -n nexu

# 2. Verify current secret keys
kubectl get secret -n nexu nexu-secrets -o json | jq -r '.data | keys[]'

# 3. Verify gateway env (should NOT have SKILL_API_TOKEN yet)
kubectl get statefulset -n nexu nexu-gateway -o json | \
  jq '.spec.template.spec.containers[0].env[].name'

# 4. Verify API is healthy
kubectl port-forward -n nexu svc/nexu-api 3001:3000 &
curl -s http://localhost:3001/health | jq .
kill %1
```

---

### Step 1 — DB Migration: Add `scope` column

**Type:** WRITE (DB schema change)
**Downtime:** None (additive column with default)

Establish SSM tunnel, then run:

```sql
ALTER TABLE pool_secrets
  ADD COLUMN IF NOT EXISTS scope text DEFAULT 'pool' NOT NULL;
```

Verify:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'pool_secrets' AND column_name = 'scope';
```

---

### Step 2 — Generate `SKILL_API_TOKEN` value

Generate a secure random token locally:

```bash
SKILL_TOKEN=$(openssl rand -hex 32)
echo "Generated SKILL_API_TOKEN (save this for Step 3)"
# Do NOT echo the actual value — copy from openssl output
```

---

### Step 3 — Add `SKILL_API_TOKEN` to K8s Secret

**Type:** WRITE (K8s secret update)
**Downtime:** None (existing pods unaffected until restart)

```bash
kubectl patch secret -n nexu nexu-secrets --type='json' \
  -p='[{"op":"add","path":"/data/SKILL_API_TOKEN","value":"'$(echo -n "$SKILL_TOKEN" | base64)'"}]'
```

Verify:

```bash
kubectl get secret -n nexu nexu-secrets -o json | jq -r '.data | keys[]' | grep SKILL
# Should show: SKILL_API_TOKEN
```

---

### Step 4 — Update Gateway StatefulSet to inject `SKILL_API_TOKEN`

**Type:** WRITE (K8s spec change — triggers rolling restart)
**Downtime:** Brief per-pod rolling restart (~30s per gateway)

```bash
kubectl patch statefulset -n nexu nexu-gateway --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/env/-","value":{"name":"SKILL_API_TOKEN","valueFrom":{"secretKeyRef":{"name":"nexu-secrets","key":"SKILL_API_TOKEN"}}}}]'
```

**IMPORTANT:** This triggers a rolling restart of gateway pods with the OLD image. The old gateway code ignores `SKILL_API_TOKEN` so this is safe. We do this now to ensure the env var is present when the new image deploys.

Verify:

```bash
kubectl get statefulset -n nexu nexu-gateway -o json | \
  jq '.spec.template.spec.containers[0].env[] | select(.name=="SKILL_API_TOKEN")'
```

Wait for pods to stabilize:

```bash
kubectl rollout status statefulset/nexu-gateway -n nexu --timeout=120s
kubectl get pods -n nexu -l app.kubernetes.io/component=gateway
```

---

### Step 5 — Merge PR and deploy new images

**Type:** WRITE (code deploy)
**Downtime:** Rolling restart (~1-2 min total)

1. Merge PR #54 to `main`
2. CI builds new Docker images for `nexu-api` and `nexu-gateway`
3. ArgoCD (via Orbit API) syncs new image tags to EKS
4. Rolling restart of API pods, then gateway pods

Monitor:

```bash
kubectl get pods -n nexu -w
```

Wait for all pods to be `Running` and `1/1 READY`.

---

### Step 6 — Post-deploy verification

```bash
# 6a. API health
kubectl port-forward -n nexu svc/nexu-api 3001:3000 &

curl -s http://localhost:3001/health | jq .

# 6b. Verify SKILL_API_TOKEN works on skill-facing endpoint
SKILL_TOKEN=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.SKILL_API_TOKEN}' | base64 -d)

curl -s -X GET http://localhost:3001/api/internal/secrets/static-deploy?poolId=gateway_pool_1 \
  -H "x-internal-token: $SKILL_TOKEN" | jq .
# Expected: 200 with secrets (or empty if none scoped to static-deploy)

# 6c. Verify SKILL_API_TOKEN is BLOCKED from privileged endpoints
curl -s -X GET http://localhost:3001/api/internal/pools/gateway_pool_1/config/latest \
  -H "x-internal-token: $SKILL_TOKEN" -w "\n%{http_code}"
# Expected: 401

# 6d. Verify INTERNAL_API_TOKEN still works on privileged endpoints
PROD_TOKEN=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.INTERNAL_API_TOKEN}' | base64 -d)

curl -s -X GET http://localhost:3001/api/internal/pools/gateway_pool_1/config/latest \
  -H "x-internal-token: $PROD_TOKEN" | jq .version
# Expected: 200 with config version

# 6e. Check nexu-context.json on a gateway pod (should NOT have internalToken or secrets)
kubectl exec -n nexu nexu-gateway-1 -- cat /data/openclaw/nexu-context.json | jq 'keys'
# Expected: ["agents", "apiUrl", "poolId"] — NO "internalToken", NO "secrets"

# 6f. Verify OpenClaw child process does NOT have INTERNAL_API_TOKEN
kubectl exec -n nexu nexu-gateway-1 -- sh -c 'cat /proc/$(pgrep -f "openclaw gateway")/environ | tr "\0" "\n" | grep -c INTERNAL_API_TOKEN'
# Expected: 0

kill %1
```

---

### Step 7 — Store scoped secrets for static-deploy skill

If CF credentials are currently stored as pool-level secrets, re-store them with skill scope:

```bash
PROD_TOKEN=$(kubectl get secret -n nexu nexu-secrets -o jsonpath='{.data.INTERNAL_API_TOKEN}' | base64 -d)
kubectl port-forward -n nexu svc/nexu-api 3001:3000 &

# For each production pool:
for POOL_ID in gateway_pool_1 gateway_pool_2; do
  curl -s -X PUT "http://localhost:3001/api/internal/pools/${POOL_ID}/secrets" \
    -H "x-internal-token: $PROD_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "secrets": {
        "CLOUDFLARE_API_TOKEN": "<CF_TOKEN_VALUE>",
        "CLOUDFLARE_ACCOUNT_ID": "<CF_ACCOUNT_ID>"
      },
      "scope": "skill:static-deploy"
    }' | jq .
done

kill %1
```

---

### Step 8 — Update Helm chart + K8s base manifests

After production is verified, update the repo manifests to match:

| File | Change |
|------|--------|
| `deploy/k8s/base/config/secrets.yaml` | Replace `GATEWAY_TOKEN` with `INTERNAL_API_TOKEN` + `SKILL_API_TOKEN` |
| `deploy/k8s/base/gateway-pool/deployment.yaml` | Replace `GATEWAY_TOKEN` env with `INTERNAL_API_TOKEN` + `SKILL_API_TOKEN` |
| `deploy/helm/nexu/values.yaml` | Add `SKILL_API_TOKEN` to `secret:` section |
| `deploy/helm/nexu/templates/gateway-deployment.yaml` | Add `SKILL_API_TOKEN` env from secret |

---

### Step 9 — Cleanup legacy `GATEWAY_TOKEN`

**After confirming production is stable (wait 24h):**

```bash
kubectl patch secret -n nexu nexu-secrets --type='json' \
  -p='[{"op":"remove","path":"/data/GATEWAY_TOKEN"}]'
```

No code references `GATEWAY_TOKEN` — it was only in K8s manifests (now replaced).

---

## Rollback Plan

If gateway pods crash after Step 5:

```bash
# 1. Check if SKILL_API_TOKEN env is missing
kubectl get statefulset -n nexu nexu-gateway -o json | \
  jq '.spec.template.spec.containers[0].env[].name'

# 2. If missing, add it (Step 4) and restart:
kubectl rollout restart statefulset/nexu-gateway -n nexu

# 3. If image is broken, roll back to previous image:
kubectl set image statefulset/nexu-gateway -n nexu \
  gateway=186593931982.dkr.ecr.us-east-1.amazonaws.com/nexu-gateway:sha-ff1db45f6269b989d47e0d91bba302c642da70b6
```

If session endpoints break (unlikely — gateway sidecar sends `INTERNAL_API_TOKEN`):

```bash
# Check gateway sidecar logs for 401 errors
kubectl logs -n nexu nexu-gateway-1 --tail=50 | grep -i "401\|unauthorized"
```

## Order Dependency

```
Step 1 (DB) ──┐
Step 2 (gen)──┤
              ├── Step 3 (secret) → Step 4 (env) → Step 5 (deploy) → Step 6 (verify) → Step 7 (scoped secrets)
              │                                                                          → Step 8 (manifests)
              │                                                                          → Step 9 (cleanup)
```

Steps 1-2 can run in parallel. Step 3 must precede Step 4. Step 4 must precede Step 5. Steps 7-9 are post-deploy.
