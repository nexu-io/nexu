# Feishu Bot Setup Guide

## Architecture Overview

Nexu supports two types of Feishu bot connections:

### 1. Manual Bot (User-configured, WebSocket mode)

Users create their own Feishu app on [open.feishu.cn](https://open.feishu.cn/app) and connect it via the Nexu dashboard (Channels page). OpenClaw connects directly to Feishu via long-polling WebSocket — no public webhook URL needed.

**Data flow:**
```
Feishu Cloud → WebSocket → OpenClaw (port 18789) → Agent
```

### 2. Official Bot (Pre-configured, Webhook mode)

The "official" Nexu Feishu bot (`cli_a90a8a7286781bcc`) uses HTTP webhook mode. Feishu pushes events to a public URL, which routes through the Nexu API for claim checking before forwarding to OpenClaw.

**Data flow:**
```
Feishu Cloud → HTTPS webhook → Nexu API (/api/feishu/events)
  → Claim check (registered? → forward; unregistered? → send claim card)
  → Forward to OpenClaw (http://podIp:18789/feishu/events/{accountId})
  → Agent
```

### Key Differences

| | Manual Bot | Official Bot |
|---|---|---|
| Connection | WebSocket (outbound) | Webhook (inbound HTTP) |
| Public URL needed | No | Yes (via tunnel or load balancer) |
| Claim flow | N/A (owner is the user) | Yes (unregistered users get claim card) |
| Config source | Dashboard UI | Seed script / env vars |
| `connectionMode` in DB | `websocket` | `webhook` |

## User Claim Flow

When an unregistered user messages the official bot:

1. Feishu sends event to `POST /api/feishu/events`
2. API extracts `sender.open_id` and checks `workspace_memberships` table
3. If not registered:
   - Generates a claim token (stored in `claim_tokens` table)
   - Sends a Feishu interactive card with "Set Up My Account" button via Bot API
   - The card links to `{NEXU_APP_URL}/claim?token={token}`
   - Message is **not** forwarded to the agent (blocked)
4. User clicks button → signs in / creates account → claim completes
5. `workspace_memberships` row created: `workspace_key = feishu:{appId}`, `im_user_id = {open_id}`
6. Subsequent messages pass claim check and forward to agent normally

### Deduplication

Claim card sending is deduplicated at DB level using `claim_card_dedup` table with Feishu `event_id` as primary key. This prevents the same event from triggering duplicate cards across multiple API pods.

Each **different** message from an unregistered user will still send a new claim card (by design).

## Local Development Setup

### Prerequisites

- Docker running (for PostgreSQL)
- `openclaw` binary installed (see main README)
- Cloudflared tunnel (for webhook mode testing)

### Environment Variables

Add to `apps/api/.env`:

```env
# Official Feishu bot credentials
FEISHU_APP_ID=cli_a90a8a7286781bcc
FEISHU_APP_SECRET=<ask team for secret>
FEISHU_VERIFICATION_TOKEN=<ask team for token>
```

### Seed the Database

The seed script auto-creates the official bot's DB records (bot_channels, channel_credentials, webhook_routes):

```bash
pnpm seed
```

This reads `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_VERIFICATION_TOKEN` from env and creates:
- `bot_channels` row with `connection_mode = 'webhook'`
- `channel_credentials` rows (appId, appSecret, verificationToken — encrypted)
- `webhook_routes` row mapping `external_id = {appId}` to `pool_local_01`

### Cloudflared Tunnel

Feishu webhook needs a public HTTPS URL. Set up a Cloudflare tunnel:

```bash
# One-time setup
cloudflared tunnel create nexu-local
cloudflared tunnel route dns --overwrite-dns nexu-local <your-subdomain>.nexu.space
```

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: <tunnel-id>
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: <your-subdomain>.nexu.space
    service: http://127.0.0.1:3000
  - service: http_status:404
```

**Important:** Use `127.0.0.1` not `localhost` — cloudflared may resolve `localhost` to IPv6 `[::1]` which the API doesn't listen on.

Configure the webhook URL in Feishu Developer Console:
- Events URL: `https://<your-subdomain>.nexu.space/api/feishu/events`

### Start Services

```bash
# Terminal 1: API + Web
pnpm dev

# Terminal 2: Gateway (OpenClaw)
pnpm dev:sidecar

# Terminal 3: Tunnel
cloudflared tunnel run nexu-local
```

### Testing the Claim Flow

1. Remove your existing membership (if any):
   ```sql
   DELETE FROM workspace_memberships
   WHERE workspace_key = 'feishu:cli_a90a8a7286781bcc'
   AND im_user_id = '<your_feishu_open_id>';
   ```

2. Send a message to the official bot in Feishu

3. You should receive a claim card — click "Set Up My Account"

4. Sign in / create account on the Nexu web app

5. Send another message — bot should now reply normally

### Disconnecting a Feishu Account (for testing)

To reset the claim flow for a specific user:

```sql
-- Find and delete the membership
DELETE FROM workspace_memberships
WHERE workspace_key LIKE 'feishu:%'
AND user_id = (SELECT id FROM "user" WHERE email = 'your@email.com');

-- Optional: also clear claim card dedup to allow re-sending
DELETE FROM claim_card_dedup WHERE event_id LIKE '%';
```

## Config Generator

`apps/api/src/lib/config-generator.ts` builds OpenClaw config from DB. For Feishu:

- Each `bot_channels` row with `channel_type = 'feishu'` becomes an account in `config.channels.feishu.accounts`
- `connectionMode` is set **per-account** (not at top level) — this is critical
- Webhook mode accounts get `webhookPort: 18789` so the Feishu plugin binds to the gateway's HTTP server
- The `feishu` plugin is explicitly enabled in `config.plugins`

## Troubleshooting

### Bot not replying (webhook mode)

1. Check tunnel: `curl -s https://<subdomain>.nexu.space/api/feishu/events -X POST -H "Content-Type: application/json" -d '{"type":"url_verification","challenge":"test"}'` — should return `{"challenge":"test"}`

2. Check API logs for `feishu_events_incoming` — if missing, events aren't reaching API

3. Check OpenClaw webhook: `curl -s http://127.0.0.1:18789/feishu/events/<accountId> -X POST -H "Content-Type: application/json" -d '{"type":"url_verification","challenge":"test"}'`

4. Check `connection_mode` in `bot_channels` — must be `webhook` for the official bot

### Bot not replying (websocket mode)

Check gateway logs for `ws client ready` — if missing, WebSocket connection failed. Verify appId/appSecret are correct.

### Claim card not sent

Check API logs for `feishu_claim_card_sent` or `feishu_events_unclaimed_user_intercepted`. If intercepted but no card sent, check channel_credentials for valid appId/appSecret.
