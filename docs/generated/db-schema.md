# DB Schema (Generated)

Generated from `apps/api/src/db/schema/index.ts`. Regenerate after schema changes.

All tables use `pk` (serial auto-increment) as internal primary key and `id` (text, cuid2) as public identifier. No foreign key constraints — application-level joins only.

## Tables

### bots

Bot configuration for each user's AI agent.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| user_id | text | Owner user ID |
| name | text | Display name |
| slug | text | URL-safe identifier, unique per (user_id, slug) |
| system_prompt | text | Agent persona/instructions |
| model_id | text | Default: `anthropic/claude-sonnet-4-6` |
| agent_config | text | JSON string, agent-level config |
| tools_config | text | JSON string, tools config |
| status | text | `active` / `paused` / `deleted` |
| pool_id | text | Assigned gateway pool |
| created_at | text | ISO timestamp |
| updated_at | text | ISO timestamp |

### bot_channels

Connections between bots and messaging platforms.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| bot_id | text | References bots.id |
| channel_type | text | `slack` |
| account_id | text | Platform-specific ID (e.g. Slack team_id) |
| status | text | `pending` / `connected` / `disconnected` / `error` |
| channel_config | text | JSON string |
| created_at | text | ISO timestamp |
| updated_at | text | ISO timestamp |

Unique: `(bot_id, channel_type, account_id)`

### channel_credentials

Encrypted credentials for channel connections.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| bot_channel_id | text | References bot_channels.id |
| credential_type | text | `botToken` / `signingSecret` |
| encrypted_value | text | AES-256-GCM encrypted |
| created_at | text | ISO timestamp |

Unique: `(bot_channel_id, credential_type)`

### gateway_pools

OpenClaw Gateway process groups.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| pool_name | text | Unique pool identifier |
| pool_type | text | `shared` |
| max_bots | integer | Capacity limit (default: 50) |
| current_bots | integer | Current assigned count |
| status | text | `pending` / `active` |
| config_version | integer | Incremented on changes |
| pod_ip | text | Running pod IP address |
| last_heartbeat | text | ISO timestamp |
| created_at | text | ISO timestamp |

### gateway_assignments

Maps each bot to a gateway pool (one bot = one pool assignment).

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| bot_id | text | Unique — one pool per bot |
| pool_id | text | References gateway_pools.id |
| assigned_at | text | ISO timestamp |

### users

User accounts (linked to better-auth).

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| auth_user_id | text | better-auth user ID, unique |
| plan | text | `free` |
| created_at | text | ISO timestamp |
| updated_at | text | ISO timestamp |

### usage_metrics

Per-bot usage tracking.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| bot_id | text | References bots.id |
| period_start | text | ISO timestamp |
| period_end | text | ISO timestamp |
| message_count | integer | Messages in period |
| token_count | integer | Tokens consumed |
| created_at | text | ISO timestamp |

### webhook_routes

Routes incoming webhooks to the correct gateway pool and bot.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| channel_type | text | `slack` |
| external_id | text | Platform ID (Slack team_id) |
| pool_id | text | References gateway_pools.id |
| bot_channel_id | text | References bot_channels.id |
| created_at | text | ISO timestamp |

Unique: `(channel_type, external_id)`

### oauth_states

Temporary OAuth flow state for CSRF prevention.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| state | text | Random state token, unique |
| bot_id | text | References bots.id |
| user_id | text | References users.id |
| expires_at | text | ISO timestamp |
| used_at | text | Set after consumption (single-use) |
| created_at | text | ISO timestamp |

### invite_codes

Registration invite codes.

| Column | Type | Notes |
|--------|------|-------|
| pk | serial | Internal PK |
| id | text | Public ID (cuid2), unique |
| code | text | Unique invite code |
| max_uses | integer | Default: 100 |
| used_count | integer | Current usage count |
| created_by | text | Creator user ID |
| expires_at | text | Optional expiry |
| created_at | text | ISO timestamp |
