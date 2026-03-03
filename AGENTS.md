# AGENTS.md

This file is for agentic coding tools. It's a map — read linked docs for depth.

## Repo overview

Nexu is an OpenClaw multi-tenant platform. Users create AI bots, connect them to Slack, and the system generates OpenClaw config that hot-loads into shared Gateway processes.

- Monorepo: pnpm workspaces
- `apps/api` — Hono + Drizzle + Zod OpenAPI (Node ESM)
- `apps/web` — React + Ant Design + Vite
- `packages/shared` — Shared Zod schemas
- `deploy/k8s` — Kubernetes manifests

## Commands

```bash
pnpm install                          # Install
pnpm dev                              # All apps (API :3000, Web :5173)
pnpm --filter @nexu/api dev           # API only
pnpm --filter @nexu/web dev           # Web only
pnpm build                            # Build all
pnpm check:esm-imports                # Scan built dist for extensionless relative ESM specifiers
pnpm typecheck                        # Typecheck all
pnpm lint                             # Biome lint
pnpm format                           # Biome format
pnpm test                             # Vitest
pnpm --filter @nexu/api test          # API tests only
pnpm --filter @nexu/api db:push       # Drizzle schema push
pnpm generate-types                   # OpenAPI spec → frontend SDK
```

## Hard rules

- **Never use `any`.** Use `unknown` with narrowing or `z.infer<typeof schema>`.
- No foreign keys in Drizzle schema — application-level joins only.
- Credentials (bot tokens, signing secrets) must never appear in logs or errors.
- Frontend must use generated SDK (`apps/web/lib/api/`), never raw `fetch`.
- All API responses must use Zod response schemas via `@hono/zod-openapi`.
- Config generator output must match `docs/references/openclaw-config-schema.md`.
- Do not add dependencies without explicit approval.
- Do not modify OpenClaw source code.
- Never commit code changes until explicitly told to do so.
- Whenever you add a new environment variable, update `deploy/helm/nexu/values.yaml` in the same change.
- Gateway sidecar: never derive state paths from `OPENCLAW_CONFIG_PATH`. Use `env.OPENCLAW_STATE_DIR` for state-related files (sessions, skills, nexu-context.json). See `docs/guides/gateway-environment-guide.md`.

## Required checks

- `pnpm typecheck` — after any TypeScript changes
- `pnpm lint` — after any code changes
- `pnpm generate-types` — after API route/schema changes
- `pnpm test` — after logic changes

## Code style (quick reference)

- Biome: 2-space indent, double quotes, semicolons always
- Files: `kebab-case` / Types: `PascalCase` / Variables: `camelCase`
- Zod schemas: `camelCase` + `Schema` suffix
- DB tables: `snake_case` in Drizzle
- Public IDs: cuid2 (`@paralleldrive/cuid2`), never expose `pk`
- Errors: throw `HTTPException` with status + contextual message
- Logging: structured (pino or console JSON), never log credentials

## Where to look

| Topic | Location |
|-------|----------|
| Architecture & data flows | `ARCHITECTURE.md` |
| System design | `docs/design-docs/openclaw-multi-tenant.md` |
| OpenClaw internals | `docs/design-docs/openclaw-architecture-internals.md` |
| Engineering principles | `docs/design-docs/core-beliefs.md` |
| Config schema & pitfalls | `docs/references/openclaw-config-schema.md` |
| API coding patterns | `docs/references/api-patterns.md` |
| Infrastructure | `docs/references/infrastructure.md` |
| Gateway environment (dev vs prod) | `docs/guides/gateway-environment-guide.md` |
| Local Slack testing | `docs/references/local-slack-testing.md` |
| Frontend conventions | `docs/FRONTEND.md` |
| Security posture | `docs/SECURITY.md` |
| Reliability | `docs/RELIABILITY.md` |
| Product model | `docs/PRODUCT_SENSE.md` |
| Quality signals | `docs/QUALITY_SCORE.md` |
| Product specs | `docs/product-specs/` |
| Execution plans | `docs/exec-plans/` |
| DB schema reference | `docs/generated/db-schema.md` |
| Documentation sync | `.nexu-dev/skills/sync-docs/SKILL.md` |
| E2E gateway testing | `.nexu-dev/skills/nexu-e2e-test/SKILL.md` |

## Documentation maintenance

After significant code changes, verify documentation is current.

### Diff baseline

```bash
git diff --name-only $(git merge-base HEAD origin/main)...HEAD
```

### Impact mapping (changed area -> affected docs)

| Changed area | Affected docs |
|---|---|
| `apps/api/src/db/schema/` | `docs/generated/db-schema.md`, `ARCHITECTURE.md` |
| `apps/api/src/routes/` | `docs/references/api-patterns.md`, `docs/product-specs/*.md` |
| `apps/web/src/pages/` or routing | `docs/FRONTEND.md` |
| `apps/gateway/src/` | `ARCHITECTURE.md`, `docs/RELIABILITY.md` |
| `package.json` scripts | `CLAUDE.md` + `AGENTS.md` Commands sections |
| New/moved doc files | `CLAUDE.md` Doc Map, `AGENTS.md` Where to look |

### Cross-reference checklist

1. `CLAUDE.md` Commands <-> `AGENTS.md` Commands (same entries)
2. `CLAUDE.md` Doc Map <-> `AGENTS.md` Where to look (valid paths)
3. `docs/DESIGN.md` <-> `docs/design-docs/` + `docs/designs/` (indexed)
4. `docs/product-specs/index.md` <-> actual spec files
5. `docs/FRONTEND.md` Pages <-> `apps/web/src/app.tsx` routes

### Rules

- Regenerate `docs/generated/db-schema.md` fully from schema source
- Preserve original language (English/Chinese)
- Do not auto-commit; present changes for review

Full reference: `.nexu-dev/skills/sync-docs/SKILL.md`

## Cross-project sync rules

Nexu work must be synced into the team knowledge repo at:
- `agent-digital-cowork/clone/`

When producing artifacts in this repo, sync them to the cross-project repo using this mapping:

| Artifact type | Target in `agent-digital-cowork/clone/` |
|---|---|
| Design plans / architecture proposals | `design/` |
| Debug summaries / incident analysis | `debug/` |
| Ideas / product notes | `ideas/` |
| Stable facts / decisions / runbooks | `knowledge/` |
| Open blockers / follow-ups | `blockers/` |

## Memory references

Project memory directory:
- `/Users/alche/.claude/projects/-Users-alche-Documents-digit-sutando-nexu/memory/`

Keep these memory notes up to date:
- Cross-project sync rules memory (source of truth for sync expectations)
- Skills hot-reload findings memory (`skills-hotreload.md`)
- DB/dev environment quick-reference memory

## Skills hot-reload note

For OpenClaw skills behavior and troubleshooting, maintain and consult:
- `skills-hotreload.md` in the Nexu memory directory above.

This note should track:
- End-to-end pipeline status (`DB -> API -> Sidecar -> Gateway`)
- Why `openclaw-managed` skills may be missing from session snapshots
- Watcher/snapshot refresh caveats and validation steps

## Local quick reference

- DB (default local): `postgresql://nexu:nexu@localhost:5433/nexu_dev`
- API env path: `apps/api/.env`
- OpenClaw managed skills dir (expected default): `~/.openclaw/skills/`
- If behavior differs, verify effective `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` used by running gateway processes.
