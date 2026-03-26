# OpenAI Codex OAuth — Test Verification Plan

**Date:** 2026-03-24
**Branch:** `feat/openai-codex-oauth`
**Worktree:** `.worktrees/openai-oauth`

---

## 1. Unit Tests (Vitest)

### 1.1 PKCE Generation (`openclaw-auth-service.test.ts`)

| # | Test | Expected |
|---|------|----------|
| 1 | `generateCodeVerifier()` returns base64url string | 43 chars (32 bytes → base64url) |
| 2 | `generateCodeChallenge(verifier)` returns SHA-256 base64url | Deterministic: same input → same output |
| 3 | `generateState()` returns hex string | 32 chars (16 bytes → hex) |
| 4 | Two calls produce different verifiers | No collision |

### 1.2 Flow Lifecycle

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 5 | `startOAuthFlow("openai")` returns `{ browserUrl }` | Mock nothing (real server) | URL contains `auth.openai.com`, client_id, code_challenge, state |
| 6 | `startOAuthFlow("anthropic")` returns `{ error }` | — | Error: "OAuth not supported" |
| 7 | `getFlowStatus()` returns `"idle"` initially | Fresh service | `{ status: "idle" }` |
| 8 | `getFlowStatus()` returns `"pending"` after start | After `startOAuthFlow` | `{ status: "pending" }` |
| 9 | Flow aborts previous when starting new | Start twice | First server shut down, second active |
| 10 | `dispose()` cleans up server + timeout | After start → dispose | No lingering listeners |

### 1.3 OAuth Callback Handler

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 11 | Valid callback → `"completed"` | Mock `fetch` for token + models endpoints | Status `"completed"`, profile + models populated |
| 12 | State mismatch → `"failed"` | Send callback with wrong state | Status `"failed"`, error about CSRF |
| 13 | Missing `code` param → `"failed"` | Callback URL without code | Status `"failed"` |
| 14 | `error` param present → `"failed"` | Callback with `?error=access_denied` | Status `"failed"`, error forwarded |
| 15 | Non-`/auth/callback` path → 404 | Request to `/other` | 404 response |

### 1.4 Token Exchange

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 16 | Successful exchange extracts tokens | Mock `fetch` → 200 with tokens | `access_token` + `refresh_token` + `expires_in` |
| 17 | HTTP error from OpenAI → error | Mock `fetch` → 401 | Throws with "Token exchange failed: HTTP 401" |
| 18 | Missing `access_token` in response → error | Mock → 200 but no `access_token` | Throws |
| 19 | Request body includes correct PKCE fields | Spy on `fetch` | Body has `grant_type`, `code`, `redirect_uri`, `client_id`, `code_verifier` |

### 1.5 JWT Parsing (`parseAccountIdFromJwt`)

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 20 | Valid JWT with account ID | Real JWT structure | Returns `chatgpt_account_id` |
| 21 | Invalid JWT (no dots) | `"notajwt"` | Returns `undefined` |
| 22 | Missing `https://api.openai.com/auth` claim | Valid JWT without claim | Returns `undefined` |
| 23 | Missing `chatgpt_account_id` | Auth claim without field | Returns `undefined` |

### 1.6 Models Fetch

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 24 | Success → model IDs extracted | Mock → `{ data: [{ id: "gpt-5" }] }` | `["gpt-5"]` |
| 25 | HTTP error → empty array | Mock → 500 | `[]` |
| 26 | Malformed response → empty array | Mock → `{ broken: true }` | `[]` |
| 27 | Network timeout → empty array | Mock → abort | `[]` |

### 1.7 Auth Profiles I/O

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 28 | `readAuthProfiles()` with no agent dir | Empty `agents/` directory | Returns `null` |
| 29 | `readAuthProfiles()` with valid file | Write test JSON first | Returns parsed object |
| 30 | `readAuthProfiles()` with invalid JSON | Write garbage to file | Returns `null` |
| 31 | `mergeOAuthProfile()` adds to empty file | No existing file | Creates with version + profile + lastGood |
| 32 | `mergeOAuthProfile()` preserves existing api_key profiles | File with api_key profile | Both profiles present after merge |
| 33 | `mergeOAuthProfile()` preserves `usageStats` | File with usageStats | usageStats retained |

### 1.8 Provider Status

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 34 | Connected profile (future expiry) | Write profile with `expires: future` | `{ connected: true, remainingMs > 0 }` |
| 35 | Expired profile | Write profile with `expires: past` | `{ connected: false, remainingMs: 0 }` |
| 36 | Missing profile | Empty auth-profiles.json | `{ connected: false }` |
| 37 | Non-openai provider | Call with `"anthropic"` | `{ connected: false }` |

### 1.9 Disconnect

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 38 | Remove existing OAuth profile | File with `openai-codex:default` | Returns `true`, profile gone from file |
| 39 | Profile doesn't exist | Empty profiles | Returns `true` (idempotent) |
| 40 | Preserves other profiles during disconnect | File with OAuth + api_key profiles | api_key profile survives |

---

### 1.10 Auth Profiles Writer (`openclaw-auth-profiles-writer.test.ts`)

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 41 | Writes api_key profiles from config | Config with openai provider | File has `openai:default` api_key profile |
| 42 | Preserves existing OAuth profiles | Pre-write OAuth profile, then sync | OAuth profile survives, api_key added |
| 43 | Updates api_key without touching OAuth | Pre-write both types, sync with new key | OAuth unchanged, api_key updated |
| 44 | Preserves `lastGood` and `usageStats` | Pre-write with metadata | Metadata retained after sync |
| 45 | Missing file → creates fresh | No existing file | New file created with api_key profiles |
| 46 | Malformed file → treated as empty | Write garbage JSON | Fresh file with api_key profiles |
| 47 | No agents in config → no-op | Empty agents list | No files written |
| 48 | Missing workspace field → skipped | Agent with null workspace | That agent skipped |

---

## 2. API Route Tests (Integration)

### 2.1 Route Contract Tests

| # | Route | Test | Expected |
|---|-------|------|----------|
| 49 | `POST /api/v1/providers/openai/oauth/start` | Valid call | 200 with `{ browserUrl }` |
| 50 | `POST /api/v1/providers/invalid/oauth/start` | Unknown provider | 200 with `{ error }` |
| 51 | `GET /api/v1/providers/openai/oauth/status` | No flow active | 200 with `{ status: "idle" }` |
| 52 | `GET /api/v1/providers/openai/oauth/provider-status` | No OAuth connected | 200 with `{ connected: false }` |
| 53 | `POST /api/v1/providers/openai/oauth/disconnect` | No OAuth to disconnect | 200 with `{ ok: false }` or `{ ok: true }` |

---

## 3. Frontend Component Tests (Vitest + SSR)

### 3.1 Conditional Rendering (`models-oauth.test.tsx`)

| # | Test | Setup | Expected |
|---|------|-------|----------|
| 54 | "Login with ChatGPT" button visible for OpenAI | `providerId="openai"` | Button rendered |
| 55 | No OAuth button for Anthropic | `providerId="anthropic"` | No OAuth section |
| 56 | No OAuth button for Google | `providerId="google"` | No OAuth section |
| 57 | Connected banner when OAuth active | Mock provider-status `connected: true` | Green banner with "Connected via ChatGPT" |
| 58 | API key section hidden when connected | Mock provider-status `connected: true` | No API key input, no proxy URL input |
| 59 | API key section visible when not connected | Mock provider-status `connected: false` | API key input visible |
| 60 | Divider "Or enter an API key manually" visible | Not connected | Divider rendered |
| 61 | Spinner during pending | `oauthPending=true` | Spinner + "Waiting for ChatGPT login..." |

---

## 4. E2E Tests (Playwright — Mocked)

### 4.1 OAuth Connect Flow (`openai-oauth.spec.ts`)

| # | Test | Mocks | Steps | Assertions |
|---|------|-------|-------|------------|
| 62 | `[mock]` Login button visible | Mock `GET /providers` | Navigate to models → select OpenAI | "Login with ChatGPT" button visible |
| 63 | `[mock]` Click login opens browser | Mock `POST /oauth/start` → `{ browserUrl: "https://auth.openai.com/..." }` | Click login button | `context.waitForEvent("page")` → new tab with auth.openai.com |
| 64 | `[mock]` Pending spinner shown | Mock start + `GET /oauth/status` → `{ status: "pending" }` | Click login | Spinner + waiting text visible |
| 65 | `[mock]` Completed → connected banner | Mock status: pending → completed, mock providers with OAuth | Click login, wait for poll | Connected banner visible, model list visible, API key hidden |
| 66 | `[mock]` Failed → error toast | Mock status → `{ status: "failed", error: "User cancelled" }` | Click login | Error toast visible |

### 4.2 OAuth Connected State

| # | Test | Mocks | Steps | Assertions |
|---|------|-------|-------|------------|
| 67 | `[mock]` Connected banner shown | Mock provider-status `connected: true` | Navigate to models → OpenAI | Banner: "Connected via ChatGPT" + Disconnect button |
| 68 | `[mock]` Model list from OAuth | Mock providers with models | Navigate | Model cards rendered |
| 69 | `[mock]` API key section hidden | Mock connected | Navigate | No password input, no proxy URL input |

### 4.3 OAuth Disconnect Flow

| # | Test | Mocks | Steps | Assertions |
|---|------|-------|-------|------------|
| 70 | `[mock]` Disconnect removes banner | Mock disconnect → `{ ok: true }`, mock providers updated | Click Disconnect → confirm | Banner gone, login button reappears |

### 4.4 Fallback to API Key

| # | Test | Mocks | Steps | Assertions |
|---|------|-------|-------|------------|
| 71 | `[mock]` API key works when no OAuth | No OAuth mock | Enter API key → verify → save | Models appear, provider saved |

---

## 5. Manual Smoke Test

### 5.1 Prerequisites
- `pnpm dev` running (Controller + Web)
- OpenAI ChatGPT Plus/Pro account available
- Browser available for OAuth redirect

### 5.2 Happy Path

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `http://localhost:5173/workspace/models?tab=providers` | Provider list visible |
| 2 | Click "OpenAI" provider | OpenAI detail panel shown |
| 3 | Observe "Login with ChatGPT" button | Button visible above API key input |
| 4 | Click "Login with ChatGPT" | Browser opens to `auth.openai.com` |
| 5 | Authenticate with ChatGPT account | Redirected to localhost callback |
| 6 | Observe callback page | "Connected to ChatGPT" success page |
| 7 | Return to Nexu | Green "Connected via ChatGPT" banner |
| 8 | Observe model list | GPT models populated (e.g., gpt-5.1, gpt-5-mini) |
| 9 | Verify API key section hidden | No API key input or proxy URL visible |
| 10 | Check auth-profiles.json | `cat ~/.nexu/runtime/openclaw/state/agents/*/agent/auth-profiles.json` shows `openai-codex:default` with `type: "oauth"` |

### 5.3 Disconnect

| Step | Action | Expected Result |
|------|--------|-----------------|
| 11 | Click "Disconnect" | Confirm dialog appears |
| 12 | Confirm disconnect | Banner disappears |
| 13 | Observe UI | "Login with ChatGPT" button reappears |
| 14 | Observe API key section | API key input visible again |
| 15 | Check auth-profiles.json | `openai-codex:default` profile removed |

### 5.4 Fallback to API Key

| Step | Action | Expected Result |
|------|--------|-----------------|
| 16 | Enter an OpenAI API key | Key input accepts value |
| 17 | Click "Check" | Models verified |
| 18 | Click "Save" | Provider saved via API key path |

### 5.5 Auth Profiles Preservation

| Step | Action | Expected Result |
|------|--------|-----------------|
| 19 | Connect via OAuth (step 4-6) | OAuth profile in auth-profiles.json |
| 20 | Save another provider (e.g., Anthropic) with API key | Triggers config sync |
| 21 | Check auth-profiles.json | OAuth profile still present alongside new api_key profile |

### 5.6 Edge Cases

| Step | Action | Expected Result |
|------|--------|-----------------|
| 22 | Click "Login with ChatGPT" then close browser tab without authenticating | After 5 minutes, UI shows error toast "OAuth flow timed out" |
| 23 | Click "Login with ChatGPT" on non-OpenAI provider | Should not be possible — button only renders for OpenAI |
| 24 | Navigate away during pending, then return | Pending state may reset (in-memory), can start new flow |

---

## 6. Automated Checks

```bash
# All must pass before merging
pnpm typecheck          # ✅ Verified passing
pnpm lint               # ✅ Verified passing (2 warnings in desktop — pre-existing)
pnpm test               # Run after writing unit tests
pnpm generate-types     # ✅ Already regenerated
```

---

## 7. Test File Locations

| File | Type | Runner |
|------|------|--------|
| `apps/controller/tests/openclaw-auth-service.test.ts` | Unit | Vitest |
| `apps/controller/tests/openclaw-auth-profiles-writer.test.ts` | Unit | Vitest |
| `apps/web/tests/models-oauth.test.tsx` | Component | Vitest |
| `apps/web/e2e/openai-oauth.spec.ts` | E2E | Playwright |
