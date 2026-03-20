# Quality Score

Measurable quality signals for Nexu.

## Type safety

- TypeScript strict mode: `strict: true`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- `any` banned at lint level: Biome `noExplicitAny: "error"`
- `verbatimModuleSyntax` enforced for ESM clarity
- Zod schemas as single source of truth — no manual type duplication

## Lint & format

- Biome with `recommended` rules + strict unused-import/variable checks
- Auto-organized imports (no hand-sorting)
- CI gate: `pnpm lint` must pass

## Testing

- Framework: Vitest
- Desktop and controller behavior is covered by repo-level Vitest suites
- Run: `pnpm test`

## API contract safety

- All routes validated via `@hono/zod-openapi`
- OpenAPI spec auto-generated from Zod schemas
- Frontend SDK auto-generated from spec (`pnpm generate-types`)
- Schema change → `generate-types` → frontend type errors surface immediately

## Signals to track

| Signal | Current | Target |
|--------|---------|--------|
| TypeScript `any` count | 0 (enforced) | 0 |
| Biome lint errors | 0 (CI gate) | 0 |
| Test coverage | Expanding | Key paths covered |
| Docs freshness | Manual | Doc gardening agent |
