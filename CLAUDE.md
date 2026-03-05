# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nexu is an OpenClaw multi-tenant SaaS platform. Users create AI bots via a dashboard and connect them to Slack. The system dynamically generates OpenClaw configuration and hot-loads it into shared Gateway processes. One Gateway process serves 50+ bots across multiple users through OpenClaw's native multi-agent + multi-account + bindings routing.

## Commands

All commands use pnpm. Target a single app with `pnpm --filter <package>`.

```bash
pnpm install                          # Install dependencies
pnpm dev                              # Start all apps (API :3000, Web :5173)
pnpm --filter @nexu/api dev           # API only
pnpm --filter @nexu/web dev           # Web only
pnpm build                            # Build all
pnpm typecheck                        # Typecheck all (run after any TS changes)
pnpm lint                             # Biome lint (run after any code changes)
pnpm format                           # Biome auto-fix + format
pnpm test                             # Run all tests (Vitest)
pnpm --filter @nexu/api test          # API tests only
pnpm db:generate                      # Generate Drizzle migration files (recommended)
pnpm --filter @nexu/api db:push       # Push Drizzle schema to database
pnpm generate-types                   # Export OpenAPI spec → regenerate frontend SDK
```

After API route/schema changes: `pnpm generate-types` then `pnpm typecheck`.

## DB Schema Change Workflow

When changing DB structure, follow this workflow.

### Development stage

1. Use TS schema (`apps/api/src/db/schema/index.ts`) as the SSoT for target DB structure.
2. Generate migration SQL with Drizzle (`pnpm db:generate`) and commit files under `apps/api/migrations/`.

### PR stage

- CI automatically checks migration SQL; failures block the PR.

## Architecture

See `ARCHITECTURE.md` for the full bird's-eye view. Key points:

- **Monorepo:** `apps/api` (Hono), `apps/web` (React), `packages/shared` (Zod schemas)
- **Type safety:** Zod → OpenAPI → generated frontend SDK. Never duplicate types.
- **Config generator:** `apps/api/src/lib/config-generator.ts` — builds OpenClaw config from DB
- **Key data flows:** Slack OAuth, Slack event routing, config hot-reload

## Hard Rules

- **Never use `any`** — use `unknown` with narrowing or `z.infer<typeof schema>`
- **No foreign keys** in Drizzle schema — application-level joins only
- **Credentials never in logs** — encrypt/decrypt via `apps/api/src/lib/crypto.ts` only when needed
- **Frontend uses generated SDK only** — never raw `fetch`; SDK lives at `apps/web/lib/api/`
- **Run `pnpm typecheck` and `pnpm lint` after every code change**
- **Run `pnpm generate-types` after API route/schema changes**
- Do not introduce new dependencies without explicit approval
- All API responses must use Zod response schemas registered in the OpenAPI route

## Code Style

- **Formatter/Linter:** Biome — 2-space indent, double quotes, semicolons always
- **Files/folders:** `kebab-case` / **Types:** `PascalCase` / **Variables:** `camelCase`
- **Zod schemas:** `camelCase` + `Schema` suffix
- **DB tables:** `snake_case` in Drizzle
- **Public IDs:** cuid2; never expose internal `pk`
- **Errors:** Throw `HTTPException` with status and contextual message

## Documentation Map

| Topic | Location |
|-------|----------|
| Architecture overview | `ARCHITECTURE.md` |
| Agent coding guide | `AGENTS.md` |
| System design | `docs/design-docs/openclaw-multi-tenant.md` |
| OpenClaw internals | `docs/design-docs/openclaw-architecture-internals.md` |
| Config schema & pitfalls | `docs/references/openclaw-config-schema.md` |
| API coding patterns | `docs/references/api-patterns.md` |
| Infrastructure | `docs/references/infrastructure.md` |
| Gateway environment (dev vs prod) | `docs/guides/gateway-environment-guide.md` |
| Workspace templates | `docs/guides/workspace-templates.md` |
| Local Slack testing | `docs/references/local-slack-testing.md` |
| Frontend conventions | `docs/FRONTEND.md` |
| Security posture | `docs/SECURITY.md` |
| Reliability | `docs/RELIABILITY.md` |
| DB schema reference | `docs/generated/db-schema.md` |
| Doc sync | `.nexu-dev/skills/sync-docs/SKILL.md` |
| E2E gateway testing | `.nexu-dev/skills/nexu-e2e-test/SKILL.md` |
| Production operations | `.nexu-dev/skills/prod-ops/SKILL.md` |
| Nano Banana (image gen) | `.nexu-dev/skills/nano-banana/SKILL.md` |
