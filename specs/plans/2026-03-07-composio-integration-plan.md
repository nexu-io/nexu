# Composio OAuth Integration for Nexu

## Context

Nexu users need to connect external tools (Notion, Google Calendar, Google Drive, etc.) to their AI bots. Composio acts as an OAuth intermediary — managing token exchange, refresh, and storage. This plan adds:
1. A `user_integrations` DB table binding Nexu users to Composio connected accounts
2. API routes for initiating OAuth, checking status, and revoking connections
3. A frontend Integrations page with toolkit cards, connect/disconnect, and status polling
4. Shared integration state that can be updated from either the Integrations page or in-chat auth flows

**Decisions:**
- Use `@composio/core` JS SDK (not CLI)
- Do not force users to pre-authorize all tools during registration
- Support both page-driven and chat-driven authorization against the same backend state
- Support all 17 toolkits from day 1

---

## Step 1: Add `@composio/core` dependency

**Requires explicit approval per CLAUDE.md rules.**

```bash
pnpm --filter @nexu/api add @composio/core
```

---

## Step 2: DB schema — two new tables

**File:** `apps/api/src/db/schema/index.ts` (append after `users` table, ~line 201)

### Three auth types

| Auth scheme | Example | Who provides credentials | UX |
|-------------|---------|--------------------------|-----|
| `oauth2` | Notion, Google, Slack | User authorizes via Composio redirect | Click "Connect" → new tab → OAuth flow |
| `api_key_global` | Weather API, shared tools | Admin configures once, all users share | Auto-connected, badge says "Provided by Nexu" |
| `api_key_user` | Shopify, custom APIs | Each user provides their own key/config | Click "Connect" → inline form → encrypt & save |

### Table A: `supported_toolkits` — the toolkit catalog (admin-managed, hot-reloadable)

```ts
export const supportedToolkits = pgTable("supported_toolkits", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  slug: text("slug").notNull().unique(),          // e.g. "notion", "shopify"
  displayName: text("display_name").notNull(),     // e.g. "Notion", "Shopify"
  description: text("description").notNull(),      // e.g. "Knowledge base & wiki"
  domain: text("domain").notNull(),                // e.g. "notion.so" — for favicon
  category: text("category").default("office"),    // e.g. "office", "dev", "file", "commerce"
  authScheme: text("auth_scheme").notNull().default("oauth2"), // "oauth2" | "api_key_global" | "api_key_user"
  authFields: text("auth_fields"),                 // JSON: fields needed for api_key_user, e.g. [{"key":"shop_url","label":"Shop URL","type":"text"},{"key":"api_key","label":"API Key","type":"secret"}]
  enabled: boolean("enabled").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});
```

**`authFields` JSON format** (only for `api_key_user` toolkits):
```json
[
  { "key": "shop_url", "label": "Shop URL", "type": "text", "placeholder": "my-store.myshopify.com" },
  { "key": "api_key", "label": "API Key", "type": "secret" },
  { "key": "api_secret", "label": "API Secret", "type": "secret" }
]
```
Fields with `"type": "secret"` are encrypted before storage. Fields with `"type": "text"` are stored as-is (non-sensitive config like shop URL).

**Why a table:** Adding a new toolkit = insert a row. No code deploy needed. The API reads from this table, so changes are immediately available (hot-reload). The frontend fetches the list via API, so new toolkits appear instantly.

### Table B: `user_integrations` — per-user connection status

```ts
export const userIntegrations = pgTable(
  "user_integrations",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    userId: text("user_id").notNull(),
    toolkitSlug: text("toolkit_slug").notNull(),
    composioAccountId: text("composio_account_id"), // for oauth2 toolkits
    status: text("status").default("pending"),
    oauthState: text("oauth_state"),               // CSRF token for OAuth callback verification
    connectedAt: text("connected_at"),
    disconnectedAt: text("disconnected_at"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("user_integrations_user_toolkit_idx").on(table.userId, table.toolkitSlug),
    index("user_integrations_user_id_idx").on(table.userId),
  ],
);
```

### Table C: `integration_credentials` — encrypted secrets (isolated from integration data)

Follows the exact pattern of `channel_credentials` (`apps/api/src/db/schema/index.ts:136`).
Uses existing `encrypt()`/`decrypt()` from `apps/api/src/lib/crypto.ts` (AES-256-GCM).

```ts
export const integrationCredentials = pgTable(
  "integration_credentials",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    integrationId: text("integration_id").notNull(), // user_integrations.id (app-level join)
    credentialKey: text("credential_key").notNull(),  // e.g. "api_key", "api_secret", "shop_url"
    encryptedValue: text("encrypted_value").notNull(),// AES-256-GCM via crypto.ts encrypt()
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("int_cred_uniq_idx").on(table.integrationId, table.credentialKey),
  ],
);
```

**Security design:**
- Secrets are **never stored in `user_integrations` or `supported_toolkits`** — always in this isolated table
- Values encrypted with AES-256-GCM via existing `encrypt()` before INSERT
- Decrypted with `decrypt()` only when needed for API calls
- API responses **never return raw credentials** — only masked hints (e.g., `"sk-...4f2a"`)
- For `api_key_global`: admin stores credentials here with a special `integrationId` convention (e.g., `global:{toolkitSlug}`) so they're shared across all users
- DELETE cascade: when user disconnects, credentials for that integration are deleted

### Columns summary

**`supported_toolkits`:**
| Column | Purpose |
|--------|---------|
| `slug` | Composio toolkit slug, unique identifier |
| `displayName` | Human-readable name for UI |
| `domain` | For favicon URL: `google.com/s2/favicons?domain=${domain}&sz=32` |
| `category` | Grouping for filter tabs |
| `authScheme` | `oauth2`, `api_key_global`, or `api_key_user` |
| `authFields` | JSON array of field descriptors (for `api_key_user` only) |
| `enabled` | Soft-disable without deleting |
| `sortOrder` | Control card display order |

**`user_integrations`:**
| Column | Purpose |
|--------|---------|
| `userId` | Nexu `users.id` (app-level join, no FK) |
| `toolkitSlug` | References `supported_toolkits.slug` (app-level join) |
| `composioAccountId` | e.g. `ca_xfl0yG-uOL3h` — for `oauth2` only |
| `oauthState` | Random CSRF token generated at connect time, verified on callback |
| `status` | `pending` → `initiated` → `active` / `failed` / `expired` / `disconnected` |

**`integration_credentials`:**
| Column | Purpose |
|--------|---------|
| `integrationId` | `user_integrations.id` or `global:{slug}` for shared keys |
| `credentialKey` | Field name, e.g. `api_key`, `shop_url` |
| `encryptedValue` | AES-256-GCM encrypted via `crypto.ts` |

### Seed data

After migration, seed `supported_toolkits` with the initial 17+ toolkits:

```sql
-- OAuth2 toolkits (Composio-managed)
INSERT INTO supported_toolkits (id, slug, display_name, description, domain, category, auth_scheme, sort_order) VALUES
  (gen_random_uuid()::text, 'notion',         'Notion',      'Knowledge base & wiki',   'notion.so',              'file',     'oauth2', 1),
  (gen_random_uuid()::text, 'googledrive',    'Drive',       'Cloud file storage',      'drive.google.com',       'file',     'oauth2', 2),
  (gen_random_uuid()::text, 'googlemeet',     'Meet',        'Video conferencing',      'meet.google.com',        'office',   'oauth2', 3),
  (gen_random_uuid()::text, 'googlecalendar', 'Calendar',    'Scheduling & events',     'calendar.google.com',    'office',   'oauth2', 4),
  (gen_random_uuid()::text, 'googlechat',     'Chat',        'Team messaging',          'chat.google.com',        'office',   'oauth2', 5),
  (gen_random_uuid()::text, 'gemini',         'Gemini',      'AI assistant',            'gemini.google.com',      'office',   'oauth2', 6),
  (gen_random_uuid()::text, 'googledocs',     'Docs',        'Document editing',        'docs.google.com',        'office',   'oauth2', 7),
  (gen_random_uuid()::text, 'googlesheets',   'Sheets',      'Spreadsheets',            'sheets.google.com',      'office',   'oauth2', 8),
  (gen_random_uuid()::text, 'googleslides',   'Slides',      'Presentations',           'slides.google.com',      'office',   'oauth2', 9),
  (gen_random_uuid()::text, 'googlevids',     'Vids',        'Video creation',          'vids.google.com',        'office',   'oauth2', 10),
  (gen_random_uuid()::text, 'googlekeep',     'Keep',        'Quick notes',             'keep.google.com',        'office',   'oauth2', 11),
  (gen_random_uuid()::text, 'googlesites',    'Sites',       'Website builder',         'sites.google.com',       'office',   'oauth2', 12),
  (gen_random_uuid()::text, 'googleforms',    'Forms',       'Surveys & forms',         'forms.google.com',       'office',   'oauth2', 13),
  (gen_random_uuid()::text, 'googletasks',    'Tasks',       'Task management',         'tasks.google.com',       'office',   'oauth2', 14),
  (gen_random_uuid()::text, 'notebooklm',     'NotebookLM',  'AI-powered notes',        'notebooklm.google.com',  'office',   'oauth2', 15),
  (gen_random_uuid()::text, 'appsheet',       'AppSheet',    'No-code apps',            'appsheet.com',           'office',   'oauth2', 16),
  (gen_random_uuid()::text, 'slack',          'Slack',       'Team messaging',          'slack.com',              'office',   'oauth2', 17);

-- Example: user-specific API key toolkit
-- INSERT INTO supported_toolkits (id, slug, display_name, description, domain, category, auth_scheme, auth_fields, sort_order) VALUES
--   (gen_random_uuid()::text, 'shopify', 'Shopify', 'E-commerce platform', 'shopify.com', 'commerce', 'api_key_user',
--    '[{"key":"shop_url","label":"Shop URL","type":"text","placeholder":"my-store.myshopify.com"},{"key":"api_key","label":"Admin API Key","type":"secret"}]', 18);

-- Example: global API key toolkit (admin provides key for all users)
-- INSERT INTO supported_toolkits (id, slug, display_name, description, domain, category, auth_scheme, sort_order) VALUES
--   (gen_random_uuid()::text, 'openweather', 'OpenWeather', 'Weather data API', 'openweathermap.org', 'data', 'api_key_global', 19);
-- Then store the global key:
-- INSERT INTO integration_credentials (id, integration_id, credential_key, encrypted_value) VALUES
--   (gen_random_uuid()::text, 'global:openweather', 'api_key', '<encrypt("sk-xxx")>');
```

After edit: `pnpm db:generate` → `pnpm --filter @nexu/api db:push` → run seed SQL

---

## Step 3: Shared Zod schemas

**New file:** `packages/shared/src/schemas/integration.ts`

Schemas:
- `integrationStatusSchema` — enum: `pending | initiated | active | failed | expired | disconnected`
- `authSchemeSchema` — enum: `oauth2 | api_key_global | api_key_user`
- `authFieldSchema` — `{ key, label, type: "text" | "secret", placeholder? }`
- `toolkitInfoSchema` — `{ slug, displayName, description, iconUrl, category, authScheme, authFields? }`
- `integrationResponseSchema` — toolkit info + user-specific `status`, `connectUrl?`, `connectedAt?`, `credentialHints?` (masked, e.g. `{ api_key: "shpa..4f2a" }`)
  - **Security:** `credentialHints` uses `maskCredential()` — never raw values. Only present for `api_key_user` with active credentials.
- `integrationListResponseSchema` — `{ integrations: IntegrationResponse[] }`
- `connectIntegrationSchema` — `{ toolkitSlug, credentials?: Record<string, string>, source?: "page" | "chat", returnTo? }`
  - For `api_key_user`: `credentials` is required and validated against `authFields`. Unknown fields rejected.
  - For `oauth2`: `credentials` must be absent.
- `connectIntegrationResponseSchema` — `{ integration, connectUrl?, state? }` (connectUrl + state only for `oauth2`)
  - **Security:** `state` is the CSRF token to pass back on refresh. Frontend must persist it for the callback.
- `refreshIntegrationSchema` — `{ state }` (required for `oauth2` refresh)
  - **Security:** Server verifies `state` matches `oauthState` in DB. Mismatch → `403`.

**Update:** `packages/shared/src/index.ts` — add export

---

## Step 4: Composio service layer

**New file:** `apps/api/src/lib/composio.ts`

Uses `@composio/core` SDK. Env: `COMPOSIO_API_KEY`.

### Composio SDK API (verified from docs)

```typescript
import { Composio } from "@composio/core";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

// 1. Create a session for a user (maps Nexu userId → Composio entity)
const session = await composio.create(`nexu_${userId}`, {
  manageConnections: false,  // we manage connections ourselves
});

// 2. Initiate OAuth — returns a redirect URL
const connectionRequest = await session.authorize("notion", {
  callbackUrl: "https://app.nexu.space/workspace/integrations?status=callback",
});
console.log(connectionRequest.redirectUrl);
// → "https://connect.composio.dev/link/ln_abc123"

// 3. Check connection status
const toolkits = await session.toolkits();
toolkits.items.forEach((t) => {
  const isActive = t.connection?.connectedAccount?.id;
  console.log(`${t.slug}: ${isActive ?? "not connected"}`);
});

// 4. Wait for connection (blocking — NOT used in API, only for reference)
// await connectionRequest.waitForConnection();
```

### Nexu service wrapper functions

| Function | Purpose |
|----------|---------|
| `getEnabledToolkits()` | Query `supported_toolkits` where `enabled = true`, ordered by `sortOrder` |
| `initializeOAuthConnection(toolkitSlug, nexuUserId, oauthState)` | Create Composio session → `session.authorize(slug, { callbackUrl })` with `state` embedded in callback URL → returns `{ redirectUrl, connectedAccountId? }` |
| `checkOAuthStatus(nexuUserId, toolkitSlug)` | Create session → `session.toolkits()` → find matching slug → return connection status |
| `revokeConnection(composioAccountId)` | Delete connected account via Composio API |
| `getToolkitIcon(domain)` | Returns `https://www.google.com/s2/favicons?domain=${domain}&sz=32` |
| `maskCredential(value)` | Returns masked string (first 4 + last 4 chars). Used in all API responses that reference credentials. |
| `validateCredentialFields(authFields, credentials)` | Validates submitted credentials match the toolkit's `authFields` schema: all required fields present, no unknown fields, non-empty values. Throws `HTTPException(400)` on mismatch. |

**Security rules for this module:**
- `COMPOSIO_API_KEY` read from `process.env` once at init — never passed around, logged, or included in error messages
- All Composio SDK errors are caught and re-thrown as generic `HTTPException` — never expose Composio internals to the client
- `decrypt()` is called only inside provider API call functions — never in list/status functions

### OAuth flow (Nexu ↔ Composio ↔ Provider)

```
┌─────────┐        ┌──────────┐       ┌──────────┐       ┌──────────┐
│ Frontend │        │ Nexu API │       │ Composio │       │ Provider │
│ (React)  │        │ (Hono)   │       │ SDK/API  │       │ (Notion) │
└────┬─────┘        └────┬─────┘       └────┬─────┘       └────┬─────┘
     │ Click "Connect"    │                  │                  │
     │───────────────────>│                  │                  │
     │                    │ session.authorize("notion")         │
     │                    │─────────────────>│                  │
     │                    │  { redirectUrl }  │                  │
     │                    │<─────────────────│                  │
     │  { connectUrl }    │                  │                  │
     │<───────────────────│                  │                  │
     │                    │                  │                  │
     │ window.open(connectUrl) ─────────────>│                  │
     │                    │                  │ OAuth redirect   │
     │                    │                  │─────────────────>│
     │                    │                  │                  │
     │                    │                  │  User authorizes │
     │                    │                  │<─────────────────│
     │                    │                  │ Token stored     │
     │                    │                  │                  │
     │ (callback URL redirects back to Nexu with ?status=success&connected_account_id=ca_xxx)
     │<──────────────────────────────────────│                  │
     │                    │                  │                  │
     │ Poll /refresh      │                  │                  │
     │───────────────────>│ session.toolkits()                  │
     │                    │─────────────────>│                  │
     │                    │  status: ACTIVE   │                  │
     │                    │<─────────────────│                  │
     │  { status: active }│                  │                  │
     │<───────────────────│                  │                  │
```

### Callback URL strategy

Composio appends `?status=success&connected_account_id=ca_xxx` to the callback URL. We support two entry points that both write to the same `user_integrations` row:
```
callbackUrl = `${WEB_URL}/workspace/integrations?toolkit=${slug}&source=page&state=${oauthState}`
callbackUrl = `${WEB_URL}/workspace/integrations?toolkit=${slug}&source=chat&returnTo=${encodedReturnTo}&state=${oauthState}`
```

**CSRF protection via `state` token:**
1. On `POST /api/v1/integrations/connect`, generate a random `state` token (`crypto.randomUUID()`)
2. Store it in `user_integrations.oauthState`
3. Embed it in the callback URL
4. On `POST /api/v1/integrations/{id}/refresh`, verify `state` param matches `oauthState` in DB
5. Clear `oauthState` after successful verification (single-use)
6. Reject refresh if `state` is missing or mismatched → `403 Forbidden`

This prevents session fixation attacks where an attacker tricks a user into connecting the attacker's account.

After the callback:
- Frontend extracts `state` from URL params and passes it to the refresh endpoint
- Nexu verifies state, refreshes the toolkit from Composio, and updates `user_integrations`
- The Integrations page reflects the new connected state on next fetch
- Chat can poll the same integration record and resume the blocked action

### Hot-reload flow (for adding new toolkits)

```
Admin inserts row into supported_toolkits (via DB/SQL)
  → Next API call to GET /api/v1/integrations reads fresh data from DB
  → Frontend receives the new toolkit in the list
  → User can click "Connect" immediately
```

No server restart or code deploy needed.

---

## Step 5: API routes

**New file:** `apps/api/src/routes/integration-routes.ts`

Pattern: `createRoute()` + `app.openapi()` (same as `channel-routes.ts`)

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/integrations` | List all enabled toolkits with user status. Joins `supported_toolkits` with `user_integrations`. Toolkits without a user row → `pending`. For `api_key_global` with stored credentials → auto `active`. |
| `POST` | `/api/v1/integrations/connect` | Body: `{ toolkitSlug, credentials?, source?, returnTo? }`. Shared connect endpoint for page and chat entry points. Generates `oauthState` for CSRF protection. |
| `POST` | `/api/v1/integrations/{integrationId}/refresh` | Body: `{ state }`. (`oauth2` only) Verifies `state` matches `oauthState`, then polls Composio for status. If `ACTIVE` → set `connectedAt` + `active`. |
| `DELETE` | `/api/v1/integrations/{integrationId}` | Disconnect. For `oauth2`: revoke via Composio. For `api_key_user`: delete `integration_credentials` rows. Sets status `disconnected`. Blocked for `api_key_global`. |
| `GET` | `/api/v1/skills` | List skills with `requiredToolkits`, `missingToolkits`, and derived `readiness` based on current integration state. |

### Security constraints on all endpoints

Every route handler MUST enforce these rules:

1. **User scoping:** All DB queries include `eq(userIntegrations.userId, userId)`. Never allow cross-user access.
2. **Ownership verification:** For `{integrationId}` routes, verify the integration belongs to the authenticated user before any mutation.
3. **Credential masking:** `GET /api/v1/integrations` returns `credentialHints` (e.g., `{ api_key: "shpat_...4f2a" }`), never raw values. Masking function: show first 4 + last 4 chars, or just last 4 if value is short.
4. **Global toolkit protection:** `DELETE` returns `403` for `api_key_global` toolkits — users cannot disconnect admin-managed integrations.
5. **OAuth state verification:** `refresh` endpoint rejects requests where `state` param doesn't match stored `oauthState`. State is single-use — cleared after successful verification.
6. **Input validation:** `api_key_user` connect validates all required fields from `authFields` exist and are non-empty. Reject extra/unknown fields.
7. **Rate limiting:** Connect and refresh endpoints should be rate-limited per user (max 10 connect attempts per minute, max 60 refresh polls per minute) to prevent abuse of Composio API quota.

### Connect flow per auth scheme

**`oauth2`:** Same as before — call Composio `initializeConnection()`, return `connectUrl`, and preserve `source` + `returnTo` in the callback URL. The caller can be either the Integrations page or chat.

**`api_key_user`:** Frontend reads `authFields` from toolkit, renders a form. On submit:
```json
POST /api/v1/integrations/connect
{
  "toolkitSlug": "shopify",
  "credentials": {
    "shop_url": "my-store.myshopify.com",
    "api_key": "shpat_xxxxx"
  }
}
```
API validates all required fields from `authFields`, encrypts secret-type fields via `encrypt()`, stores in `integration_credentials`, sets status `active`.

**`api_key_global`:** No user action needed. `GET /api/v1/integrations` checks if `integration_credentials` has a `global:{slug}` row → returns `active` status with badge "Provided by Nexu". User sees it as auto-connected.

**Register in:** `apps/api/src/app.ts` (line ~99, after `registerSessionRoutes`)

```ts
import { registerIntegrationRoutes } from "./routes/integration-routes.js";
// ... after authMiddleware section:
registerIntegrationRoutes(app);
```

---

## Step 6: Shared authorization model for page + chat

### Problem
Composio does not provide a true "authorize all tools at once" flow across unrelated providers. Users should not be forced to connect every tool up front, but they still need:
- a tool management page to inspect and manage app status
- an in-chat auth flow so blocked actions can be unblocked without leaving the chat context conceptually

### Solution
Use one integration state model with two entry points:
- **page-driven auth** from the Integrations page
- **chat-driven auth** when a skill or mission detects missing tool access

Both paths call the same connect endpoint, use the same Composio user identity, and update the same `user_integrations` rows.

### Shared state machine

`user_integrations.status` should be treated as the canonical product-level status:
- `pending`: never started
- `initiated`: auth started, waiting for callback or refresh
- `active`: connected and usable
- `failed`: auth attempt failed
- `expired`: auth window expired or callback did not complete
- `disconnected`: previously connected, now revoked

### Chat-driven auth flow

1. OpenClaw skill planning detects missing required toolkit(s)
2. Chat UI calls `POST /api/v1/integrations/connect` with `source: "chat"` and `returnTo`
3. Nexu returns `connectUrl`
4. User completes Composio/provider auth in popup or new tab
5. Callback lands on `/workspace/integrations?...&source=chat`
6. Nexu refreshes Composio state and updates `user_integrations`
7. Chat polls the same integration record and resumes the blocked action

### Page-driven auth flow

1. User opens `/workspace/integrations`
2. Clicks `Connect`
3. Frontend calls the same `POST /api/v1/integrations/connect` with `source: "page"`
4. Callback lands on `/workspace/integrations?...&source=page`
5. Page refetches integrations and shows updated status

### Lazy gap-fill for existing users

When new toolkits are added to `supported_toolkits`, existing users may not have a `user_integrations` row yet. `GET /api/v1/integrations` should synthesize `pending` status for missing rows. Actual rows are created when auth is first initiated or when credentials are first saved.

---

## Step 7: Generate types

```bash
pnpm generate-types
```

This regenerates `apps/web/lib/api/sdk.gen.ts` with the new integration endpoints.

---

## Step 8: Frontend — Integrations page

**New file:** `apps/web/src/pages/integrations.tsx`

### Layout (inspired by OpenClawSkillsPage.tsx reference)

```
┌──────────────────────────────────────────────────┐
│ ← Back    Integrations (17)                      │
├──────────────────────────────────────────────────┤
│ [Search integrations...]                         │
│                                                  │
│ [All] [Connected ●3] [Available]                 │
│                                                  │
│ ┌─card─────┐  ┌─card─────┐  ┌─card─────┐        │
│ │ [favicon] │  │ [favicon] │  │ [favicon] │       │
│ │ Notion    │  │ Calendar  │  │ Drive     │       │
│ │ KB & wiki │  │ Sched..   │  │ Files..   │       │
│ │ ● Connected│ │ [Connect] │  │ [Connect] │       │
│ └───────────┘  └───────────┘  └───────────┘       │
│                                                  │
│ ┌─card─────┐  ┌─card─────┐  ┌─card─────┐        │
│ │ ...more cards...                               │
│ └───────────┘  └───────────┘  └───────────┘       │
└──────────────────────────────────────────────────┘
```

### Key behaviors

1. **Data fetching:** `useQuery(["integrations"], getApiV1Integrations)`

2. **Connect flow (depends on `authScheme`):**

   **`oauth2`:**
   - Click "Connect" → `POST /api/v1/integrations/connect` with `source: "page"` → get `connectUrl`
   - `window.open(connectUrl, "_blank")` → Composio OAuth page opens
   - Start polling `POST /api/v1/integrations/{id}/refresh` every 3s
   - When status → `active`, stop polling, show green badge, toast success
   - Timeout after 5 min → show "Try again"
   - Also poll on `window.focus` event

   **`api_key_user`:**
   - Click "Connect" → open a dialog/modal with a form
   - Form fields dynamically rendered from `authFields` (read from API response)
   - Fields with `type: "secret"` use `<input type="password" />`
   - On submit → `POST /api/v1/integrations/connect { toolkitSlug, credentials: {...} }`
   - API encrypts & stores → returns `active` status immediately
   - Close dialog, show green badge, toast success

   **`api_key_global`:**
   - No "Connect" button — card shows "Provided by Nexu" badge
   - Auto-connected if admin has stored global credentials

3. **Disconnect flow:** Click "Disconnect" → confirm dialog → `DELETE /api/v1/integrations/{id}`
   - For `api_key_user`: also deletes encrypted credentials server-side
   - For `api_key_global`: cannot disconnect (managed by admin)

4. **Icons:** `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" />`

5. **Status badges:**
   - `active` → green "Connected"
   - `active` + `api_key_global` → green "Provided by Nexu"
   - `initiated` → amber "Pending"
   - `pending` → gray "Not connected"
   - `failed`/`expired` → red badge
   - `disconnected` → gray "Disconnected"

6. **Filter tabs:** All / Connected / Available (same pattern as OpenClawSkillsPage source tabs)
7. **Search:** Client-side filter on displayName + description
8. **Tailwind classes:** Use existing design tokens (`bg-surface-1`, `text-text-primary`, `border-border`, etc.)

### Why this page exists even with chat auth

This page is the canonical tool management surface:
- inspect all tool statuses in one place
- connect/disconnect/reconnect manually
- understand which external systems are currently available to OpenClaw skills

The Skills page should consume this data and show readiness, but it should not become the source of truth for tool auth.

---

## Step 9: Skills readiness integration

**Goal:** The Skills page remains skill management, but it should show whether each skill is runnable based on current tool state.

### Skill metadata requirements

Each skill returned to Nexu should include:
- `requiredToolkits: string[]`
- `optionalToolkits?: string[]`

### Derived fields in API response

For each skill, Nexu computes:
- `missingToolkits`
- `connectedToolkits`
- `readiness`: `ready | partial | missing-auth`

### UX behavior

- Skill card shows `Ready` when all required toolkits are active
- Skill card shows `Needs GitHub`, `Needs Notion + Drive`, etc. when blocked
- CTA:
  - `Use skill` if ready
  - `Connect tools` if missing auth
- `Connect tools` deep-links to `/workspace/integrations` with required toolkit slugs highlighted

### Deep-link pattern

```ts
/workspace/integrations?required=github,linear&returnTo=/workspace/skills/skill-id
```

After successful auth, the Integrations page uses `returnTo` to send the user back to the originating skill detail or execution flow.

---

## Step 10: Runtime auth preflight for chat and skill execution

**Goal:** Nexu must detect missing app auth before a skill runs, return a structured auth-needed result, and resume execution after auth succeeds.

### Why this is needed

Composio can provide the in-chat connect flow, but Nexu still needs to decide:
- which toolkit(s) a skill requires
- whether the current user already has those toolkits connected
- whether execution should proceed or pause for auth

This logic should live in Nexu orchestration, not inside each skill implementation.

### Required skill metadata

Each skill definition surfaced to Nexu should include:

```ts
type SkillAuthRequirements = {
  requiredToolkits: string[];
  optionalToolkits?: string[];
};
```

Examples:

- `sprint-review` → `requiredToolkits: ["linear"]`
- `github-pr-digest` → `requiredToolkits: ["github"]`
- `meeting-assistant` → `requiredToolkits: ["googlecalendar"]`, `optionalToolkits: ["gmail"]`

### Preflight algorithm

Before dispatching a skill or a composed mission to OpenClaw:

1. Resolve the skill(s) to be executed
2. Collect the union of `requiredToolkits`
3. Query integration state for the current user
4. Compute:
   - `connectedToolkits`
   - `missingToolkits`
5. If `missingToolkits.length === 0`, continue execution
6. Otherwise:
   - create connect requests for missing toolkits
   - return a structured `auth_required` response instead of running the skill

### Structured runtime response

Nexu should expose an execution contract like:

```ts
type SkillExecutionResult =
  | {
      status: "ok";
      output: string;
    }
  | {
      status: "auth_required";
      missingToolkits: string[];
      authRequests: Array<{
        toolkitSlug: string;
        displayName: string;
        connectUrl: string;
      }>;
      resumable: true;
    }
  | {
      status: "error";
      message: string;
    };
```

### Chat behavior for `auth_required`

When chat receives `status: "auth_required"`:

1. Render a message such as:
   - `This action needs Linear access. Connect Linear to continue.`
2. Show one or more connect buttons using the returned `connectUrl`
3. Poll or refetch integration state after callback completion
4. Resume the blocked skill or mission automatically when all required toolkits become `active`

### Resume strategy

Nexu should persist enough context to retry after auth:

- original user intent or execution payload
- selected skill(s)
- missing toolkit list
- return target

Minimum viable implementation:

- store pending execution context client-side or in a lightweight server-side record
- after auth completes and integrations refresh successfully, retry the same execution request

### Responsibility split

- **Skill metadata** declares required toolkits
- **Nexu orchestration** performs auth preflight
- **Composio** provides the connect flow and connected account state
- **Chat UI/runtime** renders the auth prompt and triggers retry
- **OpenClaw** executes only after prerequisites are satisfied

### Important rule

Do not rely on the LLM alone to infer the exact auth mechanism at runtime.

The agent may infer that it needs GitHub or Linear semantically, but the concrete execution path must be supplied by Nexu:
- toolkit slug mapping
- auth-required response structure
- callback/resume behavior

---

## Step 11: Add route + sidebar nav

**File:** `apps/web/src/app.tsx`

Add inside the `<WorkspaceLayout>` routes:
```tsx
<Route path="/workspace/integrations" element={<IntegrationsPage />} />
```

**File:** `apps/web/src/layouts/workspace-layout.tsx`

Add sidebar nav item for "Integrations" with a `Puzzle` icon from lucide-react, linking to `/workspace/integrations`.

**File:** `apps/web/src/app.tsx` — update `DocumentTitleSync` map:
```ts
"/workspace/integrations": "Integrations · Nexu",
```

---

## Step 12: Environment configuration

### Local development

Add to `.env` (already gitignored):
```
COMPOSIO_API_KEY=your-composio-api-key
```

Add placeholder to `.env.example`:
```
COMPOSIO_API_KEY=
```

### Production (nexu-apps GitOps)

Secrets are managed via the `nexu-apps` infra repo at `/Users/alche/Documents/digit-sutando/nexu-apps/`.

**Architecture:**
- Prod uses `secret.create: false` + `existingSecretName: nexu-secrets` (Helm does NOT create the Secret)
- Secrets are applied manually via `kubectl create secret generic nexu-secrets --from-env-file=.secrets/prod-nexu.env`
- The API deployment mounts all keys as env vars via `envFrom: secretRef`
- `.secrets/` is gitignored — actual values never enter version control

**Steps to add `COMPOSIO_API_KEY` to prod:**

1. Add to local `.secrets/prod-nexu.env` (not committed):
   ```
   COMPOSIO_API_KEY=<actual-composio-api-key>
   ```

2. Re-apply the K8s secret:
   ```bash
   kubectl -n nexu create secret generic nexu-secrets \
     --from-env-file=.secrets/prod-nexu.env \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

3. Rolling restart to pick up the new env var:
   ```bash
   kubectl -n nexu rollout restart deployment nexu-api
   ```

### Test environment

Add placeholder to `nexu-apps/envs/test/nexu/values.yaml` under `secret:`:
```yaml
secret:
  # ... existing keys ...
  COMPOSIO_API_KEY: ""
```

### Security notes for `COMPOSIO_API_KEY`

- This key is a **master key** for the Composio project — it can create sessions and initiate OAuth for any user entity
- It must ONLY be present in the API pod env — never in gateway or web pods
- The gateway deployment (`gateway-deployment.yaml`) cherry-picks specific secret keys via `secretKeyRef`, so `COMPOSIO_API_KEY` will NOT leak to gateway pods as long as no `secretKeyRef` is added for it
- The `composio.ts` service layer reads it once at init via `process.env.COMPOSIO_API_KEY` — it is never passed around, logged, or included in error messages
- If the key is compromised: rotate in Composio dashboard → update `.secrets/prod-nexu.env` → re-apply → restart

---

## Security Design

### Threat model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| **Cross-user access** | User A guesses User B's `integrationId` and calls refresh/delete | Every route scopes queries by authenticated `userId`. Integration ownership verified before mutation. |
| **OAuth session fixation** | Attacker sends victim a crafted callback URL to link attacker's provider account | `oauthState` CSRF token: generated on connect, embedded in callback URL, verified on refresh, single-use. Mismatch → `403`. |
| **Credential leakage in API responses** | Frontend accidentally renders raw API keys, or keys visible in browser DevTools network tab | API never returns raw credentials. `credentialHints` only (masked: first 4 + last 4 chars). Decryption happens only in server-side service layer when making provider API calls. |
| **Credential leakage in DB** | DB compromise exposes user API keys | AES-256-GCM encryption at rest via `crypto.ts`. Credentials isolated in `integration_credentials` table — separate from integration metadata. `ENCRYPTION_KEY` env var required. |
| **Composio API key theft** | Attacker obtains `COMPOSIO_API_KEY` and creates sessions / initiates OAuth for arbitrary users | Key stored only in env vars. Never in DB, logs, or API responses. Stripped from OpenClaw child process env. Only `composio.ts` service layer touches it. |
| **Provider token theft via Nexu** | Attacker compromises Nexu and reads provider OAuth tokens | Nexu never stores provider tokens. Composio holds them. We only store opaque `composioAccountId` references. DB compromise yields IDs, not tokens. |
| **Model reads integration secrets** | AI model inside OpenClaw reads user API keys via skill secrets API | Integration credentials are NOT stored as skill secrets. They live in `integration_credentials` table, accessible only by the API service layer. The `SKILL_API_TOKEN` → `/api/internal/secrets/` path cannot reach integration credentials. |
| **Model manipulates integration state** | AI model calls integration routes to connect/disconnect toolkits | Integration routes use Clerk `authMiddleware` (`/api/v1/*`), not `SKILL_API_TOKEN`. Model has no Clerk session — it cannot call these endpoints. |
| **Global key abuse** | User disconnects or modifies admin-provided global API key | `DELETE` returns `403` for `api_key_global`. No connect/credentials flow exposed for global toolkits. Admin manages via direct DB access only. |
| **Composio quota exhaustion** | Malicious user spams connect/refresh to burn Composio API quota | Rate limiting: 10 connects/min, 60 refreshes/min per user. OAuth state is single-use — repeated refresh calls with same state are rejected. |
| **Stale OAuth state replay** | Attacker captures old `state` token and replays it later | `oauthState` is cleared after successful verification. Expired/disconnected integrations with leftover state reject refresh. State tokens have no value without an active OAuth flow on Composio's side. |

### Credential lifecycle

```
User submits API key (api_key_user)
  → API validates fields against authFields schema
  → encrypt(value) via crypto.ts (AES-256-GCM)
  → INSERT into integration_credentials
  → API response: { credentialHints: { api_key: "shpat_...4f2a" } }

User disconnects
  → DELETE FROM integration_credentials WHERE integration_id = ?
  → UPDATE user_integrations SET status = 'disconnected'
  → Encrypted values are permanently deleted, not soft-deleted

Service layer needs to call provider API
  → SELECT encrypted_value FROM integration_credentials WHERE integration_id = ? AND credential_key = ?
  → decrypt(encryptedValue) in memory only
  → Use plaintext value for API call
  → Never log, cache, or persist the decrypted value
```

### Masking function

```ts
function maskCredential(value: string): string {
  if (value.length <= 8) return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  return `${value.slice(0, 4)}..${value.slice(-4)}`;
}
// "shpat_abcdef1234" → "shpa..1234"
// "sk-abc" → "**abc"
```

### Implementation checklist

Every route handler must satisfy these before merging:

- [ ] All DB queries include `userId` filter — no unscoped reads or writes
- [ ] `integrationId` ownership verified before mutation (query returns null → `404`)
- [ ] `oauthState` generated on connect, verified on refresh, cleared after use
- [ ] `GET /integrations` returns `credentialHints`, never raw `encryptedValue` or decrypted value
- [ ] `DELETE` blocked for `api_key_global` toolkits → `403`
- [ ] `api_key_user` connect validates all required `authFields`, rejects unknown fields
- [ ] Secret-type fields encrypted before storage, non-secret fields stored as-is
- [ ] `COMPOSIO_API_KEY` never appears in logs, responses, or error messages
- [ ] Rate limiting applied to connect and refresh endpoints
- [ ] No `integration_credentials` data joins into list/status responses (separate query only when needed)

---

## Files Summary

| Action | File |
|--------|------|
| **Edit** | `apps/api/src/db/schema/index.ts` — add `supportedToolkits` + `userIntegrations` + `integrationCredentials` tables |
| **New** | `packages/shared/src/schemas/integration.ts` — Zod schemas |
| **Edit** | `packages/shared/src/index.ts` — add export |
| **New** | `apps/api/src/lib/composio.ts` — SDK wrapper |
| **New** | `apps/api/src/routes/integration-routes.ts` — integration auth/status endpoints |
| **Edit** | `apps/api/src/app.ts` — register routes |
| **New** | `apps/web/src/pages/integrations.tsx` — UI page |
| **Edit** | `apps/web/src/app.tsx` — add route + title |
| **Edit** | `apps/web/src/layouts/workspace-layout.tsx` — sidebar nav |
| **Edit** | `apps/web/src/pages/openclaw-skills*.tsx` or equivalent skills page — show readiness + deep-link to tools |

---

## Reused existing code

| What | File path |
|------|-----------|
| `encrypt()` / `decrypt()` (AES-256-GCM) | `apps/api/src/lib/crypto.ts` |
| `channel_credentials` table pattern | `apps/api/src/db/schema/index.ts:136` |
| Slack OAuth route pattern | `apps/api/src/routes/channel-routes.ts` |
| `createRoute()` + `app.openapi()` pattern | All route files in `apps/api/src/routes/` |
| Design tokens (Tailwind) | `apps/web/src/index.css` |
| OpenClawSkillsPage UI reference | `agent-digital-cowork/design-system/src/pages/openclaw/OpenClawSkillsPage.tsx` |

---

## Verification

### Build verification

1. **DB:** `pnpm db:generate` succeeds, migration SQL creates `supported_toolkits` + `user_integrations` + `integration_credentials` with correct columns + indexes. `pnpm --filter @nexu/api db:push` applies cleanly. Seed SQL inserts 17 toolkits.
2. **Types:** `pnpm generate-types && pnpm typecheck` — zero errors
3. **Lint:** `pnpm lint` — passes

---

### Unit tests

**New file:** `apps/api/src/routes/__tests__/integration-routes.test.ts`

Follows existing test patterns (see `artifact-routes.test.ts`, `skill-routes.test.ts`):
- `vi.mock("../../db/index.js")` — redirect DB to `nexu_test` via `TEST_DATABASE_URL`
- `createTables()` — raw SQL to create `supported_toolkits`, `user_integrations`, `integration_credentials`, `users`
- `truncateAll()` — clean between tests
- `buildApp()` — `OpenAPIHono` + register routes + inject test auth middleware that sets `c.set("userId", ...)`
- Composio SDK mocked via `vi.mock("../../lib/composio.js")` — never calls real Composio in unit tests

#### Test auth middleware mock

Since integration routes use `authMiddleware` (Clerk/BetterAuth), tests inject a lightweight middleware that sets `userId` from a custom header:

```ts
function buildApp(defaultUserId = "user-1") {
  const app = new OpenAPIHono();
  // Mock auth: read userId from x-test-user-id header, fallback to default
  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user-id") ?? defaultUserId);
    await next();
  });
  registerIntegrationRoutes(app);
  return app;
}
```

#### Composio SDK mock

```ts
vi.mock("../../lib/composio.js", () => ({
  initializeOAuthConnection: vi.fn().mockResolvedValue({
    redirectUrl: "https://connect.composio.dev/link/ln_mock123",
    connectedAccountId: "ca_mock123",
  }),
  checkOAuthStatus: vi.fn().mockResolvedValue({
    status: "ACTIVE",
    connectedAccountId: "ca_mock123",
  }),
  revokeConnection: vi.fn().mockResolvedValue(undefined),
}));
```

#### Test suite: `GET /api/v1/integrations`

| # | Test case | Setup | Expected |
|---|-----------|-------|----------|
| 1 | Returns all enabled toolkits with `pending` status for new user | Seed 3 toolkits, no `user_integrations` rows | 200, 3 items, all `status: "pending"` |
| 2 | Returns `active` for connected toolkit | Seed toolkit + `user_integrations` row with `status: "active"` | 200, matching toolkit has `status: "active"`, `connectedAt` present |
| 3 | Excludes disabled toolkits | Seed 1 enabled + 1 disabled toolkit | 200, only 1 item returned |
| 4 | Returns `active` for `api_key_global` with stored credentials | Seed `api_key_global` toolkit + `integration_credentials` with `integrationId: "global:{slug}"` | 200, toolkit shows `status: "active"`, badge logic present |
| 5 | Returns `credentialHints` for `api_key_user` active integrations | Seed `api_key_user` toolkit + active integration + encrypted credentials | 200, `credentialHints: { api_key: "shpa..1234" }`, no raw values |
| 6 | Never returns raw `encryptedValue` in response | Seed active integration with credentials | 200, response body does NOT contain the encrypted string |
| 7 | User A cannot see User B's integration status | Seed integrations for user-1 and user-2, request as user-1 | 200, only user-1's statuses returned |

#### Test suite: `POST /api/v1/integrations/connect`

| # | Test case | Input | Expected |
|---|-----------|-------|----------|
| 1 | OAuth2 connect returns `connectUrl` and `state` | `{ toolkitSlug: "notion" }` | 200, `connectUrl` present, `state` present, `user_integrations` row created with `status: "initiated"`, `oauthState` stored |
| 2 | OAuth2 connect updates existing `pending` row | Existing `pending` row for same user+toolkit | 200, same `integrationId`, status → `initiated`, `oauthState` updated |
| 3 | `api_key_user` connect with valid credentials | `{ toolkitSlug: "shopify", credentials: { shop_url: "my.shopify.com", api_key: "shpat_xxx" } }` | 200, status → `active`, credentials encrypted in `integration_credentials`, response has `credentialHints` |
| 4 | `api_key_user` connect rejects missing required fields | `{ toolkitSlug: "shopify", credentials: { shop_url: "my.shopify.com" } }` (missing `api_key`) | 400, error message includes missing field name |
| 5 | `api_key_user` connect rejects unknown fields | `{ toolkitSlug: "shopify", credentials: { shop_url: "...", api_key: "...", extra: "bad" } }` | 400, error message about unknown field |
| 6 | `api_key_user` connect rejects empty values | `{ toolkitSlug: "shopify", credentials: { shop_url: "", api_key: "shpat_xxx" } }` | 400 |
| 7 | Cannot connect `api_key_global` toolkit | `{ toolkitSlug: "openweather" }` | 400 or 403, global toolkits are admin-managed |
| 8 | Invalid `toolkitSlug` returns 404 | `{ toolkitSlug: "nonexistent" }` | 404 |
| 9 | OAuth2 connect with `source: "chat"` and `returnTo` | `{ toolkitSlug: "notion", source: "chat", returnTo: "/workspace/sessions/abc" }` | 200, `connectUrl` includes `source=chat` and `returnTo` in callback |

#### Test suite: `POST /api/v1/integrations/{integrationId}/refresh`

| # | Test case | Setup | Expected |
|---|-----------|-------|----------|
| 1 | Valid state + Composio ACTIVE → status becomes `active` | Integration with `status: "initiated"`, matching `oauthState` | 200, `status: "active"`, `connectedAt` set, `oauthState` cleared to null |
| 2 | Mismatched `state` → 403 | Integration with `oauthState: "abc"`, request with `state: "xyz"` | 403 |
| 3 | Missing `state` → 403 | Integration with `oauthState` set, request without `state` | 403 |
| 4 | State already cleared (replay) → 403 | Integration with `oauthState: null` (already used) | 403 |
| 5 | Cross-user refresh → 404 | Integration belongs to user-1, request as user-2 | 404 |
| 6 | Non-existent integrationId → 404 | No matching row | 404 |
| 7 | Composio returns non-ACTIVE → status stays `initiated` | Mock `checkOAuthStatus` returns `PENDING` | 200, `status: "initiated"`, `oauthState` NOT cleared |
| 8 | Refresh on `api_key_user` integration → 400 | Integration with `api_key_user` toolkit | 400, refresh only applies to `oauth2` |

#### Test suite: `DELETE /api/v1/integrations/{integrationId}`

| # | Test case | Setup | Expected |
|---|-----------|-------|----------|
| 1 | Disconnect OAuth2 integration | Active `oauth2` integration | 200, `status: "disconnected"`, `revokeConnection` called with `composioAccountId`, `disconnectedAt` set |
| 2 | Disconnect `api_key_user` integration | Active integration + 2 credential rows | 200, `status: "disconnected"`, all `integration_credentials` rows deleted |
| 3 | Cannot disconnect `api_key_global` → 403 | Global toolkit integration | 403 |
| 4 | Cross-user delete → 404 | Integration belongs to user-1, request as user-2 | 404 |
| 5 | Non-existent integrationId → 404 | No matching row | 404 |
| 6 | Already disconnected → idempotent 200 | Integration with `status: "disconnected"` | 200 |

#### Test suite: `maskCredential()` (unit, pure function)

**File:** `apps/api/src/lib/__tests__/composio.test.ts`

| # | Input | Expected |
|---|-------|----------|
| 1 | `"shpat_abcdef1234"` | `"shpa..1234"` |
| 2 | `"sk-abc"` | `"**abc"` |
| 3 | `"12345678"` | `"1234..5678"` |
| 4 | `"abcd"` | `"abcd"` (too short to mask meaningfully) |
| 5 | `""` | `""` |

#### Test suite: `validateCredentialFields()` (unit, pure function)

| # | authFields | credentials | Expected |
|---|------------|-------------|----------|
| 1 | `[{key:"api_key",type:"secret"},{key:"shop_url",type:"text"}]` | `{api_key:"x",shop_url:"y"}` | passes |
| 2 | Same | `{api_key:"x"}` | throws 400, missing `shop_url` |
| 3 | Same | `{api_key:"x",shop_url:"y",extra:"z"}` | throws 400, unknown field `extra` |
| 4 | Same | `{api_key:"",shop_url:"y"}` | throws 400, empty value |
| 5 | `[]` | `{}` | passes (no fields required) |

---

### E2E tests

**New file:** `apps/api/src/routes/__tests__/integration-routes.e2e.test.ts`

E2E tests run against a real test database and a real (or mocked) Composio SDK. They verify the full request lifecycle including encryption, DB state, and response shapes.

#### Prerequisites

- `nexu_test` database running on `localhost:5433`
- `ENCRYPTION_KEY` env var set (test uses the standard test key `0123456789...`)
- Composio SDK: two strategies
  - **Default (CI):** Mock Composio SDK — tests run without network
  - **Optional (manual):** Set `COMPOSIO_API_KEY` env var to run against real Composio (for pre-release validation)

#### E2E test suite: Full OAuth2 flow

```ts
describe("E2E: OAuth2 integration flow", () => {
  it("connect → refresh → list → disconnect lifecycle", async () => {
    // 1. GET /integrations — toolkit exists, status pending
    // 2. POST /integrations/connect — returns connectUrl + state
    //    Verify: user_integrations row created, status=initiated, oauthState stored
    // 3. POST /integrations/{id}/refresh with correct state
    //    Mock: checkOAuthStatus returns ACTIVE
    //    Verify: status=active, connectedAt set, oauthState cleared
    // 4. GET /integrations — toolkit now shows active
    // 5. DELETE /integrations/{id}
    //    Verify: status=disconnected, revokeConnection called
    // 6. GET /integrations — toolkit shows disconnected
  });
});
```

#### E2E test suite: API key user flow with encryption

```ts
describe("E2E: api_key_user integration flow", () => {
  it("connect with credentials → verify encryption → list with hints → disconnect deletes credentials", async () => {
    // 1. Seed api_key_user toolkit with authFields
    // 2. POST /integrations/connect with credentials
    //    Verify in DB: integration_credentials rows exist, encryptedValue !== plaintext
    //    Verify: decrypt(encryptedValue) === original plaintext
    // 3. GET /integrations
    //    Verify: credentialHints present, masked format correct
    //    Verify: response body does NOT contain plaintext or encryptedValue
    // 4. DELETE /integrations/{id}
    //    Verify: integration_credentials rows deleted from DB
    //    Verify: user_integrations status = disconnected
  });
});
```

#### E2E test suite: Security enforcement

```ts
describe("E2E: Security enforcement", () => {
  it("user-2 cannot refresh user-1's integration", async () => {
    // 1. Create integration for user-1
    // 2. Request refresh as user-2 → 404
    // 3. Verify: integration state unchanged in DB
  });

  it("user-2 cannot delete user-1's integration", async () => {
    // 1. Create active integration for user-1
    // 2. Request delete as user-2 → 404
    // 3. Verify: integration still active in DB
  });

  it("refresh with wrong state token returns 403", async () => {
    // 1. Connect toolkit (generates oauthState)
    // 2. Refresh with wrong state → 403
    // 3. Verify: oauthState NOT cleared, status still initiated
  });

  it("refresh with already-used state returns 403", async () => {
    // 1. Connect → refresh with correct state (succeeds)
    // 2. Refresh again with same state → 403 (oauthState was cleared)
  });

  it("cannot disconnect api_key_global toolkit", async () => {
    // 1. Seed api_key_global toolkit with global credentials
    // 2. DELETE → 403
    // 3. Verify: credentials still in DB
  });

  it("credentials never appear in GET response", async () => {
    // 1. Connect api_key_user toolkit with credentials
    // 2. GET /integrations
    // 3. JSON.stringify(response) must NOT contain plaintext credential values
    // 4. JSON.stringify(response) must NOT contain "encryptedValue" key
  });
});
```

#### E2E test suite: Global toolkit auto-activation

```ts
describe("E2E: api_key_global toolkit", () => {
  it("shows active when global credentials exist", async () => {
    // 1. Seed api_key_global toolkit
    // 2. Insert global credentials: integrationId = "global:{slug}"
    // 3. GET /integrations as any user
    // 4. Verify: toolkit shows status active
  });

  it("shows pending when no global credentials exist", async () => {
    // 1. Seed api_key_global toolkit, no credentials
    // 2. GET /integrations
    // 3. Verify: toolkit shows status pending
  });
});
```

#### E2E test suite: Edge cases

```ts
describe("E2E: Edge cases", () => {
  it("re-connect after disconnect creates new integration flow", async () => {
    // 1. Connect OAuth2 → refresh → active
    // 2. Disconnect
    // 3. Connect again → new oauthState, status initiated
    // 4. Verify: old composioAccountId cleared, new flow started
  });

  it("connect same toolkit twice returns same integration", async () => {
    // 1. POST /connect for notion (creates integration, status initiated)
    // 2. POST /connect for notion again
    // 3. Verify: same integrationId returned, oauthState regenerated
  });

  it("list synthesizes pending for toolkits without user rows", async () => {
    // 1. Seed 3 toolkits, create user_integrations for only 1
    // 2. GET /integrations
    // 3. Verify: 3 items returned, 1 active + 2 pending
    // 4. Verify: pending items have no integrationId (synthesized)
  });

  it("disabled toolkit not returned even if user has integration row", async () => {
    // 1. Seed toolkit with enabled=false, create active integration
    // 2. GET /integrations
    // 3. Verify: toolkit not in response
  });
});
```

---

### Test file summary

| File | Type | Tests | Key coverage |
|------|------|-------|-------------|
| `apps/api/src/routes/__tests__/integration-routes.test.ts` | Unit | ~30 | All endpoints, auth scoping, input validation, credential masking, CSRF state |
| `apps/api/src/lib/__tests__/composio.test.ts` | Unit | ~10 | `maskCredential()`, `validateCredentialFields()` pure functions |
| `apps/api/src/routes/__tests__/integration-routes.e2e.test.ts` | E2E | ~15 | Full lifecycles (OAuth2, API key, global), encryption round-trip, security enforcement, edge cases |

### Running tests

```bash
# All unit + e2e tests
pnpm --filter @nexu/api test

# Only integration route tests
pnpm --filter @nexu/api test -- integration-routes

# Only composio utility tests
pnpm --filter @nexu/api test -- composio
```

### Manual smoke test (post-deploy)

1. Navigate to `/workspace/integrations` — 17 toolkit cards render with favicons
2. Click "Connect" on Notion → Composio OAuth tab opens → complete OAuth → status updates to active
3. Click "Disconnect" on Notion → confirm → status changes to disconnected
4. Search and filter tabs work (All / Connected / Available)
5. For `api_key_user` toolkit: click Connect → form dialog appears → submit credentials → active immediately
6. Skills page shows readiness badges based on current integration state
7. Deep-link from skills page to integrations page highlights required toolkits
