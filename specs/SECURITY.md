# Security

## Reporting vulnerabilities

**Do not use this file to submit new security issues.** For responsible disclosure (what to send, scope, timelines), see **[`SECURITY.md`](../SECURITY.md)** in the repository root.

The sections below are **implementation and architecture notes** for developers and auditors.

## Credential handling

- All channel credentials (bot tokens, signing secrets) encrypted at rest with AES-256-GCM
- Encryption key: 32-byte hex from `ENCRYPTION_KEY` env var
- Implementation lives in the active controller-side secret and crypto helpers
- Credentials decrypted only when needed (config generation, signature verification)
- **Credentials must never appear in logs, error messages, or API responses**

## Slack signature verification

- All incoming Slack events verified via HMAC-SHA256
- Signing secret retrieved from encrypted `channel_credentials`
- 5-minute timestamp window enforced
- Timing-safe comparison (`crypto.timingSafeEqual`)
- Implementation follows the active controller/runtime event handling path

## Authentication

- better-auth with email/password registration
- HTTP-only session cookies
- `authMiddleware` validates session for all `/v1/*` routes
- Configured in the active controller auth stack

### Internal API — Two-token model

Internal endpoints (`/api/internal/*`) use a two-tier token system:

| Token | Env var | Purpose | Who holds it |
|-------|---------|---------|-------------|
| Internal token | `INTERNAL_API_TOKEN` | Privileged operations (config, secrets mgmt, skill sync) | Controller-managed local runtime only |
| Skill token | `SKILL_API_TOKEN` | Skill-facing operations (fetch scoped secrets, record artifacts) | OpenClaw child process (via env) |

**Middleware:**
- `requireInternalToken(c)` — accepts only `INTERNAL_API_TOKEN`
- `requireSkillToken(c)` — accepts `SKILL_API_TOKEN` or `INTERNAL_API_TOKEN` (superset)
- Both use `crypto.timingSafeEqual` for constant-time comparison
- Implementation follows the active controller internal-auth middleware

**Endpoint mapping:**

| Endpoint | Auth |
|----------|------|
| `GET /config`, `GET /config/latest`, `GET /config/versions/:v` | `requireInternalToken` |
| `POST /register`, `POST /heartbeat` | `requireInternalToken` |
| `PUT /secrets` | `requireInternalToken` |
| `POST /sessions`, `PATCH /sessions/:id`, `POST /sessions/sync-discord` | `requireInternalToken` |
| `GET /secrets/:skillName` | `requireSkillToken` |
| `POST /artifacts`, `PATCH /artifacts/:id` | `requireSkillToken` |
| `POST /composio/execute`, `POST /composio/disconnect` | `requireSkillToken` |

### OpenClaw process isolation

The gateway strips privileged env vars before spawning the OpenClaw child process:
- `INTERNAL_API_TOKEN` — **not inherited** by OpenClaw
- `ENCRYPTION_KEY` — **not inherited** by OpenClaw
- `SKILL_API_TOKEN` — inherited, used by skills to fetch scoped secrets

`nexu-context.json` (written by gateway sidecar) contains only `apiUrl`, `poolId`, and `agents` — no tokens or secrets on disk.

## Pool secrets scoping

- Secrets stored in `pool_secrets` table, encrypted with AES-256-GCM
- Each secret has a `scope` field: `pool` (available to all skills) or `skill:<name>` (specific skill only)
- Skills fetch their secrets at runtime via `GET /api/internal/secrets/:skillName` using `SKILL_API_TOKEN`
- API returns only secrets where `scope = 'pool'` OR `scope = 'skill:<skillName>'`

## Secret management

- Production: AWS Secrets Manager → External Secrets Operator → K8s Secrets
- Local dev: `.env` file (never committed)
- Required: `DATABASE_URL`, `ENCRYPTION_KEY`, `INTERNAL_API_TOKEN`, `SKILL_API_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `BETTER_AUTH_SECRET`
- Optional: `LITELLM_BASE_URL`, `LITELLM_API_KEY`

## OAuth state

- Slack OAuth state tokens stored in `oauth_states` table with expiry
- State verified on callback to prevent CSRF
- Tokens marked as used after consumption (single-use)

## Composio integration OAuth

- Third-party OAuth flows (Gmail, Google Calendar, etc.) managed via Composio SDK
- `user_integrations` table tracks per-user OAuth connection state
- `integration_credentials` stores encrypted credential material (AES-256-GCM)
- OAuth state parameter stored in `user_integrations.oauth_state` for CSRF prevention
- Connection URLs generated server-side (`composio-routes.ts`) — never crafted client-side
- `composio-exec.js` runs in OpenClaw child process with `SKILL_API_TOKEN` only (no `INTERNAL_API_TOKEN`)
- Auth endpoint: `POST /api/internal/composio/execute` requires `requireSkillToken`
- Disconnect endpoint: `POST /api/internal/composio/disconnect` requires `requireSkillToken`

## Review checklist

- [ ] No credentials in log output or error messages
- [ ] New API endpoints behind `authMiddleware`, `requireInternalToken`, or `requireSkillToken`
- [ ] Encrypted storage for any new secret material
- [ ] Slack signature verification for any new webhook endpoint
- [ ] No `ENCRYPTION_KEY` or tokens in committed code
