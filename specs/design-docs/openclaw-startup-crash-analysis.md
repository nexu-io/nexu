# OpenClaw Gateway Startup Crash Analysis

Date: 2026-03-06

## Background

OpenClaw is the upstream chat gateway that Nexu manages as a child process via the gateway sidecar. When OpenClaw crashes during startup, the sidecar's auto-restart mechanism kicks in, but certain failure modes cause persistent CrashLoops that require manual intervention.

This document catalogs all discovered startup crash scenarios from OpenClaw source code analysis (`openclaw@latest`, bundled at `node_modules/openclaw/dist/gateway-cli-CuFEx2ht.js`), their applicability to Nexu, and the mitigations in place.

## Crash Taxonomy

### Fatal Crashes (process.exit(1))

These cause OpenClaw to exit immediately. The sidecar's `scheduleRestart` handles retry up to `MAX_CONSECUTIVE_RESTARTS` (10).

| # | Scenario | Trigger | Nexu Risk | Mitigation |
|---|----------|---------|-----------|------------|
| F1 | `gateway.mode != "local"` | Config missing or `mode` field wrong | Low | Config generator always sets `mode: "local"` |
| F2 | `auth=password` without password | Config sets password auth without `auth.password` | None | Nexu uses `auth.mode: "token"` |
| F3 | Non-loopback bind without auth | `bind: "lan"` without any auth configured | None | Nexu always sets auth token |
| F4 | **Stale gateway lock file** | Previous crash left `gateway.<hash>.lock` in tmpdir | **High** | **Fixed**: sidecar now clears locks at bootstrap and before restart |
| F5 | Port EADDRINUSE | Zombie OpenClaw process holding port 18789 | Medium | Lock cleanup (F4 fix) reduces likelihood; pod restart clears |
| F6 | Invalid config schema | Config JSON fails OpenClaw's internal AJV validation | Low | Config generator output matches schema; `.passthrough()` allows extras |
| F7 | Secrets unavailable | Config references `$SECRET:keyname` but backend can't resolve | None | Nexu inlines credentials directly |
| F8 | TLS configuration failure | Invalid cert/key paths | None | Nexu does not configure TLS |
| F9 | Nix mode + legacy config | Legacy config entries in Nix-managed install | None | Nexu does not use Nix |
| F10 | Hooks validation failure | `hooks.enabled` without `hooks.token`, invalid path, etc. | None | Nexu does not configure hooks |
| F11 | Top-level `channels.slack` missing `mode`/`signingSecret` | Schema validation rejects | None | Config generator always provides both |
| F12 | `dmPolicy: "open"` without `allowFrom: ["*"]` | Schema validation rejects | None | Config generator always pairs them |

### Slack Channel Failures

| # | Scenario | Trigger | Nexu Risk | Mitigation |
|---|----------|---------|-----------|------------|
| S1 | **`auth.test()` returns error** | Revoked/expired bot token | **High** | **Fixed**: token health check endpoint + periodic validation |
| S2 | `isConfigured` returns false | Empty `botToken` or `signingSecret` | Low | Account silently not started; no crash |
| S3 | Missing `appToken` in HTTP mode | OpenClaw requires it even in HTTP mode | None | Config generator provides placeholder `xapp-placeholder-not-used-in-http-mode` |

### Discord Channel Failures

| # | Scenario | Trigger | Gateway Crashes? | Notes |
|---|----------|---------|-----------------|-------|
| D1 | Token empty | `isConfigured` returns false | No | Account not started |
| D2 | Token probe failure | Invalid token, network issue | No | Logs warning, continues |
| D3 | Message Content Intent disabled | Bot can't read messages | No | Logs warning, continues |

### Feishu Channel Failures

| # | Scenario | Trigger | Gateway Crashes? | Notes |
|---|----------|---------|-----------------|-------|
| L1 | Plugin not enabled | `plugins.entries.feishu.enabled` not set | No | Channel section silently ignored (Pitfall #16) |
| L2 | No enabled accounts | All accounts `enabled: false` | No | Channel-level error only |
| L3 | Webhook mode without `verificationToken` | Missing config field | No | Nexu uses `connectionMode: "websocket"` |
| L4 | WebSocket client startup failure | Bad `appId`/`appSecret` | No | Channel-level error, gateway continues |
| L5 | Webhook port EADDRINUSE | Port already taken | No | Nexu uses websocket mode |
| L6 | Bot info probe timeout | Feishu API slow/unreachable | No | Non-fatal, continues after 10s |

### Sidecar-Level Failures

| # | Scenario | Trigger | Nexu Risk | Mitigation |
|---|----------|---------|-----------|------------|
| X1 | Missing production env vars | `INTERNAL_API_TOKEN`, `SKILL_API_TOKEN`, or `RUNTIME_POOL_ID` unset | Medium | Sidecar exits before `main()`; caught by k8s CrashLoopBackOff |
| X2 | `OPENCLAW_BIN` not found | Binary not on PATH | Low | Docker image includes it |
| X3 | **MAX_CONSECUTIVE_RESTARTS exceeded** | 10 crashes within 2 minutes | **High** | OpenClaw permanently dead until pod restart |
| X4 | **`waitGatewayReady` infinite spin** | OpenClaw never becomes healthy | **High** | **Fixed**: max 120 attempts (~2 min), then continues bootstrap |

## Mitigations Implemented

### 1. Slack Bot Token Health Check (PR: feat/slack-token-health-check)

**Problem**: Slack `auth.test()` failure crashes OpenClaw (S1).

**Solution**:
- API endpoint `POST /api/internal/pools/{poolId}/check-slack-tokens` validates all Slack bot tokens via `auth.test`, marks invalid ones as `error` in DB, triggers config regeneration
- Gateway sidecar calls this at bootstrap (before OpenClaw starts) and periodically every `RUNTIME_TOKEN_HEALTH_INTERVAL_MS` (default 5 min)
- Reactive handling: `tokens_revoked` and `app_uninstalled` events in `slack-events.ts` immediately mark channels and regenerate config

**Files**: `pool-routes.ts`, `runtime-internal.ts`, `bootstrap.ts`, `loops.ts`, `api.ts`, `env.ts`, `index.ts`, `slack-events.ts`, `slack-oauth-view.tsx`

### 2. Gateway Lock File Cleanup (same PR)

**Problem**: Stale `gateway.<hash>.lock` file after unclean exit prevents restart (F4).

**Solution**:
- `clearStaleGatewayLocks()` in `bootstrap.ts` clears `os.tmpdir()/openclaw-<uid>/gateway.*.lock` before starting OpenClaw
- `openclaw-process.ts` also clears locks before each restart in `scheduleRestart`

**Files**: `bootstrap.ts`, `openclaw-process.ts`

### 3. `waitGatewayReady` Timeout (same PR)

**Problem**: If OpenClaw never becomes healthy, `waitGatewayReady()` spins forever (X4).

**Solution**: Added `MAX_READY_ATTEMPTS = 120` (~2 minutes). On timeout, logs error and continues bootstrap so health probes and other loops can still operate.

**Files**: `gateway-health.ts`

## Remaining Risks

### Low Priority

- **X3 (restart limit)**: After 10 consecutive crashes the sidecar gives up. The pod stays alive but OpenClaw is dead. The health probe loop (running independently) will eventually mark the gateway as `unhealthy` via heartbeat, making the issue observable. A k8s liveness probe on the sidecar's health endpoint would auto-restart the pod, but is not yet configured.

- **F5 (EADDRINUSE)**: A zombie OpenClaw process could hold port 18789. The lock cleanup (F4 fix) makes this less likely since lock acquisition also validates the port. In the worst case, a pod restart resolves it.

- **F6 (config schema drift)**: If OpenClaw updates its internal schema validation to be stricter, the Nexu config generator could produce configs that pass Nexu-side Zod (with `.passthrough()`) but fail OpenClaw's AJV. Mitigation: pin OpenClaw version, test config generation after upgrades.

### Not Applicable to Nexu

TLS (F8), Nix mode (F9), Hooks (F10), Tailscale, and trusted-proxy auth are features Nexu does not use. No action needed unless the deployment model changes.
