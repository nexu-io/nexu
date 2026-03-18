# Composio Chat Auth Handoff

## Purpose

This note captures the conclusions from the March 7, 2026 discussion about Composio auth, the Integrations page, and the relationship between tools, skills, and in-chat authorization. It is intended as a local handoff for follow-up implementation work in Claude Code or another agent workflow.

## Final product decisions

### 1. Composio manages app authorization

- Nexu should use Composio as the app authorization and connected-account layer.
- App auth must not be implemented separately inside each skill.
- The same user identity must be used across:
  - page-driven auth
  - in-chat auth
  - downstream skill execution

### 2. Skills and tools are different surfaces

- The **tool page** is the canonical source of truth for app connection status.
- The **skill page** is a consumer of that status.
- The skill page should show whether a skill is runnable, but it should not own or duplicate tool auth state.

### 3. OpenClaw executes skills, Nexu is the control plane

- Skills are installed into OpenClaw.
- Nexu is the backend/control plane that manages:
  - user records
  - integration state
  - auth flows
  - skill readiness derivation
- A mission may combine multiple skills, and this is acceptable as long as:
  - the required app auth exists
  - the relevant skill instructions are available

### 4. In-chat auth is required

- Users must be able to authorize missing apps from chat.
- The resulting connection state must sync back to the tool management page.
- This means page auth and chat auth must both write to the same integration records.

## What Composio in-chat auth means

Based on the Composio docs we reviewed:

- In-chat auth is available when a Composio session is created with connection management enabled.
- Composio can expose an auth-management tool in the conversation.
- When a tool invocation needs missing auth, the agent can surface a connect link in chat.
- A callback URL can send the user back to the application after provider OAuth completes.

Important implementation implication:

- True in-chat auth is not just `session.authorize()` from a settings page.
- It also requires the agent/runtime session used for tool execution to be created with Composio connection management enabled.

## Current Nexu constraint

The current Nexu web app does **not** yet expose a real chat composer/runtime path that executes Composio tools directly.

So the work should be split into two layers:

### Layer A: platform foundation

Implement now:

- integration DB schema
- Composio SDK wrapper
- integration API routes
- shared callback/status sync
- Integrations page
- skill readiness derived from tool state

### Layer B: true in-chat auth

Implement when the runtime/chat execution path is wired to Composio:

- Composio session creation for the agent/user with `manageConnections` enabled
- chat-triggered missing-auth flow
- resume/retry behavior after auth completes

## Required page architecture

### Tool management page

Needed as a dedicated surface for:

- listing available tools/apps
- showing connect/disconnect/reconnect state
- manual auth management
- reflecting connections created from chat

Suggested route:

- `/workspace/integrations`

### Skill page

The skill page should show:

- required tools
- missing tools
- derived readiness

Suggested status model:

- `ready`
- `partial`
- `missing-auth`

Suggested CTA behavior:

- `Use skill` if ready
- `Connect tools` if missing auth

The `Connect tools` CTA should deep-link into the Integrations page with required toolkits highlighted.

## Required data relationship

### Tool state is primary

Suggested conceptual model:

- `supported_toolkits`
- `user_integrations`
- `integration_credentials`

### Skill readiness is derived

Each skill should declare something like:

- `requiredToolkits: string[]`
- `optionalToolkits?: string[]`

Nexu should then derive:

- `connectedToolkits`
- `missingToolkits`
- `readiness`

Do not store skill readiness as a separate source of truth unless there is a strong caching reason.

## Sync model between chat and page

This was a key outcome of the discussion.

### Requirement

Both entry points must update the same integration state:

- auth started from page
- auth started from chat

### Result

After a user authorizes a tool in chat:

- `user_integrations` is updated
- the Integrations page shows the tool as connected on next fetch
- the blocked skill or mission can resume

### Shared state lifecycle

Recommended status values:

- `pending`
- `initiated`
- `active`
- `failed`
- `expired`
- `disconnected`

## Changes already made

The main Composio plan file was updated to reflect these decisions:

- [2026-03-07-composio-integration-plan.md](/Users/alche/Documents/digit-sutando/nexu/specs/plans/2026-03-07-composio-integration-plan.md)

That plan now reflects:

- no forced “connect everything” setup
- shared page/chat auth state
- Integrations page as canonical tool management
- Skills page as derived readiness consumer

## What is not implemented yet

At the time of writing, these are **not yet coded**:

- `@composio/core` integration
- integration database tables
- integration API routes
- Composio callback handling
- Integrations page
- skill readiness API/UI wiring
- true in-chat Composio auth in the runtime/chat path

Only the planning docs were updated.

## Recommended implementation order

1. Add Composio dependency and env wiring
2. Add integration tables and shared Zod schemas
3. Build Composio service wrapper in API
4. Add integration routes for:
   - list
   - connect
   - refresh
   - disconnect
5. Build `/workspace/integrations`
6. Add skill readiness derivation
7. Wire skill pages to deep-link into Integrations
8. Wire true runtime/chat Composio sessions with `manageConnections`

## Relevant docs and references

### Composio docs

- In-chat auth:
  - https://docs.composio.dev/docs/authenticating-users/in-chat-authentication
- Manual auth:
  - https://docs.composio.dev/docs/authenticating-users/manually-authenticating
- Sessions / configuration:
  - https://docs.composio.dev/docs/configuring-sessions
- Connected accounts:
  - https://docs.composio.dev/docs/auth-configuration/connected-accounts
- Multiple connected accounts:
  - https://docs.composio.dev/docs/managing-multiple-connected-accounts
- Dashboard cookbook:
  - https://docs.composio.dev/cookbooks/app-connections-dashboard

### Relevant Nexu files

- Main plan:
  - [2026-03-07-composio-integration-plan.md](/Users/alche/Documents/digit-sutando/nexu/specs/plans/2026-03-07-composio-integration-plan.md)
- Current skill routes:
  - [skill-routes.ts](/Users/alche/Documents/digit-sutando/nexu/apps/api/src/routes/skill-routes.ts)
- Current app routes:
  - [app.ts](/Users/alche/Documents/digit-sutando/nexu/apps/api/src/app.ts)
- Current sessions page:
  - [sessions.tsx](/Users/alche/Documents/digit-sutando/nexu/apps/web/src/pages/sessions.tsx)
- Current workspace layout:
  - [workspace-layout.tsx](/Users/alche/Documents/digit-sutando/nexu/apps/web/src/layouts/workspace-layout.tsx)

## Practical handoff summary

If Claude Code continues this work, it should not start by building a skill-only page or a batch “connect all apps” wizard.

It should build:

1. a real Composio-backed tool management layer
2. shared integration state for page + chat auth
3. skill readiness derived from that tool state
4. then the actual in-chat auth/runtime wiring
