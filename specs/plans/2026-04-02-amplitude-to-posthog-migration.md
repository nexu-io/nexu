# Amplitude to PostHog Migration Plan

Date: 2026-04-02

## Context

Nexu currently sends product analytics to Amplitude from three different surfaces:

- the web app renderer
- the desktop renderer
- the controller service

The current implementation is functional, but it couples Nexu to Amplitude-specific SDKs, env names, and HTTP ingestion paths.

The migration goal is to move product analytics from Amplitude to PostHog without losing the existing event model, while keeping the rollout low-risk and easy to validate.

## Goals

1. Replace Amplitude as the primary analytics provider with PostHog.
2. Preserve the existing event taxonomy where practical so dashboards can be rebuilt with minimal product-side churn.
3. Keep web, desktop renderer, and controller analytics behavior aligned.
4. Minimize code churn by migrating through the existing analytics seams instead of rewriting every call site.
5. Make rollout reversible until PostHog capture is verified in production.
6. Update build/env/docs references so Amplitude is no longer the active analytics path.

## Non-goals

- Redesigning Nexu's entire analytics taxonomy in this phase.
- Introducing a large analytics abstraction package or a new workspace package.
- Shipping feature flags, experiments, or surveys as part of the initial migration.
- Rewriting historic dashboards before the ingestion path is stable.
- Modifying OpenClaw source code.

## Current State Summary

### Web app

- `apps/web/src/main.tsx` initializes Amplitude directly with `@amplitude/unified`.
- `apps/web/src/lib/tracking.ts` is the main frontend analytics seam. Most web event calls already flow through `track(...)`, `identify(...)`, and `setUserId(...)`.
- There are many downstream event call sites across `apps/web/src/pages/`, `apps/web/src/components/`, and `apps/web/src/layouts/`, but most of them do not import Amplitude directly.

### Desktop renderer

- `apps/desktop/src/main.tsx` initializes Amplitude directly.
- The desktop renderer appears to use Amplitude mainly for bootstrap-level telemetry today, not for a large custom event surface.

### Controller

- `apps/controller/src/services/analytics-service.ts` sends server-side events directly to `https://api2.amplitude.com/2/httpapi`.
- The controller event stream currently includes:
  - `user_message_sent`
  - `skill_use`
  - `nexu_first_conversation_start`
- Controller analytics are gated by `env.amplitudeApiKey`.

### Env / runtime / CI wiring

- `apps/controller/src/app/env.ts` reads `AMPLITUDE_API_KEY` and `VITE_AMPLITUDE_API_KEY`.
- `apps/desktop/shared/runtime-config.ts` includes `AMPLITUDE_API_KEY` in packaged build config.
- desktop main-process bootstrap and launchd plist generation pass that key into runtime env.
- GitHub workflows still inject Amplitude secrets during desktop build and release.

### Dependencies

- `apps/web/package.json` depends on `@amplitude/unified`.
- `apps/desktop/package.json` depends on `@amplitude/unified`.

## Migration Principles

### 1. Keep the existing event names first

For the first migration phase, keep current custom event names unless a PostHog-specific rename is required for correctness.

Reasoning:

- this minimizes product churn
- it keeps migration review focused on transport and identity semantics
- dashboards can be re-created with less translation work

Event taxonomy cleanup can happen later as a separate analytics-quality pass.

### 2. Migrate through existing seams

Prefer replacing provider-specific internals in the existing seams instead of touching dozens of event call sites:

- `apps/web/src/lib/tracking.ts`
- `apps/web/src/main.tsx`
- `apps/desktop/src/main.tsx`
- `apps/controller/src/services/analytics-service.ts`
- env / runtime / CI config files

### 3. Preserve identity behavior explicitly

PostHog identity semantics are not identical to Amplitude semantics.

The migration should explicitly define:

- when Nexu calls `identify(...)`
- when Nexu sets a stable distinct user id
- whether anonymous sessions should be linked to authenticated users via `alias(...)`
- when Nexu should call `reset()` on logout or profile switch

Without an explicit identity policy, dashboard continuity and session replay quality will be unreliable.

### 4. Separate live ingestion migration from historical backfill

Do not block the code migration on historical data import.

Live capture migration should land first. Historical backfill should be treated as a follow-up ops/data task using either:

- PostHog's managed migration from Amplitude, or
- a one-off historical import flow via PostHog's supported batch/historical ingestion path

## Proposed Target Design

## A. Frontend analytics adapter for PostHog

Replace Amplitude-specific frontend usage with a thin PostHog-backed adapter.

Primary files:

- `apps/web/src/lib/tracking.ts`
- `apps/web/src/main.tsx`

Recommended behavior:

1. initialize PostHog once at app bootstrap
2. keep exporting `track(...)`, `identify(...)`, and `setUserId(...)` from the existing tracking module
3. translate those helpers to PostHog calls internally
4. keep most downstream call sites unchanged in phase 1

Proposed semantics:

- `track(event, properties)` -> `posthog.capture(event, properties)`
- `identify(properties)` -> `posthog.setPersonProperties(...)` or `identify(...)` + property set helper, depending on the final API choice
- `setUserId(userId)` -> `posthog.identify(userId)`

Important implementation note:

PostHog recommends calling `identify()` with a stable distinct id after login. In Nexu, the existing helper split between `setUserId(...)` and `identify(...)` should remain, but their internal semantics must be redefined clearly for PostHog.

Recommended phase-1 rule:

- `setUserId(userId)` performs the canonical PostHog identify call
- `identify(properties)` only updates person properties and should not create a new identity by itself

This keeps the API shape familiar while matching PostHog's model more closely.

## B. Desktop renderer migration

Primary file:

- `apps/desktop/src/main.tsx`

Planned change:

- replace direct Amplitude bootstrap with PostHog bootstrap
- preserve the existing environment/build tagging behavior
- keep renderer bootstrap resilient when analytics env is absent

Recommendation:

- reuse the same initialization conventions as the web app where practical
- avoid introducing a desktop-only analytics model unless required by Electron constraints

If the desktop renderer later needs richer analytics, we can add a dedicated desktop tracking module in a second pass. That is not necessary for the initial migration.

## C. Controller-side server event ingestion

Primary file:

- `apps/controller/src/services/analytics-service.ts`

This file should stop posting Amplitude HTTP API payloads and instead send PostHog-compatible events.

Phase-1 target:

- keep the existing controller event derivation logic
- replace only the provider-specific send path

Implementation responsibilities:

1. replace the Amplitude endpoint and payload format
2. pass a stable distinct identifier for the local profile user
3. continue sending event timestamps where supported
4. preserve event properties already derived by the controller
5. keep failure logging provider-neutral and secret-safe

Recommendation:

- introduce a provider-neutral helper such as `sendAnalyticsEvent(...)` inside the service or a nearby lib file
- avoid naming the long-term internal API after Amplitude or PostHog

This makes future analytics transport changes cheaper and removes provider naming from business logic.

## D. Environment and runtime config rename

Primary files likely include:

- `apps/controller/src/app/env.ts`
- `apps/desktop/shared/runtime-config.ts`
- desktop main-process bootstrap files
- launchd plist generation
- GitHub workflow files

Planned change:

- remove active reliance on `AMPLITUDE_API_KEY` / `VITE_AMPLITUDE_API_KEY`
- introduce PostHog-specific env names

Recommended env shape:

- `POSTHOG_API_KEY`
- `VITE_POSTHOG_API_KEY`
- `POSTHOG_HOST`
- `VITE_POSTHOG_HOST`

Notes:

- the exact final env names should be consistent across controller, web, desktop, and CI
- if a reverse proxy is introduced later, `POSTHOG_HOST` should be the single place to switch from PostHog cloud host to a first-party ingestion host

## E. Diagnostics and docs cleanup

Amplitude references should be removed or rewritten in:

- startup diagnostics docs
- runtime diagnostics output that refers to Amplitude init
- any build/release instructions that mention Amplitude secrets

The final codebase should describe the active system as PostHog, not Amplitude with local exceptions.

## Rollout Strategy

## Phase 0. Decision and setup

Before coding:

1. confirm the PostHog project and host to use
2. confirm whether Nexu wants PostHog cloud directly or a reverse-proxied ingestion endpoint
3. confirm whether historical backfill is in scope for this milestone or a later ops task
4. get explicit approval for dependency changes, since replacing the SDK adds new dependencies and removes old ones

## Phase 1. Client migration behind the existing API shape

Scope:

- web bootstrap
- web tracking adapter
- desktop renderer bootstrap
- env/build config wiring

Expected outcome:

- frontend product analytics and replay/autocapture shift to PostHog
- downstream event call sites remain mostly unchanged

## Phase 2. Controller ingestion migration

Scope:

- replace Amplitude HTTP ingestion in `AnalyticsService`
- keep current controller-derived event names and properties

Expected outcome:

- server-side events join the same PostHog project and identity model

## Phase 3. Validation and dashboard parity

Scope:

- verify core events arrive from both frontend and controller surfaces
- verify identity stitching for authenticated users
- verify no duplicate spikes from re-identification or replay/autocapture overlap
- rebuild the minimum required product dashboards in PostHog

## Phase 4. Remove Amplitude leftovers

Scope:

- remove Amplitude dependencies
- remove Amplitude env names from CI and local setup
- remove dead migration compatibility branches, if any were added

## Historical Data Plan

Historical migration should be treated as a separate data task.

Recommendation:

1. first complete live ingestion migration
2. then decide between:
   - PostHog managed Amplitude migration, or
   - one-time historical import using PostHog's supported historical ingestion path
3. document the event/property mapping before import begins

Initial mapping guidance:

- keep Nexu custom event names unchanged where possible
- map person properties from current Amplitude identify usage into PostHog person properties
- explicitly document any events that will instead rely on PostHog built-ins such as `$pageview` or `$autocapture`

## Detailed Implementation Plan

### Step 1. Replace web bootstrap initialization

Update `apps/web/src/main.tsx` so it initializes PostHog instead of Amplitude.

Requirements:

- keep analytics optional when env is absent
- continue tagging environment/build context as person or super properties as appropriate
- decide explicitly whether PostHog autocapture and session replay should be enabled immediately or rolled out separately

Recommendation:

- enable autocapture only if Nexu wants it intentionally
- do not rely on provider defaults without documenting them
- keep privacy-sensitive masking defaults explicit

### Step 2. Refactor the frontend tracking wrapper

Update `apps/web/src/lib/tracking.ts` to become provider-neutral in implementation, while preserving its exported API in phase 1.

Changes:

- remove direct `@amplitude/unified` imports
- replace Amplitude identify-object logic with PostHog-compatible property updates
- keep helper functions such as `normalizeAuthSource(...)` and `normalizeChannel(...)` unchanged

Success criteria:

- most web event call sites require no changes
- event names and custom properties continue to flow through one central wrapper

### Step 3. Migrate desktop renderer bootstrap

Update `apps/desktop/src/main.tsx` to initialize PostHog instead of Amplitude.

Changes:

- replace `initializeAmplitudeTelemetry()` with provider-neutral or PostHog-specific bootstrap naming
- preserve current environment tagging
- keep startup probe behavior unaffected

### Step 4. Rename analytics env plumbing

Update all env readers and runtime config paths from Amplitude naming to PostHog naming.

Expected modules:

- controller env parser
- desktop runtime config
- build-config serialization
- launchd plist env generation
- CI workflow secret injection

Compatibility option:

- for a short migration window, read both old and new env names with new names taking precedence

Reasoning:

- this reduces rollout risk across local dev, CI, and packaged desktop builds
- it should be temporary and removed once deployment is stable

### Step 5. Replace controller transport

Refactor `apps/controller/src/services/analytics-service.ts` so `sendEvent(...)` emits PostHog-compatible ingestion payloads.

Requirements:

- preserve current event derivation logic
- preserve timestamps when supported
- send a stable distinct id based on the local profile id
- do not log secrets or full failing payloads

Recommendation:

- rename `sendEvent(...)` to a provider-neutral helper during the migration
- keep network behavior behind `proxyFetch(...)`

### Step 6. Validate identity behavior

Audit where Nexu currently knows the stable user identity and where logout/profile switch happens.

The migration should explicitly verify:

- `setUserId(...)` is called at the right authenticated boundary
- person properties are not dropped when the user becomes identified
- logout or account switch calls `reset()` where needed to avoid cross-user state bleed

This is especially important for desktop and long-lived local sessions.

### Step 7. Remove Amplitude dependencies and references

After PostHog capture is verified:

- remove `@amplitude/unified` from affected package manifests
- remove Amplitude env wiring from code and CI
- update docs and diagnostics references

## Testing and Verification

### Code-level checks

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

### Functional checks

1. open the web app with PostHog env configured
2. verify bootstrap succeeds without console/runtime errors
3. trigger a representative set of tracked events from existing UI flows
4. confirm events appear in PostHog with expected names and properties
5. verify person properties update after identify/set-user-id flows
6. verify desktop renderer initializes analytics correctly in local desktop runtime
7. verify controller-side events appear with the expected timestamp and distinct id

### Suggested validation flows

- workspace page view / navigation
- channel connect flow
- model/provider save flow
- skill install / enable / uninstall flow
- first conversation start
- user message sent
- skill use

### Data quality checks

- compare event counts between Amplitude and PostHog during rollout, if dual observation is available
- check for duplicated page or autocapture events
- verify environment tagging remains present
- verify anonymous-to-identified stitching works as expected

## Risks and Mitigations

### Risk 1. Identity mismatches create duplicate people

Mitigation:

- define one canonical distinct-id strategy before implementation
- keep `setUserId(...)` as the single stable-identity boundary
- test login, reconnect, and logout flows explicitly

### Risk 2. PostHog autocapture duplicates existing custom events

Mitigation:

- audit overlaps between existing custom events and PostHog built-ins
- disable or filter autocapture where it creates noisy duplicates
- keep custom business events as the source of truth for funnel metrics

### Risk 3. Desktop packaged builds miss analytics env values

Mitigation:

- test local dev and packaged config paths separately
- verify runtime config, launchd env propagation, and CI build-config generation

### Risk 4. Controller event semantics drift during transport rewrite

Mitigation:

- keep the derivation logic unchanged in phase 1
- isolate the migration to the send path and naming cleanup

### Risk 5. Historical import delays launch

Mitigation:

- treat historical migration as a follow-up task
- ship live ingestion first

## Open Questions

1. Should Nexu use PostHog cloud directly or a reverse-proxied ingestion host?
2. Does Nexu want PostHog autocapture enabled on day one, or only custom events plus explicit pageviews?
3. Should session replay be enabled immediately for both web and desktop renderer, or staged after initial event validation?
4. Is dual-write needed during rollout, or is a direct cutover acceptable?
5. Is historical Amplitude backfill required for this milestone?
6. Should controller-side events continue using the same exact names, or should some be renamed to fit a new PostHog naming convention later?

## Recommended First Implementation Slice

The safest first slice is:

1. wire PostHog env/config alongside existing analytics config
2. migrate web bootstrap and `apps/web/src/lib/tracking.ts`
3. migrate desktop renderer bootstrap
4. verify frontend capture and identity behavior
5. migrate controller transport
6. remove Amplitude dependencies and leftover references only after verification

This sequence keeps the largest product event surface stable while reducing rollout risk.
