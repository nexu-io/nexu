---
name: sync-docs
description: Use when code changes may have made documentation outdated, when reviewing docs for consistency, or when the user asks to sync or audit documentation.
---

# Documentation Sync

Review code changes and update project documentation for consistency.

## Mode

| Mode | How to activate | Behavior |
|------|----------------|----------|
| `delta` (default) | No argument, or say "delta" | Diff against merge-base with `origin/main` + working tree changes |
| `full` | Say "full audit" or "full sync" | Complete audit of all docs against current codebase |
| Scope keyword | Say the keyword (e.g. "db", "api") | Targeted check (see Scope Filters below) |

## Delta Mode Baseline

Identify changed files using merge-base (not a fixed commit count):

```bash
# Branch changes since diverging from main
git diff --name-only $(git merge-base HEAD origin/main)...HEAD
# Plus staged + unstaged
git diff --name-only --cached
git diff --name-only
```

Combine the results into a single list of changed files. Then use the Impact Mapping to identify which docs may need updates.

## Impact Mapping

Map changed areas to the docs they affect:

| Changed area | Affected docs |
|---|---|
| `apps/api/src/db/schema/` | `docs/generated/db-schema.md`, `ARCHITECTURE.md` |
| `apps/api/src/routes/` | `docs/references/api-patterns.md`, `ARCHITECTURE.md`, `docs/product-specs/*.md` (if route is user-facing) |
| `apps/web/src/pages/` or `apps/web/src/app.tsx` | `docs/FRONTEND.md` |
| `apps/router/src/` | `docs/FRONTEND.md` (proxy routing), `ARCHITECTURE.md` |
| `apps/landing/` | `ARCHITECTURE.md` (Monorepo layout) |
| `apps/gateway/src/` | `ARCHITECTURE.md`, `docs/RELIABILITY.md` |
| `packages/shared/src/schemas/` | `ARCHITECTURE.md` (Type safety) |
| `package.json` scripts | `CLAUDE.md` + `AGENTS.md` Commands sections |
| New apps/packages dirs | `ARCHITECTURE.md` (Monorepo layout) |
| Config generator | `docs/references/openclaw-config-schema.md`, `docs/openclaw-config-reference.md` |
| Auth changes | `docs/SECURITY.md` |
| New/moved doc files | `CLAUDE.md` Doc Map, `AGENTS.md` Where to look, relevant index files |

## Cross-Reference Pairs

Always verify consistency between these paired docs:

1. `CLAUDE.md` Commands section <-> `AGENTS.md` Commands section (same entries)
2. `CLAUDE.md` Documentation Map paths <-> actual files on disk
3. `CLAUDE.md` Hard Rules <-> `AGENTS.md` Hard rules
4. `ARCHITECTURE.md` monorepo layout <-> actual `apps/` + `packages/` dirs
5. `docs/DESIGN.md` table <-> actual `docs/design-docs/` + `docs/designs/` contents
6. `docs/design-docs/index.md` table <-> actual design files
7. `docs/product-specs/index.md` table <-> actual `docs/product-specs/*.md` files
8. `docs/PLANS.md` table <-> `docs/exec-plans/{active,completed}/` contents
9. `docs/FRONTEND.md` Pages table <-> `apps/web/src/app.tsx` routes

## Scope Filters

When the user specifies a scope keyword, limit the check to that area:

| Keyword | What it checks |
|---|---|
| `db` | Schema source vs `docs/generated/db-schema.md` |
| `api` | Route files vs `docs/references/api-patterns.md` |
| `frontend` | `apps/web/` + `apps/router/` vs `docs/FRONTEND.md` |
| `commands` | `package.json` scripts vs `CLAUDE.md`/`AGENTS.md` Commands sections |
| `architecture` | All `apps/` + `packages/` vs `ARCHITECTURE.md` layout |
| `security` | Auth/crypto code vs `docs/SECURITY.md` |
| `links` | Verify all doc map paths and index references resolve to existing files |
| `guides` | `docs/guides/**` internal cross-references |
| `designs` | `docs/designs/**` + `docs/design-docs/**` vs index files |
| `exec-plans` | `docs/exec-plans/**` vs `docs/PLANS.md` |
| `product-specs` | `docs/product-specs/**` vs index + `docs/PRODUCT_SENSE.md` |

## Rules

1. **Never remove forward-looking documentation** — ask if uncertain whether content is aspirational or stale.
2. **Preserve original language** (English/Chinese) and writing style of existing docs.
3. **Regenerate `docs/generated/db-schema.md` fully** from schema source (`apps/api/src/db/schema/index.ts`), don't patch.
4. **Always verify `CLAUDE.md` <-> `AGENTS.md` consistency** after any update to either file.
5. **Do NOT auto-commit** — present the diff summary and let the user decide when to commit.

## Workflow

1. Determine mode from user request (default: delta).
2. If delta mode: run the git diff commands above, collect changed files.
3. Map changed files to affected docs using the Impact Mapping.
4. Read each affected doc and compare against current code.
5. Check all Cross-Reference Pairs for consistency.
6. Present findings: what's outdated, what's missing, what's inconsistent.
7. Apply fixes with user approval.
8. After fixes, re-verify Cross-Reference Pairs touched by changes.
