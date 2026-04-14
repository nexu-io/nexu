# Model-Level ID Field Usage in Nexu

Date: 2026-04-14
Scope: single model record `id` field (e.g. `"gpt-5.4"`, `"gemini-3-flash-preview"`) — **not** provider id, runtime ref, bot id, or session id.

## TL;DR

The raw model `id` flows: external provider API → cloud inventory / BYOK config → persisted bot/runtime config → compiled `openclaw.json`, passing through multiple transformation layers (prefix stripping, namespace addition, OAuth remapping, alias resolution). Validation is minimal at ingestion points. Same raw id can exist under multiple providers — uniqueness is provider-scoped, made globally unique only by adding the runtime prefix.

## 1. Schema & type definitions

### Primary schemas

`packages/shared/src/schemas/model-provider-config.ts:44`
```ts
modelProviderModelEntrySchema = z.object({
  id: z.string().min(1),  // raw provider-native id, no namespace
  name: z.string().min(1),
  ...
})
```
- Constraint: `.min(1)` only — no format / uniqueness / collision checks

`packages/shared/src/schemas/bot.ts:29`
```ts
botResponseSchema = z.object({
  modelId: z.string(),  // may contain provider prefix
  ...
})
```

`apps/controller/src/store/schemas.ts:466`
```ts
controllerRuntimeConfigSchema = z.object({
  defaultModelId: z.string().default("link/gemini-3-flash-preview"),
  ...
})
```
Default is a cloud runtime ref; accepts `link/`, `litellm/`, `debug/`-prefixed refs.

## 2. Compilation into `openclaw.json`

`apps/controller/src/lib/openclaw-config-compiler.ts:58-76` — `buildModelEntry(id, name?)` wraps the raw id with OpenClaw metadata. Three callers:

1. Line 108 — LiteLLM: `buildModelEntry(modelId)` (after stripping `litellm/` prefix)
2. Line 139 — bundled providers: `buildModelEntry(buildProviderRuntimeModelId(descriptor, model.id), model.name)`
3. Line 156 — cloud (Link): `buildModelEntry(model.id, model.name)` (passed through as-is)

Bot runtime ref resolution at `openclaw-config-compiler.ts:256-258`:
```ts
model: bot.modelId
  ? { primary: resolveModelId(config, env, bot.modelId, oauthState) }
  : undefined,
```

## 3. OAuth remapping

`apps/controller/src/lib/openclaw-config-compiler.ts:30-32, 188-196`
```ts
const OAUTH_PROVIDER_MAP: Record<string, string> = {
  openai: "openai-codex",
};
```

In `resolveModelId()`, when OAuth is connected for OpenAI, the runtime prefix is remapped `openai/<id>` → `openai-codex/<id>`. The raw id itself does not change.

## 4. Prefix / namespace normalization

`apps/controller/src/lib/model-provider-runtime.ts:275-282` — `stripCanonicalModelPrefix(namespace, modelId)`:
- Input `"openai/gpt-4o"` → output `"gpt-4o"`
- Input already bare → returned unchanged

`model-provider-runtime.ts:284-306` — `buildProviderRuntimeModelId(descriptor, modelId)`:
- Custom provider → returns raw id unchanged
- Canonical provider (runtime key == canonical OpenClaw id) → returns raw id
- Proxied / BYOK → returns `${namespace}/${id}`

`model-provider-runtime.ts:308-313` — `buildProviderRuntimeModelRef(descriptor, modelId)` assembles `${runtimeKey}/${runtimeModelId}`.

`apps/controller/src/store/schemas.ts:141-145` — special prefixes (`link/`, `litellm/`, `debug/`) skip normalization entirely.

## 5. Bot / agent defaults

`packages/shared/src/schemas/bot.ts:13` — createBotSchema default is `"gpt-4o"` (bare).

`apps/controller/src/store/schemas.ts:131-176` — `normalizePersistedModelRef(rawModelId, modelsConfig)`:
- Pass-through for `link/`, `litellm/`, `debug/`
- Otherwise match against persisted providers, strip legacy `byok_` prefix, or normalize existing `provider/id` shape
- Last resort: return as-is

Applied on config load at `schemas.ts:600-606` to every `bot.modelId`.

## 6. Cloud (Link) inventory ingestion

`apps/controller/src/lib/openclaw-config-compiler.ts:34-49` — `isDesktopCloudConfig` type-guard expects `models: Array<{ id: string; name: string; provider?: string }>`. Only type checks, no format validation.

Line 149-159: cloud models compiled straight into `providers.link.models` via `buildModelEntry(model.id, model.name)` — raw id preserved, no remapping.

Config-store side: `apps/controller/src/store/nexu-config-store.ts:211, 2093`.

## 7. Web UI consumption

`apps/web/src/pages/models.tsx:312-316` — `getModelDisplayLabel(modelId)` strips the provider prefix for display only.

`models.tsx:318-331` — `isModelSelected(a, b)` matches by display label + namespace-presence parity, so `"gpt-4o"` and `"openai/gpt-4o"` treated as the same selection.

`models.tsx:333-346` — `normalizeByokModelSelectionKey(providerKey, modelId)` lowercases + prefixes for BYOK matching.

`models.tsx:359-372` — `getProviderIdFromModelId(models, modelId)` looks up provider by id or parses from `provider/id` syntax; returns null for bare ids with no match.

Drop-down at line 2424: `isSelected = isModelSelected(model.id, currentModelId)`.

## 8. Tests

`apps/controller/tests/model-provider-registry.test.ts:100-112` — composite custom-provider keys. Format `template/instance`; bundled provider ids rejected as custom.

## Collisions & ambiguities

1. **Provider-scoped uniqueness.** `"gpt-4o"` can exist under OpenAI and under a custom OpenAI-compat BYOK simultaneously. Uniqueness is achieved only by the runtime prefix — nothing prevents an ingestion path from claiming an id owned by another provider.
2. **Same id with / without namespace.** Users can store `"gpt-4o"` or `"openai/gpt-4o"`; `isModelSelected` treats them as equivalent at UI level.
3. **Provider alias fuzziness.** `"gemini"`, `"Gemini"`, `"google"` all route to Google via alias resolution. Stored form is `"google/gemini-3-flash-preview"` after normalization.

## Sanitization gaps

1. **Cloud inventory:** no format validation on `id` — any string passes. No duplicate detection across entries. No collision check against bundled providers.
2. **Bot / runtime assignment:** `botResponseSchema.modelId: z.string()` has no constraints. Normalized at load-time, but invalid ids (e.g. referencing a deleted provider) may persist.
3. **Case handling:** provider keys are case-insensitive; model ids are case-sensitive inside a provider. UI lowercases for BYOK matching but stored ids retain original case — potential ingestion mismatch.

## Open design questions

1. **Should model id be globally unique or provider-scoped?** Currently provider-scoped; every consumer needs the provider context. Risk: silent collisions between custom and bundled providers resolved by precedence order.
2. **Source of truth for id strings.** No canonical store — each layer copies from the one above (external API → cloud → config → compiled). If cloud API renames a model, persisted bot configs don't auto-update.
3. **Should the id format be validated?** Current constraint is `.min(1)` only. A regex like `/^[a-zA-Z0-9._-]+$/` would reject whitespace and special characters at ingestion; worth considering for BYOK user-submitted ids especially.

## Key file map

| File | Role |
|---|---|
| `packages/shared/src/schemas/model-provider-config.ts` | Raw entry shape + `.min(1)` constraint |
| `packages/shared/src/schemas/bot.ts` | Bot `modelId` field (no constraint) |
| `apps/controller/src/store/schemas.ts` | Persisted-config normalization + defaultModelId |
| `apps/controller/src/lib/openclaw-config-compiler.ts` | `buildModelEntry`, `resolveModelId`, OAuth remap, cloud ingestion |
| `apps/controller/src/lib/model-provider-runtime.ts` | Prefix strip + runtime id/ref construction |
| `apps/controller/src/store/nexu-config-store.ts` | Cloud inventory storage shape |
| `apps/web/src/pages/models.tsx` | Display / selection / BYOK normalization |
