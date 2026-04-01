# BYOK Proxy Mode Minimal-Change Plan

Date: 2026-03-28

## Context

Nexu currently decides whether a BYOK provider should be treated as a direct provider or a proxied provider by comparing the saved `baseUrl` against a single default URL.

This is fragile:

- a vendor can change its canonical default URL over time
- multiple equivalent official URLs may exist
- persisted configs can silently switch routing mode after a default changes
- provider identity and connection mode are currently inferred from URL equality rather than stored explicitly

The recent SiliconFlow `.com` → `.cn` default change exposed this weakness. Existing users with the old persisted default could be reclassified into `byok_siliconflow` proxy mode even though they were still using the vendor's direct endpoint.

## Goal

Stabilize BYOK routing behavior with the smallest safe change.

This plan intentionally avoids a larger schema or product redesign. It does **not** introduce a new persisted `connectionMode` field yet.

## Non-Goals

- redesign the full BYOK provider model
- change OpenClaw runtime semantics
- migrate all providers to an explicit direct/proxy mode field
- add new user-facing settings in this phase

## Product Decision for This Phase

We should **not** add a UI-level "proxy mode" toggle in this minimal-change phase.

Reasoning:

- the current problem is a routing-classification regression, not a missing user control
- adding a UI toggle would expand scope into schema, API, persistence, migration, and product copy changes
- the minimal fix can be delivered safely in the compiler layer without introducing a new visible concept for users

User-facing behavior for this phase should remain simple:

- official endpoints are treated as direct connections
- custom gateway endpoints are treated as proxy connections

If Nexu later moves to an explicit persisted connection mode, that should be handled as a separate design phase with coordinated backend, schema, and UI changes.

## Minimal-Change Proposal

### 1. Keep the current direct-vs-proxy architecture

Retain the existing split between:

- direct provider keys such as `siliconflow`
- proxied provider keys such as `byok_siliconflow`

Retain the current model ID shaping rules as well.

This keeps runtime behavior stable and avoids broader compatibility work.

### 2. Replace single-default comparison with default endpoint aliases

For each BYOK provider, define a small set of normalized URLs that should be treated as equivalent official direct endpoints.

For example, SiliconFlow should recognize both:

- `https://api.siliconflow.cn/v1`
- `https://api.siliconflow.com/v1`

Then update the proxied-mode check so that:

- if `baseUrl` matches any official alias, it stays in direct mode
- only truly custom endpoints enter proxy mode

This is the smallest change that fixes the current class of regressions.

### 3. Centralize endpoint alias logic

Do not scatter provider-specific exceptions across multiple call sites.

Instead, introduce one helper in the controller compiler layer that returns the accepted default endpoint aliases for a provider, including regional variants where needed.

This keeps the behavior auditable and makes future default endpoint changes safer.

### 4. Add regression tests around persisted legacy defaults

Add tests that explicitly verify:

- the new canonical default remains the preferred generated default
- legacy official URLs remain classified as direct
- a clearly custom non-official URL still enters proxy mode

These tests should focus on compiled provider key and model ID behavior, since that is where user-visible breakage emerges.

## Scope by Module

### 1. `apps/controller/src/lib/openclaw-config-compiler.ts`

This is the primary implementation module.

Current responsibilities in this area already include:

- resolving the OpenClaw provider identity
- deciding whether a BYOK provider is direct or proxied
- shaping compiled provider keys
- shaping compiled model IDs

Planned change in this file:

- keep canonical default URL generation unchanged via `resolveByokDefaultBaseUrl(...)`
- add a small helper that returns all accepted official default endpoint aliases for a provider
- update `isByokProviderProxied(...)` to compare against the alias set instead of a single URL
- leave `getByokProviderKey(...)` and `getByokProviderModelId(...)` behavior unchanged so downstream runtime expectations remain stable

Why this file should stay the primary decision point:

- it is already the boundary where Nexu turns saved provider config into compiled OpenClaw routing config
- changing the behavior here minimizes blast radius
- it avoids duplicating routing decisions in web UI, store logic, or runtime glue

### 2. `apps/controller/src/lib/provider-base-url.ts`

This module already provides URL normalization.

Planned change:

- likely no behavioral change needed for the minimal plan
- continue to use it as the single place for trimming and trailing-slash normalization

Constraint:

- do not add vendor-specific alias behavior here in the minimal phase
- keep this module generic and reusable

Reason:

- vendor alias semantics are routing policy, not generic URL normalization
- policy should remain in the compiler layer, where provider context is available

### 3. `apps/controller/tests/openclaw-config-compiler.test.ts`

This is the primary regression test module for the change.

Planned additions:

- canonical SiliconFlow default (`.cn`) still compiles to direct `siliconflow`
- legacy SiliconFlow default (`.com`) also compiles to direct `siliconflow`
- custom SiliconFlow proxy URL still compiles to `byok_siliconflow`
- model IDs remain stable across both canonical and legacy official defaults

Reason:

- this file already validates the compiler's routing and provider output behavior
- the regression is primarily a config-compilation problem, so this is the most direct test surface

### 4. `apps/controller/src/services/model-provider-service.ts`

This file manages provider defaults and verification behavior in the controller service layer.

Minimal-phase expectation:

- keep the canonical SiliconFlow default here aligned with the current official default (`.cn`)
- do not add alias-based routing logic here unless a verification bug specifically requires it

Why not duplicate the alias decision here:

- the current bug is caused by compiled routing classification, not by provider verification alone
- duplicating alias policy in both places increases drift risk

Possible follow-up only if needed:

- if provider verification or UI validation later needs to recognize legacy official defaults as equivalent, add a shared helper in a second step
- do not broaden this minimal plan unless a concrete failure path is identified

### 5. `apps/web/src/pages/models.tsx`

This file defines provider metadata shown in the web UI, including the default SiliconFlow URL.

Minimal-phase expectation:

- keep the displayed default URL aligned with the canonical current endpoint (`.cn`)
- do not expose a new user-facing "proxy mode" toggle in this phase

Reason:

- the goal is to fix backend routing stability with minimal product surface change
- adding new UI state would expand scope and likely require schema and migration work

UI guidance for this phase:

- keep showing the canonical SiliconFlow default URL
- do not expose a direct/proxy toggle yet
- do not require users to learn the internal term "proxy mode" to benefit from the fix

## Detailed Implementation Plan

### Step 1. Preserve a single canonical generated default

Continue treating one URL as the current official default for generation and display.

For SiliconFlow, that remains:

- `https://api.siliconflow.cn/v1`

This keeps:

- new config creation deterministic
- UI defaults simple
- service-layer defaults consistent

### Step 2. Add official endpoint alias resolution for classification only

Introduce a helper with a shape similar to:

```ts
function resolveByokDefaultBaseUrlAliases(input: {
  providerId: string;
  oauthRegion: "global" | "cn" | null;
}): string[]
```

Behavior:

- include the canonical default returned by `resolveByokDefaultBaseUrl(...)`
- optionally append legacy equivalent official URLs for providers that need them
- return normalized, comparison-ready values

Example for SiliconFlow:

- canonical: `https://api.siliconflow.cn/v1`
- legacy alias: `https://api.siliconflow.com/v1`

Important constraint:

- this helper exists to classify direct vs proxy mode
- it does not change which URL Nexu generates for new configs

### Step 3. Update proxied classification only

Refactor `isByokProviderProxied(...)` so it:

1. normalizes the saved `baseUrl`
2. resolves the provider's accepted default alias list
3. treats the provider as direct if the normalized URL is contained in that alias set
4. treats the provider as proxied only when the URL is outside that set

Important behavior details:

- `null` or empty `baseUrl` should continue to mean non-proxied direct mode
- provider-specific region logic such as MiniMax CN/global should continue to work unchanged
- direct-vs-proxy output format should not change for providers unrelated to this fix

### Step 4. Keep provider key and model ID shaping unchanged

Do not change the following functions beyond their dependency on the updated proxied check:

- `getByokProviderKey(...)`
- `getByokProviderModelId(...)`

Expected result:

- official canonical endpoint -> direct provider key
- official legacy endpoint -> same direct provider key
- custom gateway endpoint -> `byok_*` provider key

This is important because the rest of the compiled config and runtime path already assumes the current key/model shaping behavior.

### Step 5. Add explicit regression coverage

Add or update tests to cover the following matrix:

| Scenario | Expected provider key | Expected model ID form |
|---|---|---|
| SiliconFlow canonical `.cn` default | `siliconflow` | `Pro/...` |
| SiliconFlow legacy `.com` default | `siliconflow` | `Pro/...` |
| SiliconFlow custom proxy URL | `byok_siliconflow` | `siliconflow/Pro/...` |

Also verify:

- compiled agent default model stays stable in direct mode
- proxied mode still produces the prefixed model form expected by runtime routing

## Concrete Code Changes

### Change Set A: classification helper

Inside `openclaw-config-compiler.ts`:

- add a helper for accepted default alias resolution
- keep it near `resolveByokDefaultBaseUrl(...)` so canonical default generation and classification aliases stay visually coupled

Suggested structure:

- `resolveByokDefaultBaseUrl(...)` -> canonical default
- `resolveByokDefaultBaseUrlAliases(...)` -> canonical + legacy aliases for comparison

### Change Set B: proxied-mode decision

Inside `openclaw-config-compiler.ts`:

- replace the single `normalizedBaseUrl !== defaultBaseUrl` check
- use membership in a normalized alias set instead

This is the actual bug fix.

### Change Set C: regression tests

Inside `openclaw-config-compiler.test.ts`:

- add one test for canonical SiliconFlow direct behavior
- add one test for legacy SiliconFlow direct behavior
- add one test for custom proxy SiliconFlow behavior if it does not already exist

The tests should assert on compiled provider map entries rather than only on helper outputs.

That ensures we are verifying the full contract that affects runtime behavior.

## Risks and Mitigations

### Risk 1. Alias logic spreads into multiple layers

If the same vendor alias mapping gets reimplemented in the UI, service layer, and compiler layer, drift will reappear.

Mitigation:

- keep routing classification aliases in the compiler layer first
- only extract to a shared helper if a second real consumer appears

### Risk 2. Hidden provider-specific exceptions accumulate

If every provider gets ad hoc aliases without structure, the logic becomes hard to reason about.

Mitigation:

- keep alias additions small and explicit
- add them only for official equivalent endpoints, not generic pattern matching
- require regression coverage for each provider-specific alias addition

### Risk 3. Future maintainers assume aliases affect generated defaults

That would create confusion between "what URL Nexu writes" and "what URLs Nexu accepts as direct."

Mitigation:

- document clearly in code comments and tests that aliases are for classification only
- keep canonical default generation separate from alias resolution

## Verification Plan

Minimum verification after implementation:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Targeted logical verification:

1. create or compile a SiliconFlow provider with `baseUrl = null`
   - expect direct `siliconflow`
2. create or compile a SiliconFlow provider with `https://api.siliconflow.cn/v1`
   - expect direct `siliconflow`
3. create or compile a SiliconFlow provider with `https://api.siliconflow.com/v1`
   - expect direct `siliconflow`
4. create or compile a SiliconFlow provider with a custom gateway such as `https://models.example.com/v1`
   - expect `byok_siliconflow`

Optional manual verification:

- load a config with a persisted `.com` SiliconFlow base URL
- confirm compiled config does not flip to `byok_siliconflow`
- confirm runtime model selection stays in the same direct form as before the default switch

## Executable Checklist

### Preparation

- [ ] Confirm the current canonical SiliconFlow default remains `https://api.siliconflow.cn/v1`
- [ ] Confirm the minimal phase will not add a new persisted schema field such as `connectionMode`
- [ ] Confirm no UI copy or settings changes are in scope for this phase

### Controller Compiler Changes

- [ ] Open `apps/controller/src/lib/openclaw-config-compiler.ts`
- [ ] Locate `resolveByokDefaultBaseUrl(...)`
- [ ] Add a helper for accepted official endpoint aliases, near the canonical default resolver
- [ ] Ensure the helper includes the canonical default URL first
- [ ] Add SiliconFlow legacy alias support for `https://api.siliconflow.com/v1`
- [ ] Keep provider-specific alias logic in the compiler layer, not in generic URL normalization
- [ ] Refactor `isByokProviderProxied(...)` to compare the normalized saved URL against the accepted alias set
- [ ] Preserve the current behavior for `null` / empty `baseUrl`
- [ ] Preserve the current behavior for unrelated BYOK providers
- [ ] Do not change `getByokProviderKey(...)` semantics beyond using the updated proxied decision
- [ ] Do not change `getByokProviderModelId(...)` semantics beyond using the updated proxied decision

### Controller Service / UI Default Alignment

- [ ] Open `apps/controller/src/services/model-provider-service.ts`
- [ ] Confirm SiliconFlow canonical default is still `.cn`
- [ ] Do not add duplicate alias-based routing logic here unless a concrete verification bug requires it
- [ ] Open `apps/web/src/pages/models.tsx`
- [ ] Confirm the displayed SiliconFlow default remains `.cn`
- [ ] Do not add a user-facing proxy-mode toggle in this phase

### Regression Test Coverage

- [ ] Open `apps/controller/tests/openclaw-config-compiler.test.ts`
- [ ] Add or confirm a test for canonical SiliconFlow direct behavior (`.cn`)
- [ ] Add or confirm a test for legacy SiliconFlow direct behavior (`.com`)
- [ ] Add or confirm a test for a custom SiliconFlow proxy URL entering `byok_siliconflow`
- [ ] Assert compiled provider keys, not only helper outputs
- [ ] Assert model ID shape in each scenario
- [ ] Assert compiled agent default model shape in direct mode

### Verification

- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm lint`
- [ ] Run `pnpm test`
- [ ] Verify the compiler keeps `.cn` as the generated/default official endpoint
- [ ] Verify a persisted `.com` SiliconFlow config still compiles as direct `siliconflow`
- [ ] Verify a custom non-official URL still compiles as `byok_siliconflow`

### Review Guardrails

- [ ] Check that canonical default generation and alias-based classification are still clearly separated in code
- [ ] Check that alias handling is limited to official equivalent endpoints only
- [ ] Check that no unrelated providers changed routing behavior
- [ ] Check that the implementation does not introduce a hidden schema migration

### Optional Follow-Up Tracking

- [ ] Capture whether any second consumer needs shared alias logic outside the compiler layer
- [ ] If yes, document that as a separate follow-up instead of expanding this minimal change
- [ ] Note the longer-term option to move to explicit persisted `direct` / `proxy` connection mode

## Why This Is the Right Short-Term Move

- it fixes the current SiliconFlow regression without a config schema migration
- it preserves compatibility with existing compiled/runtime assumptions
- it avoids surprising persisted users when vendor defaults change
- it creates a safer bridge toward a future explicit `connectionMode` design

## Trade-Offs

This proposal improves robustness, but it does not solve the underlying design limitation.

Known limitations remain:

- direct vs proxy is still inferred, not explicitly modeled
- equivalent endpoint alias lists must be maintained manually
- edge cases may reappear if future providers have more complex endpoint families

Even so, this is a good minimal step because it reduces real user risk immediately without forcing a larger migration.

## Suggested Follow-Up

In a later phase, consider moving to an explicit persisted connection mode such as:

- `direct`
- `proxy`

That would separate provider identity from transport endpoint details and make the product behavior easier to explain to users.

If that later phase happens, the UI should likely use user-facing language such as:

- `Use official endpoint`
- `Use custom gateway`

rather than exposing the internal term `proxy mode` directly.

But that should be treated as a deliberate follow-up design, not part of this minimal fix.

## Implementation Sketch

Primary area:

- `apps/controller/src/lib/openclaw-config-compiler.ts`

Supporting areas:

- `apps/controller/tests/openclaw-config-compiler.test.ts`
- `apps/controller/src/services/model-provider-service.ts` (canonical default only, no new routing policy unless required)
- `apps/web/src/pages/models.tsx` (canonical default only)

Expected change shape:

1. keep canonical default URL generation unchanged
2. add a helper that returns accepted default endpoint aliases
3. update proxied classification to check membership in that alias set
4. add regression coverage for legacy persisted official URLs

## Expected User Outcome

After this change:

- users on the latest official default stay in direct mode
- users with older persisted official defaults also stay in direct mode
- only users who intentionally point to a custom gateway are treated as proxy mode

This matches user expectations more closely while keeping the current architecture intact.
