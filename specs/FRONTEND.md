# Frontend

## Stack

React 19 + Ant Design + Vite 6. React Router for routing, React Query for server state, better-auth client for sessions.

## API client

Always use the generated SDK from `apps/web/lib/api/`. Never use raw `fetch`.

The SDK is generated from the API's OpenAPI spec:

1. API defines Zod schemas → auto-generates OpenAPI spec
2. `pnpm generate-types` runs `@hey-api/openapi-ts` → generates TypeScript client at `apps/web/lib/api/`
3. Frontend imports from generated `sdk.gen.ts`

After any API route/schema change: `pnpm generate-types` then `pnpm typecheck`.

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Redirect | Redirects to `/workspace` |
| `/auth` | Auth | Register / login |
| `/onboarding` | Onboarding | New user setup |
| `/workspace` | Sessions | Bot conversation sessions |
| `/workspace/sessions` | Sessions | Bot conversation sessions |
| `/workspace/sessions/:id` | Sessions | Session detail |
| `/workspace/channels` | Channels | Multi-platform channel management (Slack, Discord, Feishu) |
| `/workspace/channels/slack/callback` | Slack OAuth Callback | Handles Slack redirect |
| `/workspace/integrations` | Integrations | Composio toolkit connections (OAuth) |
| `/workspace/oauth-callback/:integrationId` | OAuth Callback | Handles Composio OAuth redirect |
| `/workspace/skills` | Skills | Skill catalog |
| `/workspace/skills/:slug` | Skill Detail | Individual skill info and actions |
| `/workspace/home` | Home | Controller-first home / channels overview |
| `/workspace/settings` | Settings | Models, providers, profile |
| `/workspace/models` | Settings | Same shell as settings (models tab) |
| `/workspace/rewards` | Rewards | Growth / rewards tasks (digital #106) |

## Layouts

- **`AuthLayout`** — Requires authenticated session, wraps all workspace routes.
- **`WorkspaceLayout`** — Sidebar + main content area.

## Workspace shell — UI baseline (do not regress)

Tuned layout and tokens for the desktop sidebar (growth card, usage meter, GitHub stars, flex behavior) are easy to break when adding features.

- **Frozen reference (nexu):** branch `chore/web-client-style-snapshot-20260327` (includes commit `432cc7acd6c4340a9211f41b092d938dbfd3f164` and ancestors). Branch `fix/ui-design-polish` must stay aligned with the same UI polish commits when used for PRs.
- **Frozen export (digital cowork repo):** `clone/nexu-web-client-snapshot-2026-03-27/` — see [agent-digital-cowork PR #110](https://github.com/refly-ai/agent-digital-cowork/pull/110) (merge when ready).
- **Code comments** refer to **digital #106** for the growth/rewards surface; GitHub issue numbers may differ (e.g. #107) — always diff against the branches above, not only the issue id.
- **Layout guardrails:** the main nav + conversations column keeps `flex-1 min-h-0 overflow-y-auto`; the growth block stays in a **`shrink-0`** wrapper so the usage row is not collapsed by flex. Do not remove these without re-checking Electron sidebar height.

## Conventions

- **State:** React Query for all server state. No manual `fetch` + `useState` patterns.
- **Auth:** `apps/web/src/lib/auth-client.ts` for session management.
- **Toasts:** sonner. **Icons:** lucide-react.
- **Styling:** Tailwind CSS + Ant Design components.
- **Components:** Reusable UI components in `src/components/ui/` (Radix UI primitives).
- **Clickable min font-size:** Any text inside a clickable surface (`<button>`, `<a>`, `<Link>`, `cursor-pointer`, or child of a click target) must use `font-size >= 12px`. Never use `text-[10px]` or `text-[11px]` on interactive elements.

## Key files

- `src/main.tsx` — React entry point
- `src/app.tsx` — Router setup
- `src/lib/auth-client.ts` — better-auth client
- `lib/api/` — Auto-generated SDK (do not edit manually)
