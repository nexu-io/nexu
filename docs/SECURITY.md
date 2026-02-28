# Security

## Credential handling

- All channel credentials (bot tokens, signing secrets) encrypted at rest with AES-256-GCM
- Encryption key: 32-byte hex from `ENCRYPTION_KEY` env var
- Implementation: `apps/api/src/lib/crypto.ts`
- Credentials decrypted only when needed (config generation, signature verification)
- **Credentials must never appear in logs, error messages, or API responses**

## Slack signature verification

- All incoming Slack events verified via HMAC-SHA256
- Signing secret retrieved from encrypted `channel_credentials`
- 5-minute timestamp window enforced
- Timing-safe comparison (`crypto.timingSafeEqual`)
- Implementation: `apps/api/src/routes/slack-events.ts`

## Authentication

- better-auth with email/password registration
- HTTP-only session cookies
- `authMiddleware` validates session for all `/v1/*` routes
- Internal endpoints (`/api/internal/*`) require `GATEWAY_TOKEN` header
- Configured in `apps/api/src/auth.ts`

## Secret management

- Production: AWS Secrets Manager → External Secrets Operator → K8s Secrets
- Local dev: `.env` file (never committed)
- Required: `DATABASE_URL`, `ENCRYPTION_KEY`, `GATEWAY_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `BETTER_AUTH_SECRET`
- Optional: `LITELLM_BASE_URL`, `LITELLM_API_KEY`

## OAuth state

- Slack OAuth state tokens stored in `oauth_states` table with expiry
- State verified on callback to prevent CSRF
- Tokens marked as used after consumption (single-use)

## Review checklist

- [ ] No credentials in log output or error messages
- [ ] New API endpoints behind `authMiddleware` or `GATEWAY_TOKEN`
- [ ] Encrypted storage for any new secret material
- [ ] Slack signature verification for any new webhook endpoint
- [ ] No `ENCRYPTION_KEY` or tokens in committed code
