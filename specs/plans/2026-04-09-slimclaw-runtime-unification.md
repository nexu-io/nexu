# Slimclaw Runtime Unification Plan

Date: 2026-04-09

## Context

Nexu's OpenClaw runtime pipeline is currently split across multiple producers:

- `openclaw-runtime/` owns install, cache, and pruning
- `openclaw-runtime-patches/` owns part of the patch set
- `packages/dev-utils/src/openclaw-runtime-stage.ts` patches/stages runtime for dev
- `apps/desktop/scripts/prepare-openclaw-sidecar.mjs` patches/stages runtime for desktop packaging
- `tools/dev/*`, `apps/controller/*`, `apps/desktop/*`, and tests directly reference legacy runtime paths and layouts

This means the repo does not have a single owner for:

- the runtime build entry
- the patch source of truth
- the final artifact contract

More importantly, this fragmented shape makes large runtime optimizations hard to execute as a closed loop. Any serious runtime change currently spills across legacy runtime packaging, dev staging, desktop sidecar prep, and test contracts.

That matters now because the runtime cost is already directly hurting developer throughput:

- dev cold start is already over 30 seconds
- multi-target builds are already over 10 minutes

Those numbers make the feedback loop materially worse. Iteration slows down, debugging and trial-and-error become more expensive, and high-leverage runtime optimizations remain blocked behind the current fragmented ownership model.

## Problem Statement

The current problem is not naming. It is that the runtime artifact pipeline is fragmented.

Today:

- runtime producers are duplicated
- patch mechanisms are duplicated
- consumers depend on internal legacy paths
- dev and desktop still own runtime-producer logic
- pruning, patching, and sidecar layout already define product capability boundaries, but remain encoded as scattered scripts

The primary reason to split out `packages/slimclaw` is not aesthetic cleanup. It is to create a single closed-loop runtime owner so Nexu can make high-value runtime optimizations in one place.

The first visible payoffs are expected to be:

- lower install and build time through prebundle work
- lower cold-start latency
- cleaner health/readiness handling

The architectural cleanup matters because it creates the optimization boundary needed to achieve those gains.

## Goals

1. Make `packages/slimclaw` the single runtime owner.
2. Make `packages/slimclaw/build.mjs` the single runtime build entry.
3. Converge all runtime consumers on a slimclaw-owned path contract.
4. Ensure dev, controller, desktop, and tests consume runtime artifacts but do not produce them.
5. Remove `openclaw-runtime` and `openclaw-runtime-patches` completely.

## Expected Payoff

Once slimclaw becomes the single runtime owner, OpenClaw runtime optimization becomes a self-contained problem instead of a cross-cutting repo problem.

That is the main payoff of this work. It makes larger improvements practical, especially around prebundle, cold start, and runtime health/readiness.

## Non-Goals

- changing core OpenClaw behavior
- redesigning controller or desktop product semantics
- freezing every archive, cache, or patch implementation detail in this plan

## Fixed Principles

- **No magic**: slimclaw declares the `openclaw` dependency directly and builds from that.
- **Auto build by default**: repo install prepares the runtime automatically; explicit opt-out remains supported.
- **Path-only contract**: slimclaw exposes artifact paths, not an extra behavior wrapper.
- **Thin artifact**: artifact modeling stays minimal; prefer direct dist output plus archive packaging.
- **Two patch classes**: distinguish packaging/optimization patches from Nexu-required compatibility patches. Both belong to slimclaw; the latter must not be dropped in the name of simplification.
- **Quick fail**: patch, prebundle, and build failures must fail immediately; no silent fallback to an unpatched artifact.

## Contracts We Can Freeze Now

### External interface boundary

All of the following are in scope for convergence onto slimclaw:

- root/build entrypoints
- dev entrypoints
- controller entrypoints
- desktop build/runtime entrypoints
- test entrypoints

Tests are part of the external interface migration, not a cleanup-afterward task.

Reason: tests already encode today's runtime contract. Leaving them behind would keep two contracts alive: one for production and one for tests.

Representative existing couplings include:

- `tools/dev/src/shared/dev-runtime-config.ts`
- `apps/controller/src/runtime/openclaw-process.ts`
- `apps/desktop/scripts/prepare-openclaw-sidecar.mjs`

### Contracts to keep

The contracts worth preserving are path contracts, not legacy directory names:

- runtime root: a stable artifact root that consumers can resolve
- runtime entry: `node_modules/openclaw/openclaw.mjs`
- runtime bin: `bin/openclaw`, `bin/openclaw.cmd`, `bin/openclaw-gateway`
- descriptor path: a minimal descriptor/manifest must exist for lookup and invalidation
- packaged runtime validation may continue to key off the presence of `node_modules/openclaw/openclaw.mjs`

At minimum, slimclaw should provide a stable path contract for:

- runtime root
- entry path
- bin path
- descriptor path

The descriptor/manifest is part of the prepared artifact contract, not an optional convenience. At minimum it should freeze:

- that a descriptor file exists
- a single `version` field for the descriptor contract
- a `fingerprint` field for artifact invalidation
- the OpenClaw version the artifact was prepared from
- whether exposed paths are relative to the artifact root

For slimclaw's own prepared `dist` output, the minimal descriptor should cover:

- `version`
- `fingerprint`
- `preparedAt`
- `openclawVersion`
- a relative-to-`distRoot` path map for:
  - `entryPath`
  - `binPath`
  - `builtinExtensionsDir`

The slimclaw descriptor does **not** own archive or materialization metadata. Those belong to the upper packaging layers.

The plan does **not** freeze a separate `gatewayBinPath` as part of the replacement contract. The active controller-first architecture should preserve gateway execution behavior through the runtime entry / CLI surface without baking an obsolete standalone gateway binary into the new minimal descriptor.

### Contracts to remove

- top-level `openclaw-runtime/`
- top-level `openclaw-runtime-patches/`
- root `openclaw-runtime:*` scripts
- direct consumer references to `openclaw-runtime/node_modules/...`
- dev/desktop-owned patch, stage, or runtime-producer logic

## Required Slimclaw Capabilities

The following capabilities are already justified by current repo behavior and can be frozen in this plan.

1. **Explicit dependency ownership**
   - slimclaw declares and prepares `openclaw` and Nexu-required adjunct runtime dependencies directly.

2. **Default auto-build with explicit opt-out**
   - runtime preparation remains automatic on install.

3. **Fingerprint, cache, and reuse**
   - unchanged inputs should reuse prior outputs
   - changed inputs must invalidate and rebuild

4. **Workspace-managed dependency model**
   - slimclaw uses the workspace `pnpm` lockfile directly
   - prepare-time optimization must happen within that model rather than through a separate npm-managed runtime root

5. **Pruning as an owned prepare responsibility**
   - prune policy is part of the prepare pipeline and part of artifact invalidation

6. **Transactional artifact prepare**
   - prepare into a candidate output, validate it, then switch over
   - do not patch fragile files in-place on the final consumer path

7. **Quick-fail patching**
   - anchor-based patching is the only supported patch representation
   - missing anchors, missing files, or incompatible bundles must fail the prepare step immediately

8. **Patch taxonomy with explicit ownership**
   - slimclaw owns both packaging/optimization patches and Nexu-required compatibility patches
   - compatibility patches remain required runtime behavior for Nexu and must not be treated as disposable packaging cleanup

9. **Thin artifact output**
   - slimclaw outputs the runtime artifact plus only the minimal manifest/path data needed by consumers

10. **Dist-only ownership**
   - slimclaw owns the canonical prepared `dist` artifact and its descriptor contract
   - archive, materialization, launch, readiness, and health handling remain upper-layer responsibilities

11. **Spawn-by-path and stdout-event compatibility**
   - controller continues to launch runtime by resolved path
   - existing stdout-driven `NEXU_EVENT` consumption remains compatible

12. **Baseline measurement before implementation**
   - optimization work should be evaluated from a fresh clone baseline
   - at minimum, record stage timings for `install -> dev -> build`

13. **Node ABI consistency with upstream runtime experience**
   - slimclaw prepared output must preserve the same runtime experience and native compatibility expectations as the OpenClaw runtime being consumed

## Consumer Boundary After Refactor

### dev

dev should only:

- ensure slimclaw is built
- resolve the slimclaw runtime entry path
- launch the runtime

dev should no longer patch, stage, or produce runtime artifacts.

### controller

controller should only:

- resolve slimclaw entry/bin/root paths
- launch and supervise the runtime
- consume runtime events

controller should no longer guess repo-local fallback paths or scan legacy runtime roots.

### desktop

desktop should only:

- consume slimclaw artifacts
- package, materialize, and launch those artifacts

desktop should no longer patch OpenClaw a second time or own its own runtime-producer logic.

More precisely: slimclaw owns the canonical prepared `dist` artifact plus its descriptor contract. Desktop owns any outer archive/materialization behavior built on top of that artifact.

That upper-layer ownership still has hard packaged-runtime constraints that must remain true after the migration:

- launchd-managed packaged services continue to run only from the packaged runtime locations under `~/.nexu/runtime/...`
- startup attach continues to depend on the current identity checks in `runtime-ports.json`
- update/install safety continues to depend on the extracted sidecar layout and lock-check behavior remaining compatible

Small transitional adapters are acceptable during rollout, but they must not become new runtime producers.

## Implementation Sequence

### 1. External interface decoupling

Keep the compatibility layer as thin as possible and move every runtime entrypoint to slimclaw.

Done when:

- all root, dev, controller, desktop, and test entrypoints resolve runtime through slimclaw-owned path contracts
- any compatibility layer is limited to path redirection, manifest lookup, entry resolution, or small transitional adaptation
- no compatibility layer patches, stages, or produces runtime artifacts
- legacy fallback paths must be migrated here rather than deferred to legacy removal

Exit condition: no maintained caller still needs to know the legacy runtime package name or layout.

### 2. Internal implementation alignment

Move all producer responsibilities into slimclaw.

Done when:

- patch source of truth is singular
- anchor-based patching is the only remaining patch representation
- prune/build/fingerprint/layout ownership is singular
- dev and desktop no longer own runtime-producer logic

This may overlap locally with step 1 where necessary.

Exit condition: slimclaw is the only place where runtime artifacts are built, patched, pruned, or staged.

### 3. Full regression pass

Verify:

- fresh-clone baseline timings for `install -> dev -> build`
- build artifact correctness
- consumer-chain correctness for dev, controller, and desktop
- capability regressions for:
  - Feishu patched path
  - `NEXU_EVENT channel.reply_outcome`
  - PDF parsing
  - Playwright-backed browser interaction
  - Slack reply smoke probe

Exit condition: the slimclaw-owned pipeline preserves the runtime-critical flows the legacy pipeline was responsible for.

### 4. Legacy removal

After the first three steps are stable, remove:

- `openclaw-runtime/`
- `openclaw-runtime-patches/`
- legacy root scripts
- legacy path references
- legacy test entrypoints

Exit condition: deleting the legacy runtime directories does not break build, dev, controller, desktop, or test flows.

## Details Intentionally Deferred

The following are real implementation topics but should not be frozen at the plan level yet:

- exact archive/extraction format or algorithm (`zip`, `tar`, `7z`, sync vs async)
- exact cache filenames, stamp schemas, or internal directory layout
- exact prune allow/deny lists
- exact shape of temporary desktop transitional adapters

## Done When

- `packages/slimclaw` is the only runtime owner
- `packages/slimclaw/build.mjs` is the only runtime build entry
- all runtime consumers resolve artifacts through slimclaw-owned path contracts
- dev and desktop no longer contain runtime-producer logic
- regression coverage passes for build, consumer flows, and key runtime capabilities
- `openclaw-runtime` and `openclaw-runtime-patches` are deleted
