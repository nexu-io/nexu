# System Proxy Integration Plan

Date: 2026-03-28

Issue: https://github.com/nexu-io/nexu/issues/607

## Context

Nexu currently has no single, explicit proxy strategy across:

- Electron / Chromium traffic in the desktop shell
- Node.js `fetch()` traffic in the desktop main process and controller
- child-process networking inherited by the controller and OpenClaw runtime

In proxy-restricted environments this causes inconsistent behavior. Some traffic may follow OS proxy settings, some may ignore them, and local loopback traffic may accidentally be sent through a proxy unless bypass rules are added deliberately.

The goal of this plan is to make proxy behavior explicit, consistent, diagnosable, and safe for both development and packaged desktop builds.

## Goals

1. Respect standard proxy environment variables when present:
   - `HTTP_PROXY`
   - `HTTPS_PROXY`
   - `ALL_PROXY`
   - `NO_PROXY`
2. Respect system proxy settings for Electron / Chromium traffic.
3. Ensure local Nexu traffic bypasses proxies by default:
   - `localhost`
   - `127.0.0.1`
   - `::1`
4. Propagate proxy configuration predictably to controller and OpenClaw child processes.
5. Add diagnostics that show which proxy strategy is active without exposing secrets.
6. Document the final behavior for dev and packaged builds.

## Non-goals

- Adding a user-facing proxy settings UI in this phase.
- Supporting arbitrary custom proxy configuration stored in Nexu config.
- Modifying OpenClaw source code.
- Adding new dependencies unless runtime capability is insufficient and approval is obtained.

## Current State Summary

### Electron / desktop

- `apps/desktop/main/index.ts` bootstraps the Electron app, but does not explicitly configure Chromium proxy behavior.
- `apps/desktop/main/ipc.ts` makes desktop main-process `fetch()` requests to the controller and other services.
- `apps/desktop/main/services/embedded-web-server.ts` proxies `/api` and `/v1` requests to the local controller with plain `fetch()`.
- `apps/desktop/shared/runtime-config.ts` owns centralized runtime env parsing, but has no proxy model today.

### Child-process bootstrapping

- `apps/desktop/main/runtime/manifests.ts` is the main seam for passing env vars into the web sidecar, controller, and OpenClaw runtime process tree.
- It currently passes runtime URLs and OpenClaw paths, but no proxy env vars.

### Controller

The controller has many direct `fetch()` call sites across cloud auth, provider verification, channel setup, analytics, skill catalog downloads, and runtime health checks. There is no centralized proxy-aware fetch layer.

### Existing gap

- No centralized parsing of `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`
- No explicit Electron `session.setProxy(...)`
- No controller-wide proxy-aware dispatcher/wrapper
- No proxy diagnostics or secret redaction helpers

## Design Principles

### 1. One proxy policy, multiple consumers

Desktop bootstrap should compute one normalized proxy policy, then apply it to:

- Electron / Chromium
- desktop child process env
- Node.js fetch wrappers where needed
- diagnostics export

### 2. Explicit precedence

Use this precedence order:

1. Proxy environment variables
2. System proxy
3. Direct connection

Rationale:

- env vars are the most explicit user/operator override
- packaged apps need deterministic child-process inheritance
- system proxy remains the fallback when env vars are absent

### 3. Local bypass is mandatory

Never proxy Nexu-local traffic. Loopback bypass must be merged in even if the environment does not explicitly include it.

### 4. No secret leakage

Proxy URLs may contain credentials. Full proxy URLs must never appear in logs, exported diagnostics, or UI.

## Proposed Architecture

## A. Shared proxy configuration model

Add a shared desktop-side module:

- `apps/desktop/shared/proxy-config.ts`

Primary responsibilities:

1. Read proxy env vars from `process.env`
2. Normalize casing / precedence
3. Produce a `ProxyPolicy`
4. Merge mandatory local bypass entries
5. Provide redaction helpers for diagnostics
6. Produce Electron-ready and child-process-ready views

Proposed shape:

```ts
type ProxySource = "env" | "system" | "direct";

type ProxyEnvConfig = {
  httpProxy: string | null;
  httpsProxy: string | null;
  allProxy: string | null;
  noProxy: string[];
};

type ProxyPolicy = {
  source: ProxySource;
  env: ProxyEnvConfig;
  bypass: string[];
  diagnostics: {
    httpProxyRedacted: string | null;
    httpsProxyRedacted: string | null;
    allProxyRedacted: string | null;
  };
};
```

Implementation notes:

- Read uppercase first because the issue explicitly names uppercase vars.
- If lowercase variants are present, normalize them too, but expose one canonical result.
- Merge mandatory bypass entries into `NO_PROXY` even if not provided.
- Keep ordering stable and deduplicate.

Recommended helper functions:

- `readProxyPolicy(env)`
- `mergeNoProxyEntries(input)`
- `redactProxyUrl(url)`
- `buildChildProcessProxyEnv(policy)`
- `buildElectronProxyConfig(policy)`

## B. Electron / Chromium proxy manager

Add a desktop main-process service:

- `apps/desktop/main/services/proxy-manager.ts`

Responsibilities:

1. Apply the normalized policy to Electron networking
2. Expose effective proxy diagnostics for selected URLs
3. Refresh/close connections after changes

Behavior:

- If env-based proxy exists, configure Electron with explicit fixed proxy rules.
- If no env-based proxy exists, set Electron proxy mode to `system`.
- If proxying is fully disabled, set direct mode.
- After applying proxy changes:
  - call `session.closeAllConnections()`
- For diagnostics:
  - call `session.resolveProxy(url)` for a small set of representative URLs

Representative diagnostic URLs:

- local controller URL from runtime config
- local OpenClaw URL from runtime config
- a stable external HTTPS probe URL such as `https://nexu.io`

Electron bypass requirements:

- include `<local>`
- include explicit loopback entries in bypass rules for clarity

Integrate from:

- `apps/desktop/main/index.ts`

## C. Propagate proxy env to child processes

Update:

- `apps/desktop/main/runtime/manifests.ts`

Responsibilities:

1. Build a normalized proxy env object from the shared `ProxyPolicy`
2. Pass that env into:
   - web sidecar
   - controller
   - OpenClaw process tree via controller env inheritance

Required env vars to propagate:

- `HTTP_PROXY`
- `HTTPS_PROXY`
- `ALL_PROXY`
- `NO_PROXY`

Rules:

- only set vars that have values
- always pass normalized `NO_PROXY` with loopback merged in
- avoid mutating unrelated inherited env values
- for packaged mode, use the normalized values even if the launching shell did not preserve mixed-case variants

## D. Controller-wide proxy-aware fetch layer

Add a controller helper module:

- `apps/controller/src/lib/proxy-fetch.ts`

Responsibilities:

1. Provide a single proxy-aware wrapper for outbound HTTP requests
2. Respect normalized proxy env vars
3. Respect bypass rules for local URLs
4. Make future diagnostics/testing easier by centralizing request behavior

Preferred implementation path:

- use built-in runtime support in Node 22 / undici if available
- avoid adding a dependency first

Target API:

```ts
type ProxyFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export async function proxyFetch(
  input: string | URL,
  options?: ProxyFetchOptions,
): Promise<Response>;
```

And optionally:

```ts
export async function proxyFetchJson<T>(
  input: string | URL,
  options?: ProxyFetchOptions,
): Promise<T>;
```

Implementation requirements:

- short-circuit loopback/local URLs to direct fetch behavior
- use a shared dispatcher/agent instead of rebuilding per request
- keep timeout support explicit
- throw errors without exposing proxy credentials

## E. Replace direct controller `fetch()` call sites

Migrate these files to use the new controller helper:

- `apps/controller/src/store/nexu-config-store.ts`
- `apps/controller/src/services/channel-service.ts`
- `apps/controller/src/services/model-provider-service.ts`
- `apps/controller/src/services/openclaw-auth-service.ts`
- `apps/controller/src/services/analytics-service.ts`
- `apps/controller/src/services/skillhub/catalog-manager.ts`
- `apps/controller/src/runtime/gateway-client.ts`
- `apps/controller/src/runtime/runtime-health.ts`
- `apps/controller/src/runtime/sessions-runtime.ts`

Migration rule:

- all outbound non-local controller HTTP requests should route through the helper
- purely local controller-to-localhost traffic may still use the helper, but must bypass proxying

## F. Desktop local request paths

Review and normalize desktop main-process request paths:

- `apps/desktop/main/ipc.ts`
- `apps/desktop/main/services/embedded-web-server.ts`

Guidance:

- local controller proxying should stay direct and never go through an outbound proxy
- these paths should either:
  - use a tiny shared desktop fetch helper with explicit local bypass, or
  - remain plain `fetch()` if the URL is guaranteed local loopback and documented as such

Recommendation:

- keep local desktop-to-controller traffic direct
- do not over-generalize these local-only paths into external proxy logic

## G. Diagnostics surface

Extend desktop diagnostics to expose proxy state safely.

Touchpoints:

- `apps/desktop/main/ipc.ts`
- desktop diagnostics export path
- optionally desktop runtime status payload in a future UI follow-up

Required fields:

- proxy source: `env | system | direct`
- redacted env-derived proxy URLs
- normalized `NO_PROXY` entries
- Electron `resolveProxy(...)` results for representative URLs

Redaction rules:

- `http://user:pass@proxy.example.com:8080` -> `http://***:***@proxy.example.com:8080`
- if token-like auth appears, replace auth segment entirely
- never include `Proxy-Authorization` headers in diagnostics

## Implementation Phases

## Phase 1 — shared proxy model and Electron support

Deliverables:

1. Add `apps/desktop/shared/proxy-config.ts`
2. Parse env vars and merge bypass rules
3. Add `apps/desktop/main/services/proxy-manager.ts`
4. Apply Electron proxy config from `apps/desktop/main/index.ts`
5. Add redacted diagnostics for desktop main process

Acceptance criteria:

- desktop can report whether it is using env, system, or direct mode
- Electron `resolveProxy()` shows local URLs bypassed
- no proxy secrets appear in logs or diagnostics

## Phase 2 — child process env propagation

Deliverables:

1. Update `apps/desktop/main/runtime/manifests.ts`
2. Pass normalized proxy env vars to web/controller/OpenClaw process tree
3. Add tests for packaged and dev manifest output

Acceptance criteria:

- controller receives normalized `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`
- loopback entries are always present in propagated `NO_PROXY`
- packaged mode behavior matches dev mode behavior

## Phase 3 — controller outbound HTTP centralization

Deliverables:

1. Add `apps/controller/src/lib/proxy-fetch.ts`
2. Migrate all current direct controller outbound `fetch()` call sites
3. Add unit tests for bypass and timeout behavior

Acceptance criteria:

- controller external requests use the shared helper
- loopback/local controller traffic is not proxied
- error messages do not leak credentials

## Phase 4 — verification and documentation

Deliverables:

1. Add integration coverage for env proxy and `NO_PROXY`
2. Document runtime behavior for desktop/controller/OpenClaw
3. Update troubleshooting guidance

Acceptance criteria:

- behavior is documented for dev and packaged builds
- operators can determine active proxy mode from diagnostics

## Detailed File Plan

### New files

- `apps/desktop/shared/proxy-config.ts`
- `apps/desktop/main/services/proxy-manager.ts`
- `apps/controller/src/lib/proxy-fetch.ts`
- tests alongside the new modules or under existing test structure

### Updated files

- `apps/desktop/main/index.ts`
- `apps/desktop/main/runtime/manifests.ts`
- `apps/desktop/main/ipc.ts`
- `apps/desktop/main/services/embedded-web-server.ts` (document/guard local direct behavior)
- `apps/desktop/shared/runtime-config.ts` (if runtime config should expose proxy diagnostics/state)
- controller call-site files listed above

### Possible docs to update after implementation

- `AGENTS.md`
- `specs/guides/desktop-runtime-guide.md`
- `ARCHITECTURE.md` if network-path behavior becomes part of the architectural contract
- troubleshooting docs if there is an existing diagnostics guide

## Testing Plan

## Unit tests

### Shared proxy config

Test:

- env precedence and normalization
- empty values and malformed values
- `NO_PROXY` merge/dedup behavior
- mandatory loopback insertion
- redaction behavior

### Electron proxy manager

Test:

- env mode builds explicit Electron config
- no-env mode selects system mode
- direct mode disables proxy use
- diagnostics helpers redact safely

### Controller proxy fetch

Test:

- direct bypass for loopback URLs
- external URL uses proxy-aware path when configured
- timeout behavior
- secret-safe error formatting

## Integration tests

Cover at least:

1. `HTTP_PROXY` only
2. `HTTPS_PROXY` only
3. `ALL_PROXY` only, if runtime support is verified
4. `NO_PROXY=localhost,127.0.0.1,::1`
5. system proxy without env vars for Electron diagnostics path

Practical test strategy:

- use a local fake proxy server in tests where feasible
- assert that loopback controller calls do not traverse the fake proxy
- assert that external-target simulation does traverse it when configured

## Open Questions

### 1. `ALL_PROXY` runtime support

The issue requires `ALL_PROXY`, but current built-in runtime support must be verified in the actual packaged/runtime environment before we depend on it fully.

Decision gate:

- if runtime support is confirmed, implement it in Phase 1/3
- if not, either:
  - document the gap temporarily, or
  - request approval for a minimal dependency/fallback implementation

### 2. OpenClaw behavior

We should verify whether the shipped OpenClaw runtime already honors proxy env vars inherited from the controller/desktop environment.

Expected outcome:

- if it already respects env vars, no OpenClaw code change is needed
- if it does not, Nexu can only improve propagation/diagnostics without modifying OpenClaw itself

### 3. PAC/WPAD / advanced system proxy setups

Electron can resolve system proxy behavior, including enterprise-style system proxy setups, better than plain Node child processes.

This plan does not introduce a custom Electron-to-controller proxy-resolution bridge in the first implementation. If enterprise PAC parity remains incomplete after Phases 1-4, create a follow-up plan.

## Risks

1. Divergence between Electron system-proxy behavior and Node child-process behavior
2. False confidence if diagnostics show Electron proxy resolution but controller traffic is still direct
3. Credential leakage if redaction is incomplete
4. Regressions in local loopback traffic if `NO_PROXY` is not merged correctly

## Rollout Notes

- Ship behind implementation sequencing, not a feature flag, unless testing reveals risk.
- Land shared parsing and diagnostics first so behavior is observable early.
- Keep local desktop/controller communication explicitly direct throughout rollout.

## Final Acceptance Criteria

The work is complete when all of the following are true:

1. Electron desktop networking explicitly uses env proxy settings when present, otherwise system proxy settings.
2. Controller and OpenClaw child-process env inherit normalized proxy settings.
3. Controller outbound HTTP logic is centralized and proxy-aware.
4. Loopback/local Nexu traffic bypasses proxying reliably.
5. Diagnostics show detected/applied proxy behavior without exposing credentials.
6. Behavior is documented for both development and packaged builds.

## PR-ready Implementation Task List

Use this as the implementation checklist in the PR body.

### What

- Add shared proxy policy parsing and redaction helpers for desktop bootstrap.
- Configure Electron / Chromium to use env proxy settings when present, otherwise system proxy settings.
- Propagate normalized proxy env vars into desktop child processes.
- Centralize controller outbound HTTP behind a proxy-aware fetch helper.
- Add safe diagnostics and tests for proxy detection, bypass, and redaction.
- Document final behavior for dev and packaged builds.

### Why

- Nexu currently has inconsistent proxy behavior across Electron, controller, and child-process networking.
- Enterprise and restricted-network environments need predictable support for env proxies, system proxies, and loopback bypass rules.

### How

#### 1. Shared proxy policy

- [ ] Add `apps/desktop/shared/proxy-config.ts`
- [ ] Implement env parsing for `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`
- [ ] Normalize mixed-case env inputs into one canonical policy
- [ ] Merge required local bypass entries: `localhost`, `127.0.0.1`, `::1`
- [ ] Add proxy URL redaction helper for diagnostics/logging
- [ ] Add unit tests for parsing, precedence, deduping, and redaction

#### 2. Electron / Chromium proxy application

- [ ] Add `apps/desktop/main/services/proxy-manager.ts`
- [ ] Build Electron proxy config from the shared proxy policy
- [ ] In `apps/desktop/main/index.ts`, apply explicit Electron proxy config during startup
- [ ] Use env-based fixed proxy config when env vars are present
- [ ] Fall back to `system` mode when env vars are absent
- [ ] Call `session.closeAllConnections()` after proxy config changes
- [ ] Add helper(s) for `session.resolveProxy(url)` diagnostics
- [ ] Add tests for env mode, system mode, direct mode, and bypass rules

#### 3. Child-process env propagation

- [ ] Update `apps/desktop/main/runtime/manifests.ts`
- [ ] Pass normalized `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` into controller/web/OpenClaw env
- [ ] Ensure normalized `NO_PROXY` always includes loopback/local bypass entries
- [ ] Add tests covering manifest env output in dev and packaged paths

#### 4. Controller proxy-aware fetch layer

- [ ] Add `apps/controller/src/lib/proxy-fetch.ts`
- [ ] Implement shared proxy-aware fetch wrapper using built-in runtime support first
- [ ] Ensure loopback/local URLs bypass proxying explicitly
- [ ] Support request timeouts without duplicating timeout logic across callers
- [ ] Ensure thrown/logged errors do not expose proxy credentials
- [ ] Add unit tests for direct bypass, proxied external requests, and timeout behavior

#### 5. Migrate controller outbound HTTP call sites

- [ ] Update `apps/controller/src/store/nexu-config-store.ts`
- [ ] Update `apps/controller/src/services/channel-service.ts`
- [ ] Update `apps/controller/src/services/model-provider-service.ts`
- [ ] Update `apps/controller/src/services/openclaw-auth-service.ts`
- [ ] Update `apps/controller/src/services/analytics-service.ts`
- [ ] Update `apps/controller/src/services/skillhub/catalog-manager.ts`
- [ ] Update `apps/controller/src/runtime/gateway-client.ts`
- [ ] Update `apps/controller/src/runtime/runtime-health.ts`
- [ ] Update `apps/controller/src/runtime/sessions-runtime.ts`
- [ ] Confirm no remaining external outbound controller `fetch()` calls bypass the shared helper

#### 6. Desktop local networking safeguards

- [ ] Review `apps/desktop/main/ipc.ts` local request paths and keep controller-loopback traffic direct
- [ ] Review `apps/desktop/main/services/embedded-web-server.ts` and keep local controller proxying direct-only
- [ ] Add comments or helper guards documenting why these local paths must never use outbound proxy routing

#### 7. Diagnostics

- [ ] Extend desktop diagnostics payload/export to include active proxy source: `env`, `system`, or `direct`
- [ ] Include redacted proxy values only
- [ ] Include normalized `NO_PROXY` entries
- [ ] Include representative `resolveProxy(...)` results for local and external URLs
- [ ] Verify no auth-bearing proxy URLs or headers appear in exported diagnostics

#### 8. Documentation

- [ ] Update `specs/guides/desktop-runtime-guide.md` with final proxy behavior
- [ ] Update `ARCHITECTURE.md` if proxy behavior becomes part of the runtime contract
- [ ] Update `AGENTS.md` if command/runtime guidance needs proxy notes
- [ ] Document behavior differences and guarantees for dev vs packaged builds
- [ ] Document known limitations, including any verified `ALL_PROXY` caveat

#### 9. Verification

- [ ] Run targeted tests for new proxy modules
- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm lint`
- [ ] Run `pnpm test`
- [ ] Manually verify local controller/OpenClaw traffic still bypasses proxying
- [ ] Manually verify Electron diagnostics show env proxy mode when env vars are set
- [ ] Manually verify Electron diagnostics show system proxy mode when env vars are absent

### Affected areas

- `apps/desktop/main/`
- `apps/desktop/shared/`
- `apps/controller/src/lib/`
- `apps/controller/src/store/`
- `apps/controller/src/services/`
- `apps/controller/src/runtime/`
- docs under `specs/` and possibly `AGENTS.md`

### Checklist

- [ ] Proxy env vars are normalized and propagated consistently
- [ ] Electron explicitly uses env proxy or system proxy by policy
- [ ] Controller outbound HTTP is centralized behind the shared helper
- [ ] Loopback/local Nexu traffic is bypassed reliably
- [ ] Diagnostics redact proxy credentials safely
- [ ] Tests cover parsing, bypass, and controller migration behavior
- [ ] Docs reflect final implementation behavior
