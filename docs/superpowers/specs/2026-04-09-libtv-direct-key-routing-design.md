# LibTV Direct-Key Routing Design

## Summary

Extend the bundled `libtv-video` skill so a single skill can support two execution modes:

- `mgk_...` keys use the existing Nexu-managed Seedance gateway flow
- `sk-libtv-...` keys bypass the Nexu Seedance gateway and call LibTV's direct OpenAPI flow

Both modes must keep Nexu's local persistence and Nexu's submit/progress/terminal notification mechanism.

## Goals

- Keep one bundled LibTV skill visible to the agent
- Route execution by API key prefix without requiring the user to choose a separate skill
- Preserve the current Nexu notification behavior for both modes
- Preserve existing Nexu-managed `mgk_...` behavior
- Follow the upstream `libtv-skills` direct API contract for `sk-libtv-...`

## Non-Goals

- Do not split LibTV into multiple visible skills
- Do not remove the current Nexu notification mechanism
- Do not change OpenClaw runtime behavior outside this skill

## Source Contracts

### Nexu-managed mode

Current bundled skill contract:

- gateway base: `https://seedance.nexu.io/`
- submit/query contract handled by current `libtv_video.py`
- notifications sent through Nexu controller `/api/internal/libtv-notify`

### Direct LibTV mode

Upstream contract from `git@github.com:libtv-labs/libtv-skills.git`:

- auth env name: `LIBTV_ACCESS_KEY`
- auth header: `Authorization: Bearer <LIBTV_ACCESS_KEY>`
- default base: `https://im.liblib.tv`
- endpoints:
  - `POST /openapi/session`
  - `GET /openapi/session/:sessionId`
  - `POST /openapi/session/change-project`
  - `POST /openapi/file/upload`
- user-side skill principle: relay the user's request, do not invent extra prompt engineering

## Design

### One skill, two backends

Keep `apps/desktop/static/bundled-skills/libtv-video/SKILL.md` as the only public skill entry.

Add a mode detector in `libtv_video.py`:

- `mgk_...` => `nexu_gateway`
- `sk-libtv-...` => `libtv_direct`
- anything else => explicit failure

All public commands continue to enter through one script and branch internally by detected mode.

### Config model

Continue using `~/.nexu/libtv.json` with a single `apiKey` field.

Accepted values:

- `mgk_...`
- `sk-libtv-...`

Derived runtime field:

- `auth_mode` with values `nexu_gateway` or `libtv_direct`

Optional direct-mode override:

- `LIBTV_DIRECT_BASE_URL` for tests or controlled local overrides

### Shared behavior across both modes

Both modes must reuse the current Nexu-side behavior:

- session persistence in `~/.nexu/libtv-sessions.json`
- delivery metadata persistence
- immediate submit notification
- periodic progress notification
- terminal success/failure/timeout notification
- recovery using persisted session records
- video ratio config behavior

### Backend-specific behavior

#### `nexu_gateway`

Unchanged logic:

- base URL `https://seedance.nexu.io/`
- current request/response contract
- current result extraction and guardrails

#### `libtv_direct`

New direct adapter:

- base URL `https://im.liblib.tv` unless overridden for tests
- Bearer auth using the configured `sk-libtv-...` key
- direct session creation/query/project change/upload paths
- prompt relay should follow the upstream LibTV skill discipline rather than Nexu gateway-specific wording

The direct adapter must not send personal LibTV keys through `seedance.nexu.io`.

## Persistence Contract

Persist one shared session record format with an added backend discriminator:

- `session_id`
- `project_uuid`
- `status`
- `submitted_text`
- `auth_mode`
- `created_at`
- `updated_at`
- `result_urls`
- `failure_message`
- `delivery`
- `notifications`
- `polling`

`delivery`, `notifications`, and `polling` keep the existing Nexu notification bookkeeping.

## Notification Rules

Notification behavior is identical across both modes:

- `submitted` notification after guarded persistence succeeds
- `progress` notification on the polling heartbeat interval
- terminal `success`, `failed`, or `timeout` notification

The notification target always comes from persisted Nexu delivery metadata and must not be recomputed from backend responses.

## Guard Rules

- `mgk_...` must never call direct LibTV endpoints
- `sk-libtv-...` must never call `seedance.nexu.io`
- unknown key prefix must fail explicitly
- direct mode must use Bearer auth
- direct mode must follow upstream response contracts for session/project fields
- submit must not claim success until session persistence succeeds
- terminal success must not be claimed until valid result URLs are extracted

## SKILL.md Updates

Update the bundled skill instructions so the agent:

- checks key type first
- uses Nexu-managed Seedance flow for `mgk_...`
- uses upstream direct LibTV flow for `sk-libtv-...`
- keeps Nexu notifications in both cases
- never routes a personal `sk-libtv-...` key through the Nexu Seedance gateway

## Test Plan

### Required red/green tests

- key detection chooses `nexu_gateway` for `mgk_...`
- key detection chooses `libtv_direct` for `sk-libtv-...`
- direct mode submit hits `/openapi/session` with Bearer auth
- direct mode query hits `/openapi/session/:sessionId`
- direct mode upload hits `/openapi/file/upload`
- direct mode submit still triggers Nexu submit notification
- direct mode polling still triggers progress and terminal Nexu notifications
- gateway-mode tests remain green

### Verification

After implementation:

- `pnpm generate-types`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## Risks

- The current bundled script mixes transport, persistence, and notification logic; introducing direct mode without clear adapter boundaries could increase drift
- Upstream LibTV direct result payloads may not match the current Nexu gateway extraction assumptions exactly, so result extraction may need mode-specific handling

## Recommendation

Implement the direct LibTV transport as a separate internal adapter behind the existing bundled skill entrypoint, while keeping one shared persistence and notification layer.
