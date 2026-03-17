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

## Layouts

- **`AuthLayout`** — Requires authenticated session, wraps all workspace routes.
- **`WorkspaceLayout`** — Sidebar + main content area.

## Conventions

- **State:** React Query for all server state. No manual `fetch` + `useState` patterns.
- **Auth:** `apps/web/src/lib/auth-client.ts` for session management.
- **Toasts:** sonner. **Icons:** lucide-react.
- **Styling:** Tailwind CSS + Ant Design components.
- **Components:** Reusable UI components in `src/components/ui/` (Radix UI primitives).

## Key files

- `src/main.tsx` — React entry point
- `src/app.tsx` — Router setup
- `src/lib/auth-client.ts` — better-auth client
- `lib/api/` — Auto-generated SDK (do not edit manually)
