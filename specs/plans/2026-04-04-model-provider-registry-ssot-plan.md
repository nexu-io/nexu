# Model Provider Registry + OpenClaw SSoT Plan

Date: 2026-04-04

## Context

Nexu's current model-provider configuration is split across multiple hardcoded systems:

- controller support list: `apps/controller/src/lib/byok-providers.ts`
- controller persistence shape: `apps/controller/src/store/schemas.ts`
- compiler logic: `apps/controller/src/lib/openclaw-config-compiler.ts`
- sync orchestration: `apps/controller/src/services/openclaw-sync-service.ts`
- web provider metadata and UX rules: `apps/web/src/pages/models.tsx`

This creates drift and makes provider additions expensive:

- adding a provider usually requires touching multiple files in both controller and web
- provider identity, aliases, default base URLs, auth modes, and UI metadata are duplicated
- Nexu persists a provider-centric config model and then re-compiles it into OpenClaw `models.providers`
- OpenClaw config is effectively a derived artifact instead of the model source of truth

Qclaw shows a better direction:

- a centralized provider registry (`/Users/mrc/Projects/qiuzhi2046/Qclaw/src/lib/openclaw-provider-registry.ts`)
- centralized provider alias normalization (`/Users/mrc/Projects/qiuzhi2046/Qclaw/src/lib/model-provider-aliases.ts`)
- UI/runtime extraction derived from OpenClaw model config and runtime status rather than separate duplicated provider definitions

ClawX adds a few additional useful patterns:

- a shared provider-definition registry reused by backend and UI (`/Users/mrc/Projects/ClawX/electron/shared/providers/registry.ts`)
- an explicit **provider account** concept for multiple saved accounts/instances (`/Users/mrc/Projects/ClawX/electron/shared/providers/types.ts`)
- runtime sync code that gives each custom/unregistered provider instance a stable runtime key (`/Users/mrc/Projects/ClawX/electron/services/providers/provider-runtime-sync.ts`)
- protocol-aware validation for OpenAI-compatible, Responses-compatible, and Anthropic-compatible endpoints (`/Users/mrc/Projects/ClawX/electron/services/providers/provider-validation.ts`)

## Problem Statement

Nexu currently has three coupled but different provider systems:

1. a persisted Nexu provider store (`config.providers`)
2. a compiled OpenClaw model-provider config (`models.providers`)
3. a web-only provider metadata map (`PROVIDER_META`)

This architecture makes the system harder to evolve, especially for:

- adding new providers
- reconciling aliases and runtime provider ids
- supporting OAuth/API-key/custom endpoint variants consistently
- keeping Nexu and OpenClaw config in sync without redundant translation logic

## Goals

1. Introduce a centralized provider registry, similar to Qclaw.
2. Make adding a new provider a small registry-first change.
3. Make OpenClaw model config the single source of truth for configured providers.
4. Simplify Nexu ↔ OpenClaw config sync so the sync layer transports state instead of redefining provider semantics.
5. Remove duplicated provider definitions across controller and web.
6. Add providers that exist in Qclaw but not in Nexu.

## Non-Goals

- redesign all model-selection UX in one phase
- change OpenClaw runtime semantics
- productize every newly added provider with bespoke UX on day one
- migrate secrets storage architecture beyond what is needed for the new config shape

## Current State Summary

### Nexu

#### 1. Persisted provider model is Nexu-specific

`apps/controller/src/store/schemas.ts` persists:

- `providerId`
- `displayName`
- `enabled`
- `baseUrl`
- `authMode`
- `apiKey`
- `oauthRegion`
- `oauthCredential`
- `models`

This is convenient for Nexu UI CRUD, but it is not the same shape as OpenClaw `models.providers`.

#### 2. Supported providers are hardcoded separately

`apps/controller/src/lib/byok-providers.ts` currently supports:

- `anthropic`
- `openai`
- `google`
- `ollama`
- `siliconflow`
- `ppio`
- `openrouter`
- `minimax`
- `kimi`
- `glm`
- `moonshot`
- `zai`

#### 3. Compiler owns too much provider policy

`apps/controller/src/lib/openclaw-config-compiler.ts` currently also owns:

- default base URLs
- Nexu → OpenClaw provider id remapping (`kimi -> moonshot`, `glm -> zai`)
- provider api type resolution
- provider auth header quirks
- proxied vs direct provider key selection (`provider` vs `byok_provider`)
- model id shaping rules

This means provider support is partly defined by the support list and partly by compiler logic.

#### 4. Web metadata is duplicated again

`apps/web/src/pages/models.tsx` has a separate `PROVIDER_META` map and provider-specific UX rules.

That means adding a provider needs changes in:

- controller schema/service layer
- compiler layer
- web display metadata
- web UX defaults

#### 5. OpenClaw sync is downstream of Nexu state

`apps/controller/src/services/openclaw-sync-service.ts` compiles Nexu config into OpenClaw config, writes it, writes auth profiles, and pushes diffs.

The sync path is operationally solid, but the source data model is upside down for model providers: Nexu state is primary, OpenClaw state is derived.

### Qclaw reference patterns worth copying

#### 1. Central registry

`/Users/mrc/Projects/qiuzhi2046/Qclaw/src/lib/openclaw-provider-registry.ts` centralizes:

- provider identity
- display name
- logo
- region
- signup URL
- description
- primary env key
- auth methods
- extra env key mappings

#### 2. Central alias normalization

`/Users/mrc/Projects/qiuzhi2046/Qclaw/src/lib/model-provider-aliases.ts` centralizes canonical ids and alias candidates.

#### 3. Derivation from config/status

`/Users/mrc/Projects/qiuzhi2046/Qclaw/src/shared/configured-provider-extraction.ts`
and
`/Users/mrc/Projects/qiuzhi2046/Qclaw/src/shared/model-catalog-state.ts`
derive configured providers from:

- OpenClaw config
- auth profiles
- runtime model status

That is the right direction for Nexu as well.

### ClawX reference patterns worth copying

#### 1. Shared registry consumed by both UI and backend

`/Users/mrc/Projects/ClawX/electron/shared/providers/registry.ts`
and
`/Users/mrc/Projects/ClawX/electron/utils/provider-registry.ts`
show a practical split:

- one shared definition list for provider identity, UI metadata, env vars, default base URLs, auth modes, and backend runtime config
- a thin backend adapter on top for runtime-only helper functions

This is a strong confirmation that Nexu should not keep separate web/controller provider maps.

#### 2. Provider-account / provider-instance modeling

`/Users/mrc/Projects/ClawX/electron/shared/providers/types.ts`
and
`/Users/mrc/Projects/ClawX/electron/services/providers/provider-store.ts`
separate:

- provider/vendor type
- saved account/instance id
- display label
- auth mode
- base URL
- protocol
- model / fallback models

This is especially relevant for Nexu custom providers. It reinforces that user-created provider instances should be first-class saved records rather than being forced into one static provider slot.

#### 3. Stable runtime key derivation for custom instances

`/Users/mrc/Projects/ClawX/electron/services/providers/provider-runtime-sync.ts`
derives a unique OpenClaw runtime provider key for unregistered/custom providers.

Important idea:

- saved provider instance identity and runtime provider key are related but not always identical
- custom providers need a deterministic runtime key strategy so multiple saved instances can coexist safely in `models.providers`

Nexu should borrow this principle, even if it uses a different final key format than ClawX.

#### 4. Protocol-aware validation is a first-class concern

`/Users/mrc/Projects/ClawX/electron/services/providers/provider-validation.ts`
does not validate all providers the same way. It distinguishes at least:

- `openai-completions`
- `openai-responses`
- `anthropic-messages`
- provider-specific auth styles such as query-key or Anthropic headers

This is especially relevant for `custom-openai` and `custom-anthropic`: the protocol family must drive validation behavior, endpoint normalization, and UX hints.

#### 5. Backward-compatible API migration strategy

`/Users/mrc/Projects/ClawX/electron/api/routes/providers.ts` keeps:

- newer `provider-accounts` routes
- deprecated legacy provider routes

That is a good migration pattern for Nexu too: ship the better config/account model first, then keep transitional facades long enough to migrate consumers safely.

### ClawX patterns to avoid copying directly

ClawX is helpful, but Nexu should not copy everything as-is.

#### 1. Single generic `custom` provider type is too coarse

ClawX uses one generic `custom` provider type in `electron/shared/providers/registry.ts`.

For Nexu, that is not enough because:

- OpenAI-compatible and Anthropic-compatible endpoints have meaningfully different protocol semantics
- validation and endpoint normalization need protocol awareness
- custom provider UX should make the compatibility family explicit

Nexu should keep separate templates/families:

- `custom-openai`
- `custom-anthropic`

#### 2. Runtime-key hashing should not become the canonical product identity

ClawX uses generated runtime keys such as hashed `custom-xxxxxxxx` forms.

That is useful internally, but for Nexu the user-facing persisted identity should remain more readable and stable, such as:

- `custom-openai/my-team-gateway`
- `custom-anthropic/siliconflow-claude`

If Nexu later needs a different compile-time/runtime key for OpenClaw compatibility, that key should remain a materialization detail rather than the primary persisted product identity.

#### 3. Do not let a separate account model become a second long-lived source of truth

ClawX's provider-account model is useful conceptually, but Nexu should avoid introducing:

- one account store
- one provider config store
- one compiled OpenClaw store

all as equal first-class truths.

For Nexu, the right adaptation is:

- canonical OpenClaw-aligned provider config remains the source of truth
- provider-instance/account semantics are represented within that canonical config shape

not as a separate parallel persistence system.

## Desired End State

### Principle

For model providers, OpenClaw-facing config becomes the canonical persisted domain model.

Nexu should treat provider state as:

- registry metadata + validation policy
- user-edited provider config in an OpenClaw-aligned shape
- derived UI state from config + runtime status

Not as:

- a separate Nexu-specific provider object model that must be translated everywhere

## Proposed Architecture

## 1. Add a centralized shared provider registry

Create a shared registry module, ideally under `packages/shared/src/model-providers/`.

Suggested files:

- `packages/shared/src/model-providers/provider-registry.ts`
- `packages/shared/src/model-providers/provider-aliases.ts`
- `packages/shared/src/model-providers/provider-types.ts`
- `packages/shared/src/model-providers/index.ts`

The registry should be metadata-only. It should not store user secrets or mutable config.

### Registry shape

Each provider entry should define at least:

- `id`
- `canonicalOpenClawId`
- `aliases`
- `displayName`
- `logo`
- `description`
- `region`
- `authModes` (`apiKey`, `oauth`, `none`, possibly multiple)
- `defaultBaseUrls`
- `apiKind` (`openai-completions`, `anthropic-messages`, `ollama`, etc.)
- `defaultHeaders` if needed
- `authHeader` if needed
- `primaryEnvKey`
- `additionalEnvKeys`
- `signupUrl`
- `docsUrl`
- `supportsCustomBaseUrl`
- `supportsModelDiscovery`
- `supportsProxyMode`
- `visibility` / `experimental` flags

Optional provider-specific capability flags:

- `requiresOauthRegion`
- `supportsOauthWithoutApiKey`
- `localProvider`
- `managedByAuthProfiles`

For custom compatibility endpoints, the registry must support distinct protocol families even when the UX concept is similar. In practice that means Nexu should support both:

- `custom-openai` for OpenAI-compatible endpoints
- `custom-anthropic` for Anthropic Messages-compatible endpoints

These should be separate registry entries because they differ in runtime API semantics, request shaping, and compatibility expectations.

In addition, the product should support **user-defined custom provider instances**, not just one built-in static custom provider entry.

That means the system must support multiple saved custom providers such as:

- `Custom0`
- `Custom1`
- team-specific gateways
- self-hosted vendor-compatible endpoints

Each custom provider instance should declare which protocol family it implements:

- OpenAI-compatible
- Anthropic-compatible

So the registry should distinguish between:

- **provider templates / provider families**: `custom-openai`, `custom-anthropic`
- **user-created provider instances**: `custom-openai/my-team-gateway`, `custom-anthropic/siliconflow-claude`, etc.

### Rules

- all provider id normalization must go through this registry
- all controller support checks must come from this registry
- all web display metadata must come from this registry
- all provider-specific compiler behavior must be derived from registry policy, not ad hoc branching scattered across files

## 2. Introduce one canonical provider-id normalizer

Copy the Qclaw pattern conceptually:

- canonical provider id lookup
- alias candidate expansion
- runtime id normalization

Examples Nexu needs immediately:

- `gemini -> google` or `google -> google` with a display alias of Gemini
- `openai-codex -> openai` for identity grouping, while still preserving runtime-specific auth/profile handling where needed
- `kimi -> moonshot`
- `glm -> zai`
- `minimax-portal -> minimax`

Every entry path should use the same normalization logic:

- API requests
- persisted config reads
- compiler lookups
- runtime status reconciliation
- web filtering/grouping

## 3. Replace `config.providers` with an OpenClaw-aligned model config document

Today Nexu stores provider config in `config.providers` and compiles to OpenClaw `models.providers`.

Target state:

- persist provider configuration in an OpenClaw-aligned structure inside Nexu config
- make that structure the canonical editable state
- compile only thin runtime projections where necessary
- support both built-in provider entries and user-created custom provider instances

Suggested new persisted shape inside Nexu config:

```ts
config.models = {
  mode: "merge",
  providers: {
    openai: {
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      authMode: "apiKey",
      apiKeyRef: "secret://providers/openai/api-key",
      models: [{ id: "gpt-4o" }, { id: "gpt-4.1" }],
    },
    minimax: {
      enabled: true,
      authMode: "oauth",
      oauthRegion: "cn",
      oauthProfileRef: "auth://minimax/default",
      models: [{ id: "MiniMax-M2.5" }],
    },
    byok_openai: {
      enabled: true,
      baseUrl: "https://my-proxy.example.com/v1",
      authMode: "apiKey",
      apiKeyRef: "secret://providers/byok_openai/api-key",
      models: [{ id: "gpt-4o" }],
    },
    "custom-openai/my-team-gateway": {
      enabled: true,
      displayName: "My Team Gateway",
      baseUrl: "https://llm.example.com/v1",
      authMode: "apiKey",
      apiKeyRef: "secret://providers/custom-openai/my-team-gateway/api-key",
      models: [{ id: "gpt-4o-mini" }],
    },
    "custom-anthropic/siliconflow-claude": {
      enabled: true,
      displayName: "SiliconFlow Claude",
      baseUrl: "https://api.siliconflow.cn",
      authMode: "apiKey",
      apiKeyRef:
        "secret://providers/custom-anthropic/siliconflow-claude/api-key",
      models: [{ id: "claude-sonnet-compatible" }],
    },
  },
}
```

Notes:

- `enabled`, `authMode`, `oauthRegion`, and similar editor metadata may exist in Nexu persistence even if OpenClaw ignores some of them directly
- secrets should remain outside plain config when possible; use refs or the existing secure persistence path
- the top-level persisted shape should still be OpenClaw-aligned enough that writing OpenClaw config becomes mostly structural copying + secret resolution

### Custom provider instance model

To support the UX shown in the reference image, Nexu should treat custom providers as first-class saved instances rather than a single toggleable built-in row.

Required capabilities:

- users can create multiple custom providers
- each custom provider has its own display name
- each custom provider has its own base URL
- each custom provider has its own auth/secret source
- each custom provider chooses an API protocol family (`openai-completions` or `anthropic-messages`)
- each custom provider maintains its own enabled state and model list

Recommended distinction:

- **registry/template identity** answers: what kind of provider is this?
- **instance identity** answers: which saved custom endpoint is this?

Suggested instance fields in persisted config:

- `providerTemplateId`: `custom-openai` or `custom-anthropic`
- `instanceId`: stable user-created id
- `displayName`: user-facing label such as `Custom1`
- `baseUrl` / `baseUrlEnv`
- `credentialSource`
- `apiKeyEnv` / `apiKeySecretRef`
- `apiKind`: derived from template but may also be persisted for migration clarity

This keeps custom providers compatible with a centralized registry while still allowing arbitrary user-created endpoints.

### Runtime key strategy for custom instances

ClawX confirms that multi-instance custom providers need a dedicated runtime-key strategy.

Nexu should make this explicit in the plan.

Recommended rule:

- persisted key stays human-readable and stable
- compiler may derive a different OpenClaw runtime key only if required for compatibility or collision avoidance
- the mapping from persisted key -> runtime key must be deterministic and reversible in diagnostics

Recommended examples:

- persisted key: `custom-openai/my-team-gateway`
- runtime key: either the same key if OpenClaw tolerates it, or a derived key such as `custom-openai__my-team-gateway`

- persisted key: `custom-anthropic/siliconflow-claude`
- runtime key: either the same key or a normalized derived runtime-safe key

Non-negotiable constraints:

- two custom instances must never collide at runtime
- runtime diagnostics must still be able to map runtime key back to saved instance
- model refs must remain deterministic across restarts

## 4. Treat compiler as a thin projection layer

`apps/controller/src/lib/openclaw-config-compiler.ts` should stop being the place where provider support is defined.

Its future job should be limited to:

- normalize provider ids via shared registry
- resolve secrets and oauth credentials into the final runtime config
- filter disabled providers
- write final OpenClaw-safe provider records
- write `auth-profiles.json` for providers that must remain auth-profile-driven
- preserve existing runtime-specific shaping where OpenClaw requires it

It should no longer be the primary owner of:

- provider support list
- provider display metadata
- alias system
- base URL defaults
- scattered provider capability policy

## 5. Keep sync service operational, but remove provider semantics from it

`apps/controller/src/services/openclaw-sync-service.ts` should remain the orchestration boundary for:

- compile current config
- write config files
- write auth profiles
- write runtime plugins/templates
- push config if changed

But it should not decide provider support or provider identity.

Target split:

- registry: provider identity and capability metadata
- persisted config: source-of-truth provider state
- compiler: final runtime materialization
- sync service: transport/orchestration only

## 6. Derive web provider UX from shared registry + saved model config

Replace `apps/web/src/pages/models.tsx` hardcoded `PROVIDER_META` and provider-specific support logic with data derived from:

- shared provider registry
- saved provider config from controller
- runtime status

The web page should ask:

- which providers exist in the registry?
- which of them are visible in this product tier?
- which of them are configured in saved model config?
- which of them are active/authenticated in runtime status?
- which custom provider instances exist for a given custom template/family?

Not:

- which providers does this page happen to know about in a local map?

## Proposed Registry Schema

Illustrative shape:

```ts
export interface ProviderRegistryEntry {
  id: string;
  canonicalOpenClawId: string;
  aliases?: string[];
  displayName: string;
  logo?: string;
  description?: string;
  region?: "global" | "china" | "local";
  authModes: Array<"apiKey" | "oauth" | "none">;
  primaryEnvKey?: string;
  additionalEnvKeys?: string[];
  signupUrl?: string;
  docsUrl?: string;
  supportsCustomBaseUrl?: boolean;
  defaultBaseUrls?: string[];
  apiKind: "openai-completions" | "anthropic-messages" | "ollama";
  authHeader?: boolean;
  defaultHeaders?: Record<string, string>;
  managedByAuthProfiles?: boolean;
  requiresOauthRegion?: boolean;
  supportsModelDiscovery?: boolean;
  supportsProxyMode?: boolean;
  experimental?: boolean;
  hidden?: boolean;
}
```

Helper APIs should include:

- `listProviderRegistryEntries()`
- `getProviderRegistryEntry(id)`
- `normalizeProviderId(id)`
- `getProviderAliasCandidates(id)`
- `isKnownProviderId(id)`
- `getDefaultProviderBaseUrls(id)`
- `getProviderUiMetadata(id)`
- `getProviderRuntimePolicy(id)`

For custom providers, add template-oriented helpers such as:

- `isCustomProviderTemplate(id)`
- `getCustomProviderProtocolFamily(id)`
- `buildCustomProviderKey(templateId, instanceId)`
- `parseCustomProviderKey(key)`

Recommended key model:

- built-in providers use stable keys such as `openai`, `anthropic`, `mistral`
- custom instances use composite keys such as:
  - `custom-openai/<instance-id>`
  - `custom-anthropic/<instance-id>`

This avoids pretending that all custom providers are the same provider entry.

## Provider Inventory: Qclaw Additions Missing in Nexu

Qclaw providers not currently represented in Nexu's support list:

- `qwen`
- `volcengine`
- `qianfan`
- `xiaomi`
- `github-copilot`
- `mistral`
- `xai`
- `together`
- `huggingface`
- `byteplus`
- `venice`
- `chutes`
- `vllm`
- `custom-openai`

In addition, Nexu should add a new registry/provider concept that does not currently exist in either hardcoded Nexu support lists or the Qclaw reference list:

- `custom-anthropic`

Nexu should also explicitly support **multiple user-created instances** under:

- `custom-openai/*`
- `custom-anthropic/*`

Notes:

- Qclaw's `gemini` should map into Nexu's canonical `google` identity or Nexu should rename its canonical id to `gemini`; do not keep both as first-class persisted identities.
- Nexu-only providers such as `siliconflow` and `ppio` should stay in the registry too.
- `kimi` and `glm` should likely become aliases only, not separate canonical identities, because Nexu already remaps them to `moonshot` and `zai` in compilation.

## Recommended Exposure Strategy for New Providers

Add them in two layers:

### Layer 1. Registry support

Add all missing Qclaw providers to the shared registry immediately.

This enables:

- unified identity handling
- runtime/status mapping
- future provider enablement without architecture work

### Layer 2. Product exposure

Expose providers in the Models UI in phases:

- Phase A: `mistral`, `xai`, `together`, `huggingface`, `vllm`, `custom-openai`, `qwen`, `volcengine`, `qianfan`
- Phase B: `byteplus`, `venice`, `github-copilot`, `xiaomi`, `chutes`

Rationale:

- some providers are simple API-key/custom-endpoint additions
- some may need auth-policy/product-copy decisions before broad UI exposure

`custom-anthropic` should be exposed alongside `custom-openai` in the early phase because it is architecturally important for the new registry design even if the initial UX is minimal.

For product UX, custom providers should be shown as a dedicated subsection that supports:

- listing saved custom instances
- adding a new custom instance
- editing an existing custom instance
- choosing protocol family: OpenAI-compatible vs Anthropic-compatible

This should match the reference interaction pattern more closely than a single hardcoded `custom-openai` row.

ClawX also suggests one additional refinement: treat the custom provider list as an **account/instance list**, not as pseudo-built-in vendors. In practice this means the UI should clearly separate:

- built-in provider families/vendors
- saved provider instances/accounts

This will scale better once users have multiple custom gateways or multiple accounts for the same vendor.

## API and Persistence Changes

## 1. New shared schemas

Add shared schemas for:

- provider registry DTOs
- normalized editable model-provider config
- provider runtime status reconciliation shape

Suggested locations:

- `packages/shared/src/schemas/provider-registry.ts`
- `packages/shared/src/schemas/model-provider-config.ts`

## 2. Evolve controller config schema

Update `apps/controller/src/store/schemas.ts` to introduce canonical model-provider persistence, for example:

- add `models` section to Nexu config schema if absent at the controller store level
- mark `providers` as legacy/transitional
- support read compatibility from old `providers` array during migration

## 3. Evolve routes

Current provider CRUD routes in `apps/controller/src/routes/model-routes.ts` are provider-id centric.

Target direction:

- keep compatibility routes temporarily
- add config-document-centric routes, e.g.:
  - `GET /api/v1/model-providers/registry`
  - `GET /api/v1/model-providers/config`
  - `PUT /api/v1/model-providers/config`
  - optional scoped helpers for updating one provider entry

ClawX suggests an additional useful route model for editor ergonomics:

- instance-oriented helper routes for CRUD, validation, and default selection

Recommended optional helpers:

- `POST /api/v1/model-providers/instances`
- `PUT /api/v1/model-providers/instances/{instanceKey}`
- `DELETE /api/v1/model-providers/instances/{instanceKey}`
- `POST /api/v1/model-providers/instances/{instanceKey}/validate`

This makes the API mirror the new source of truth.

## Migration Plan

## Phase 0. Registry foundation

1. add shared provider registry
2. add alias normalization helpers
3. add tests for normalization and registry completeness
4. move provider display metadata out of `apps/web/src/pages/models.tsx`
5. replace `byok-providers.ts` support checks with registry lookups
6. define custom-provider instance key format and parsing helpers

Outcome:

- one provider catalog
- no user-visible persistence change yet

## Phase 1. Dual-read compatibility

1. add new persisted `config.models.providers` shape
2. keep reading legacy `config.providers`
3. build a compatibility adapter:
   - legacy `config.providers` -> normalized model-provider config
4. make compiler consume only the normalized model-provider config
5. keep writing both shapes temporarily if needed for rollback safety
6. add support for composite custom-provider instance keys
7. define persisted-key <-> runtime-key mapping rules

Outcome:

- compiler/provider logic runs on one shape
- legacy configs continue to work

## Phase 2. Web migration

1. change web Models page to load registry DTOs and normalized model-provider config
2. drive provider cards/forms from registry metadata
3. remove page-local provider metadata maps and most provider-specific branching
4. make model grouping and configured-provider extraction work from saved config + runtime status
5. add custom-provider instance CRUD UX:
   - add custom provider
   - select protocol family
   - edit display name / base URL / credential source
   - list multiple custom providers
6. add protocol-aware validation UX and messages for custom providers

Outcome:

- adding providers becomes largely registry-driven

## Phase 3. OpenClaw SSoT cutover

1. make `config.models.providers` the only canonical persisted provider config
2. make compiler mostly a secret-resolution/materialization step
3. stop persisting the legacy `config.providers` array
4. keep migration-on-read for old configs for one release window
5. add an explicit migration version marker

Outcome:

- OpenClaw model config becomes the single source of truth

## Phase 4. Cleanup

1. delete `apps/controller/src/lib/byok-providers.ts`
2. delete legacy provider-only web metadata maps
3. delete compatibility adapter once migration window closes
4. remove controller code paths that still assume `config.providers`

## Detailed Module Plan

### `packages/shared/src/model-providers/*`

New source of truth for:

- provider identity
- alias normalization
- UI metadata
- runtime capability policy
- default endpoints

### `apps/controller/src/store/schemas.ts`

Changes:

- introduce canonical `models.providers` persistence shape
- mark `providers` as legacy
- add migration helpers

### `apps/controller/src/lib/openclaw-config-compiler.ts`

Changes:

- consume normalized model-provider config only
- move hardcoded defaults/remapping/capabilities into shared registry
- keep only runtime materialization logic here
- add deterministic persisted-key -> runtime-key mapping for multi-instance custom providers
- keep runtime-safe key derivation observable in diagnostics

### `apps/controller/src/services/openclaw-sync-service.ts`

Changes:

- no major orchestration rewrite required
- remove hidden provider semantics assumptions
- diff/push based on canonical compiled config only

### `apps/controller/src/routes/model-routes.ts`

Changes:

- add registry/config-document routes
- keep existing CRUD routes as transitional façade if needed
- add instance-level validate helpers with protocol-aware validation behavior

### `apps/web/src/pages/models.tsx`

Changes:

- render provider list/forms from shared registry data
- remove hardcoded `PROVIDER_META`
- reduce provider-specific conditionals to registry capability checks
- add a custom-provider instance list separated from built-in providers
- support add/edit/delete flows for `custom-openai/*` and `custom-anthropic/*`

## Sync Model: Before vs After

### Today

`Nexu config.providers -> compiler-specific provider logic -> OpenClaw models.providers`

### Target

`Nexu config.models.providers (OpenClaw-aligned SSoT) -> thin materialization -> OpenClaw config`

This improves:

- debuggability
- diff stability
- runtime reconciliation
- provider addition cost

## Secrets and Auth Handling

OpenClaw model config should be the source of truth for provider structure, not necessarily the literal plaintext secret store.

Recommended rule:

- provider structure and enabled state live in canonical model config
- secrets remain in secure controller-managed storage or referenced secret slots
- compiler resolves secret refs at write time
- OAuth-backed providers continue to write `auth-profiles.json` when required by OpenClaw

This preserves SSoT without forcing insecure plaintext persistence.

## Detailed Plan for Env Consumption

Env-backed secret consumption should be the default safety model for model providers whenever possible.

The goal is to avoid storing long-lived API secrets directly in plain-text config files such as Nexu config snapshots or persisted OpenClaw config artifacts.

### Why env-backed consumption is safer

- secrets do not need to live in user-editable JSON files
- accidental git adds, debug dumps, and log leaks become less likely
- rotating a provider key does not require rewriting the full config document shape
- packaged desktop/runtime boot can inject secrets at process start without exposing them in the web layer
- OpenClaw can still receive the final resolved runtime secret only at the materialization boundary

### Principle

The canonical provider config should describe **what secret is needed**, not necessarily embed the secret value itself.

Preferred order of secret sources for provider credentials:

1. OAuth/auth-profile state when the provider supports it
2. controller-managed secret store / secure OS-backed storage
3. process environment variables
4. plain-text config only as a compatibility fallback during migration

### Registry metadata for env consumption

The shared provider registry should explicitly describe env bindings.

Recommended additional registry fields:

- `primaryEnvKey`
- `additionalEnvKeys`
- `baseUrlEnvKey` for custom endpoint providers where endpoint can also be env-backed
- `supportsEnvKeyAuth`
- `supportsEnvBaseUrl`
- `preferredSecretSource` (`oauth` | `secret-store` | `env` | `config`)

Examples:

- `openai` -> `OPENAI_API_KEY`
- `anthropic` -> `ANTHROPIC_API_KEY`
- `google`/Gemini -> `GEMINI_API_KEY`
- `openrouter` -> `OPENROUTER_API_KEY`
- `mistral` -> `MISTRAL_API_KEY`
- `xai` -> `XAI_API_KEY`
- `together` -> `TOGETHER_API_KEY`
- `huggingface` -> `HF_TOKEN`
- `custom-openai` -> `OPENAI_API_KEY` + optional `OPENAI_BASE_URL`
- `custom-anthropic` -> `ANTHROPIC_API_KEY` + optional `ANTHROPIC_BASE_URL`
- `ollama` -> optional `OLLAMA_HOST` and optional `OLLAMA_API_KEY`
- `vllm` -> `VLLM_API_KEY` + `VLLM_BASE_URL`

### Canonical persisted config should use secret references, not raw keys

Instead of this:

```json
{
  "models": {
    "providers": {
      "openai": {
        "apiKey": "sk-..."
      }
    }
  }
}
```

Prefer this:

```json
{
  "models": {
    "providers": {
      "openai": {
        "credentialSource": "env",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      "custom-anthropic": {
        "credentialSource": "env",
        "apiKeyEnv": "ANTHROPIC_API_KEY",
        "baseUrlSource": "env",
        "baseUrlEnv": "ANTHROPIC_BASE_URL"
      }
    }
  }
}
```

Or, when using controller-managed secure storage:

```json
{
  "models": {
    "providers": {
      "openai": {
        "credentialSource": "secret-store",
        "apiKeySecretRef": "secret://providers/openai/api-key"
      }
    }
  }
}
```

### Proposed source fields

For each sensitive provider field, support explicit source metadata rather than implicit mixed behavior.

Suggested fields:

- `credentialSource`: `"oauth" | "secret-store" | "env" | "config"`
- `apiKeyEnv?: string`
- `apiKeySecretRef?: string`
- `apiKey?: string` (legacy fallback only)
- `baseUrlSource?: "config" | "env"`
- `baseUrlEnv?: string`
- `baseUrl?: string`

This keeps the config self-describing without embedding secrets by default.

### Materialization behavior in compiler

`apps/controller/src/lib/openclaw-config-compiler.ts` should resolve credentials with a strict precedence order.

Suggested resolution algorithm:

1. if `credentialSource === "oauth"`, read OAuth credential or auth-profile state
2. if `credentialSource === "secret-store"`, resolve `apiKeySecretRef`
3. if `credentialSource === "env"`, read `apiKeyEnv` from process env
4. if `credentialSource === "config"`, use raw `apiKey`
5. if no explicit source is set, fall back to registry `primaryEnvKey`, then legacy persisted fields for migration compatibility

For base URLs:

1. if `baseUrlSource === "env"`, read `baseUrlEnv`
2. otherwise use persisted `baseUrl`
3. otherwise use registry default base URL(s)

### Validation rules

The controller should validate source declarations before sync.

Examples:

- if `credentialSource === "env"`, the selected env key must be non-empty and present at runtime
- if `credentialSource === "secret-store"`, the referenced secret must exist
- if `credentialSource === "oauth"`, provider must support OAuth and credential state must exist
- if `baseUrlSource === "env"`, the env value must parse as a valid URL
- do not allow `apiKey` plain-text writes in normal UI flows except behind legacy import/migration paths

### UI behavior

The web UI should default to safer secret handling.

Preferred UX:

- provider form defaults to `env` or `secret-store` when supported
- raw API-key textareas should be clearly labeled as compatibility/manual mode
- UI should display effective env key names from registry metadata
- UI should allow choosing a custom env key when needed for advanced setups
- UI should avoid ever re-showing stored secret values

For custom provider instances specifically:

- the create form should ask for protocol family first: OpenAI-compatible or Anthropic-compatible
- the form should then show the correct base URL hint and env variable suggestions for that protocol family
- users should be able to create multiple named custom providers rather than overwriting a single global custom slot
- the list UI should clearly separate built-in providers from user-created custom providers
- validation should probe the correct protocol family automatically:
  - OpenAI-compatible -> `/models`, `/chat/completions`, or `/responses`-aware probing
  - Anthropic-compatible -> `/v1/messages`-aware probing with Anthropic auth headers

### Protocol-aware validation design

ClawX provides a useful reference here: provider validation should be protocol-aware, not vendor-name-aware only.

Nexu should make validation strategy a registry-driven concern.

Recommended validation profiles:

- `openai-completions`
- `openai-responses`
- `anthropic-messages`
- `google-query-key`
- provider-specific edge cases only where truly necessary

For custom provider instances:

- `custom-openai/*` should validate as OpenAI-compatible
- `custom-anthropic/*` should validate as Anthropic-compatible

This logic should live in one shared controller/backend validation module, not inside page components.

### Desktop/runtime env injection

For desktop-first Nexu, env consumption works best when secrets are injected only into the controller/OpenClaw runtime processes.

Recommended runtime model:

- secrets are loaded by the controller at startup from secure storage or configured env bindings
- controller resolves env-backed provider credentials before writing runtime materialized config
- when possible, OpenClaw child processes receive secrets via process env instead of persisted file content
- if OpenClaw requires file-level `apiKey` values, materialize them only into the final runtime file under the isolated runtime state directory, never back into user-facing Nexu config

### Logging and diagnostics rules

Env-backed secrets are only safer if observability stays disciplined.

Rules:

- never log resolved env values
- never log full secret refs if they reveal sensitive naming conventions unnecessarily
- diagnostics may report source type (`env`, `secret-store`, `oauth`) and env key name, but not resolved values
- config diff logs should redact materialized provider credentials before emission

### Migration strategy for existing plain-text provider configs

During migration from today's `config.providers` model:

1. continue reading plain-text `apiKey` fields for compatibility
2. when editing a provider in new UI flows, encourage migration to `env` or `secret-store`
3. optionally offer a one-click migration path:
   - move raw secret into secure store
   - replace raw `apiKey` with `apiKeySecretRef`
4. mark raw `apiKey` persistence as deprecated
5. eventually restrict raw `apiKey` writes to import/debug-only paths

### Success criterion for env consumption

The redesign is safer when:

- provider config usually contains refs or env bindings rather than raw API keys
- controller/OpenClaw runtime can still resolve credentials deterministically
- users can rotate secrets without rewriting provider config structure
- logs, diffs, and exported config snapshots do not leak provider secrets

## Draft Schema for `packages/shared/src/schemas/model-provider-config.ts`

Below is a recommended first-pass schema draft for the new canonical persisted provider config.

This is intentionally a draft, not a final API contract. The goal is to make the target shape concrete enough to guide implementation.

### Design goals of the schema

- OpenClaw-aligned overall shape
- explicit secret-source metadata
- registry-driven provider identity
- compatible with API-key, OAuth, and custom endpoint providers
- supports migration from legacy plain-text provider config

### Draft Zod schema

```ts
import { z } from "zod";

export const providerCredentialSourceSchema = z.enum([
  "oauth",
  "secret-store",
  "env",
  "config",
]);

export const providerBaseUrlSourceSchema = z.enum(["config", "env"]);

export const providerAuthModeSchema = z.enum(["apiKey", "oauth", "none"]);

export const providerOauthRegionSchema = z.enum(["global", "cn"]);

export const modelProviderModelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const modelProviderConfigSchema = z
  .object({
    providerTemplateId: z.string().min(1).optional(),
    instanceId: z.string().min(1).optional(),
    enabled: z.boolean().default(true),

    authMode: providerAuthModeSchema.optional(),
    credentialSource: providerCredentialSourceSchema.optional(),

    apiKeyEnv: z.string().min(1).optional(),
    apiKeySecretRef: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),

    baseUrlSource: providerBaseUrlSourceSchema.optional(),
    baseUrlEnv: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),

    oauthRegion: providerOauthRegionSchema.nullable().optional(),
    oauthProfileRef: z.string().min(1).optional(),

    displayName: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    models: z.array(modelProviderModelEntrySchema).default([]),

    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.credentialSource === "env" && !value.apiKeyEnv) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKeyEnv"],
        message: "apiKeyEnv is required when credentialSource is 'env'",
      });
    }

    if (
      value.credentialSource === "secret-store" &&
      !value.apiKeySecretRef
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKeySecretRef"],
        message:
          "apiKeySecretRef is required when credentialSource is 'secret-store'",
      });
    }

    if (value.credentialSource === "config" && !value.apiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKey"],
        message: "apiKey is required when credentialSource is 'config'",
      });
    }

    if (value.baseUrlSource === "env" && !value.baseUrlEnv) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrlEnv"],
        message: "baseUrlEnv is required when baseUrlSource is 'env'",
      });
    }
  });

export const modelsProviderMapSchema = z.record(
  z.string().min(1),
  modelProviderConfigSchema,
);

export const persistedModelsConfigSchema = z.object({
  mode: z.enum(["merge", "replace"]).default("merge"),
  providers: modelsProviderMapSchema.default({}),
});
```

### Notes on the draft

#### 1. Provider ids stay as map keys

The `providers` object should remain keyed by normalized canonical provider id or provider key:

- `openai`
- `anthropic`
- `custom-openai`
- `custom-anthropic`
- `byok_openai` if proxied/custom routing remains a distinct persisted identity
- `custom-openai/my-team-gateway`
- `custom-anthropic/siliconflow-claude`

This keeps the structure close to OpenClaw `models.providers`.

For custom providers, the recommendation is:

- map key = instance key
- `providerTemplateId` = protocol family template
- `instanceId` = stable custom instance id

This supports both registry-derived behavior and user-defined multiplicity.

#### 2. `apiKey` stays only for compatibility

`apiKey` is still present in the draft schema, but only as a transitional compatibility field.

Normal UI flows should prefer:

- `apiKeyEnv`
- `apiKeySecretRef`
- OAuth-backed references

#### 3. `headers` is intentionally optional

Some providers or custom compatibility endpoints may need custom headers later.

This should exist in the schema, but product UI should expose it cautiously.

#### 4. `metadata` is for migration and low-risk extensibility

It can temporarily hold provider-specific fields during migration, but should not become a dumping ground for core semantics.

## Draft Registry DTO Schema

The web app will likely need a serialized registry DTO from the controller/shared package.

Suggested draft:

```ts
export const providerRegistryEntrySchema = z.object({
  id: z.string().min(1),
  canonicalOpenClawId: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),

  displayName: z.string().min(1),
  logo: z.string().optional(),
  description: z.string().optional(),
  region: z.enum(["global", "china", "local"]).optional(),

  authModes: z.array(providerAuthModeSchema).min(1),
  primaryEnvKey: z.string().optional(),
  additionalEnvKeys: z.array(z.string()).default([]),
  baseUrlEnvKey: z.string().optional(),

  signupUrl: z.string().url().optional(),
  docsUrl: z.string().url().optional(),

  supportsCustomBaseUrl: z.boolean().default(false),
  supportsEnvKeyAuth: z.boolean().default(true),
  supportsEnvBaseUrl: z.boolean().default(false),
  supportsModelDiscovery: z.boolean().default(false),
  supportsProxyMode: z.boolean().default(false),
  managedByAuthProfiles: z.boolean().default(false),
  requiresOauthRegion: z.boolean().default(false),

  apiKind: z.enum([
    "openai-completions",
    "anthropic-messages",
    "ollama",
  ]),
  authHeader: z.boolean().optional(),
  defaultBaseUrls: z.array(z.string().url()).default([]),
  defaultHeaders: z.record(z.string(), z.string()).optional(),

  experimental: z.boolean().default(false),
  hidden: z.boolean().default(false),
});

export const providerRegistryResponseSchema = z.object({
  providers: z.array(providerRegistryEntrySchema),
});
```

## Draft Examples

### Example: `openai`

```json
{
  "enabled": true,
  "authMode": "apiKey",
  "credentialSource": "env",
  "apiKeyEnv": "OPENAI_API_KEY",
  "models": [{ "id": "gpt-4o" }, { "id": "gpt-4.1" }]
}
```

### Example: `custom-openai`

```json
{
  "enabled": true,
  "providerTemplateId": "custom-openai",
  "instanceId": "my-team-gateway",
  "displayName": "My Team Gateway",
  "authMode": "apiKey",
  "credentialSource": "env",
  "apiKeyEnv": "OPENAI_API_KEY",
  "baseUrlSource": "env",
  "baseUrlEnv": "OPENAI_BASE_URL",
  "models": [{ "id": "my-model" }]
}
```

### Example: `custom-anthropic`

```json
{
  "enabled": true,
  "providerTemplateId": "custom-anthropic",
  "instanceId": "siliconflow-claude",
  "displayName": "SiliconFlow Claude",
  "authMode": "apiKey",
  "credentialSource": "env",
  "apiKeyEnv": "ANTHROPIC_API_KEY",
  "baseUrlSource": "env",
  "baseUrlEnv": "ANTHROPIC_BASE_URL",
  "models": [{ "id": "claude-custom" }]
}
```

### Example: `minimax` OAuth

```json
{
  "enabled": true,
  "authMode": "oauth",
  "credentialSource": "oauth",
  "oauthRegion": "cn",
  "oauthProfileRef": "auth://minimax/default",
  "models": [{ "id": "MiniMax-M2.5" }]
}
```

## Open Questions for Implementation

Before finalizing the schema in code, confirm:

1. whether `byok_*` remains a persisted identity or stays compile-only
2. whether base URLs should allow non-URL local values during development-only flows
3. whether `headers` should be user-editable or controller-internal only
4. whether `metadata` should remain in the stable schema or be limited to migration adapters
5. whether secrets should resolve only from env + secure store, with plain `apiKey` writes fully blocked in normal UI flows
6. whether OpenClaw runtime keys should preserve readable composite names or always normalize to a runtime-safe derived key

## Testing Plan

Add tests for:

### Registry

- every registry entry has valid canonical id and metadata
- alias normalization behaves deterministically
- no duplicate canonical ids or alias collisions

### Compiler

- every supported registry provider compiles correctly
- alias-only providers normalize to the right canonical provider
- direct vs proxy/custom endpoint behavior stays stable
- oauth-backed providers still materialize correctly
- `custom-anthropic` compiles with Anthropic-compatible API semantics rather than OpenAI-compatible semantics
- multiple custom provider instances can coexist without overwriting each other
- custom instance keys round-trip correctly through persistence, compilation, and UI state
- protocol-aware validation picks the correct probe strategy for custom OpenAI vs custom Anthropic instances
- persisted-key -> runtime-key mapping remains deterministic and collision-free

### Migration

- legacy `config.providers` migrates to canonical `config.models.providers`
- dual-read behavior is deterministic
- persisted configs round-trip without provider loss

### Web

- provider list renders from registry
- hidden/experimental flags behave correctly
- configured-provider grouping matches runtime status for aliased providers

## Risks

### 1. Dual-definition drift during migration

If `config.providers` and `config.models.providers` both remain writable for too long, they will diverge.

Mitigation:

- choose one canonical write path early
- keep the old shape read-only compatibility as soon as practical

### 2. Alias collisions

Adding Qclaw providers without a single alias normalizer will create duplicate provider identities.

Mitigation:

- land alias normalizer before adding provider exposure

### 3. Overstuffed registry

If registry entries begin to encode too much runtime behavior, the registry becomes a new monolith.

Mitigation:

- keep registry focused on metadata and declarative capability policy
- keep imperative runtime logic in compiler/materialization code

### 4. Product-surface sprawl

Adding all new providers directly to the UI may overwhelm users.

Mitigation:

- separate registry support from default UI exposure

### 5. Runtime key drift for custom instances

If runtime keys are derived inconsistently, custom providers may appear duplicated, lose model refs, or fail cleanup.

Mitigation:

- define one persisted-key <-> runtime-key mapping strategy early
- test round-trip mapping and stale cleanup explicitly

## What Not To Do

- do not keep `byok-providers.ts` and `PROVIDER_META` as permanent parallel systems after the registry lands
- do not let the sync service own provider semantics
- do not create another Nexu-only intermediate provider model if OpenClaw-aligned config already expresses the needed shape
- do not treat aliases like `kimi`, `glm`, and `gemini` as unrelated canonical providers
- do not block the registry migration on finishing bespoke UX for every new provider

## Recommended Implementation Order

1. shared provider registry + alias normalization
2. controller support checks and web metadata switched to registry
3. canonical `config.models.providers` persistence introduced
4. compiler switched to normalized config
5. new Qclaw providers added to registry
6. selected new providers exposed in UI
7. legacy `config.providers` removed

## Success Criteria

The redesign is successful when:

- adding a provider is primarily a registry entry + optional small adapter, not a cross-repo scavenger hunt
- controller and web use the same provider identity and metadata source
- OpenClaw model config is the canonical provider configuration model
- sync code pushes provider state without redefining what a provider is
- aliased/runtime provider ids reconcile correctly in config, status, and UI
