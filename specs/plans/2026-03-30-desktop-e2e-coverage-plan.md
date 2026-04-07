# Desktop E2E Precise Coverage Plan

Date: 2026-03-30

## Background

Today, `.github/workflows/desktop-e2e.yml` runs packaged Nexu Desktop E2E on a self-hosted macOS runner:

- `source=download`: download published `dmg` / `zip` artifacts
- `source=build`: build an unsigned desktop artifact from the current branch, then hand it off to E2E
- The E2E shell entrypoint is `e2e/desktop/scripts/run-e2e.sh`
- The UI automation entrypoint is `e2e/desktop/tests/packaged-e2e.mjs`

This validates functional flows, but it does **not** precisely answer “which first-party code was actually executed by this E2E run.” To produce trustworthy per-run coverage, we need to cover all of the following:

1. Electron main process
2. Electron renderer / webview / preload
3. The controller sidecar launched by the packaged desktop app
4. Any other first-party Node subprocesses, when applicable

We also need to map artifacts back to repository source paths in a stable way, while excluding third-party code, handling packaged-path differences, and avoiding the ambiguity of downloaded release builds.

## Goals

1. Produce one independent, traceable coverage result for **every desktop E2E run**.
2. Remap coverage back to repository source paths rather than reporting only packaged output paths.
3. Merge coverage across these execution surfaces:
   - `apps/desktop/main/**`
   - `apps/desktop/preload/**`
   - `apps/desktop/src/**` / packaged renderer code
   - first-party controller code actually launched by the packaged app
4. Bind coverage to the exact E2E run:
   - workflow run id
   - git sha
   - `mode` (`smoke/login/model/update/resilience/full`)
   - `source`
5. Upload raw coverage artifacts and merged reports in CI for later inspection and comparison.

## Non-goals

1. Do not measure third-party dependency coverage.
2. Do not modify OpenClaw source code, and do not include OpenClaw as part of this coverage baseline.
3. Do not require Codecov or any external coverage platform in the first phase.
4. Do not require immediate precise coverage support for published artifacts under `source=download`.

## Key Conclusions

### 1. Precise coverage should only apply to `source=build`

Why:

- Precise coverage depends on source maps, source-path remapping, and build metadata matching the current commit.
- `download` mode uses published artifacts that may not exactly match the current checkout.
- Even if release builds contain source maps, version skew, path rewriting, signing, and repackaging make precise remapping less reliable.

Conclusion:

- **Coverage mode should only support `source=build`.**
- `source=download` remains useful for functional validation, but should be explicitly marked as “not eligible for precise coverage.”

### 2. We need two kinds of collectors

#### A. Node / Electron main / controller sidecar

Use **native V8 coverage**:

- Collect via `NODE_V8_COVERAGE=<dir>`
- Explicitly flush before exit via `v8.takeCoverage()` or an equivalent mechanism
- Use Node’s `source-map-cache` output for remapping

Applies to:

- Electron main process
- controller sidecar
- any first-party Node subprocess launched by the packaged app

#### B. Renderer / webview / preload Chromium targets

Use **Playwright + CDP Precise Coverage**:

- Start `Profiler.startPreciseCoverage` for Electron windows and webview targets
- Call `Profiler.takePreciseCoverage` at scenario end or before shutdown
- Persist raw coverage per target, then merge later

This is more reliable than best-effort coverage and better suited for precise CI reporting.

### 3. Normalize everything into an Istanbul coverage map

Recommended pipeline:

1. Node raw V8 coverage -> remap -> Istanbul
2. Chromium precise coverage -> `v8-to-istanbul` -> Istanbul
3. Merge with `istanbul-lib-coverage`
4. Output:
   - `coverage-final.json`
   - `lcov.info`
   - `html/`
   - `summary.json`

Why:

- Istanbul has the most interoperable ecosystem
- It fits CI summaries, PR annotations, and Codecov later
- It makes it easier to keep only first-party files, exclude dependencies, and generate diff-oriented reporting later

## Current Constraints

### Desktop build side

- `apps/desktop/vite.config.ts` already enables source maps for renderer and preload builds
- `apps/desktop/package.json` packages:
  - `dist/**/*`
  - `dist-electron/**/*`
- E2E runs the **actual packaged Electron app**, not a dev-server flow

### E2E runtime side

- `e2e/desktop/scripts/run-e2e.sh` installs the DMG, launches the app, runs smoke checks, then hands off to Playwright
- `e2e/desktop/tests/packaged-e2e.mjs` uses Playwright `_electron.launch(...)`
- Tests involve both a main window and separate targets created by `<webview>`
- The current workflow uploads `captures/`, but does not upload raw coverage data or merged coverage reports

### Current gaps

1. No coverage switch
2. No `NODE_V8_COVERAGE` injection for packaged main/controller processes
3. No precise coverage collection for renderer / webview
4. No unified merge / remap pipeline
5. No per-run coverage artifact layout

## Design

## Phase 1: Establish a coverage-only build/test path

### Principle

Coverage must come from artifacts built from the **current commit**, not from downloaded release artifacts.

### Workflow changes

Add a new optional input to `.github/workflows/desktop-e2e.yml`:

- `coverage: true|false` (default `false`)

Rules:

1. If `coverage=true`, require `source=build`
2. If the user selects `coverage=true` with `source=download`, fail the workflow with a clear error
3. Scheduled nightly runs should keep coverage disabled by default to avoid cost/time inflation

### Artifact requirements

When `coverage=true`, the build job should also preserve:

- the app build artifacts (`dmg` / `zip`, already produced today)
- source maps needed for remapping
- a build manifest for this run (git sha, mode, build timestamp, path-mapping version)

Recommended artifact additions:

- `e2e/desktop/artifacts/coverage-build-manifest.json`
- `e2e/desktop/artifacts/source-maps/**`

If we do not want to copy source maps as artifacts, we can instead remap against the checked-out source in the E2E job, but only if we guarantee the built artifact and checkout point to the exact same commit.

## Phase 2: Collect Node / main / controller coverage

### Scope

Cover these first-party Node execution surfaces:

- Electron main
- controller sidecar
- other confirmed first-party Node subprocesses

### Implementation

Before launching the packaged app in `e2e/desktop/scripts/run-e2e.sh`, create a run-specific directory:

- `captures/coverage/raw/node-v8/`

Then inject these environment variables into the packaged app process:

- `NODE_V8_COVERAGE=<capture-dir>/coverage/raw/node-v8`
- `NEXU_DESKTOP_E2E_COVERAGE=1`
- `NEXU_DESKTOP_E2E_COVERAGE_RUN_ID=<run-id>`

Because Node propagates `NODE_V8_COVERAGE` to subprocesses, the controller sidecar should naturally emit coverage files too, but we still need to verify that launchd / sidecar startup paths preserve this environment.

### Required code changes

Add a coverage flush in the desktop main-process shutdown path so late writes are not lost when the runner kills the process:

- inside the main desktop shutdown path, when `NEXU_DESKTOP_E2E_COVERAGE=1`, call `node:v8` `takeCoverage()`

Add the same kind of guarded flush in the controller startup/shutdown path:

- enabled only in E2E coverage mode

Important constraints:

- coverage support must not change normal product behavior
- flush logic must be conditional, low-risk, and disabled outside CI coverage runs

## Phase 3: Collect renderer / webview / preload coverage

### Scope

Cover the first-party frontend code actually executed inside Chromium targets of the packaged Electron app:

- renderer pages
- `<webview>` pages
- preload / webview preload scripts (must be validated in practice)

### Implementation

Add a coverage collector to `e2e/desktop/tests/packaged-e2e.mjs`:

1. Enumerate Electron windows and webview targets after app launch
2. Create a CDP session for each target
3. Call:
   - `Profiler.enable`
   - `Profiler.startPreciseCoverage({ callCount: true, detailed: true })`
4. On scenario completion, abnormal exit, and the global `finally` path, call:
   - `Profiler.takePreciseCoverage`
   - `Profiler.stopPreciseCoverage`
5. Write raw coverage for each target to:
   - `captures/coverage/raw/chromium/<target-id>.json`

### Target-management requirements

Because the login web app runs inside a `<webview>`, we cannot collect only the main window.

The collector must therefore:

1. track the initial app window
2. track webview pages that appear later
3. filter out DevTools, blank pages, and other non-business targets
4. record target metadata:
   - URL
   - target type
   - first-seen timestamp
   - scenario name

## Phase 4: Path normalization, source remapping, and merge

### Core problem

Raw V8 coverage may reference script URLs / file paths such as:

- `file:///.../Nexu.app/.../dist/...`
- `file:///.../dist-electron/...`
- temporary unpack paths
- launchd runner paths
- copied sidecar runtime paths

Without normalization, the same source file may appear multiple times under different paths.

### Unified rules

Add a coverage merge script, for example:

- `e2e/desktop/scripts/merge-coverage.mjs`

Responsibilities:

1. Read:
   - `raw/node-v8/**/*.json`
   - `raw/chromium/**/*.json`
2. Map packaged paths back to repository source paths, for example:
   - `apps/desktop/dist/...` -> `apps/desktop/src/...` (renderer)
   - `apps/desktop/dist-electron/main/...` -> `apps/desktop/main/...`
   - `apps/desktop/dist-electron/preload/...` -> `apps/desktop/preload/...`
   - packaged controller-sidecar runtime path -> `apps/controller/src/...`
3. Use source maps to remap coverage back to TS/TSX sources
4. Filter non-first-party files:
   - `node_modules/**`
   - Electron built-in scripts
   - Playwright injected scripts
   - Vite runtime / vendor chunks
   - OpenClaw code
5. Merge everything into a single Istanbul coverage map

### Output structure

Recommended output directory:

- `captures/coverage/coverage-final.json`
- `captures/coverage/lcov.info`
- `captures/coverage/html/**`
- `captures/coverage/summary.json`
- `captures/coverage/meta.json`

`meta.json` should contain at least:

- `gitSha`
- `workflowRunId`
- `mode`
- `source`
- `coverageEnabled`
- `startedAt`
- `finishedAt`
- `includedTargets`
- `includedProcesses`
- `pathNormalizationVersion`

## Phase 5: Show and archive coverage in CI

### Workflow changes

After the E2E run completes, if `coverage=true`:

1. run `merge-coverage.mjs`
2. print a job summary including:
   - statements
   - branches
   - functions
   - lines
   - top uncovered files
3. upload a coverage artifact

Recommended additional upload:

- `e2e/desktop/captures/coverage/**`

Use a dedicated artifact name, for example:

- `desktop-e2e-coverage-${run_id}`

### Precise metric definition

For each workflow run, coverage should be defined as:

> the first-party source code actually executed by the packaged app and its first-party subprocesses during this workflow’s selected `mode`.

That means:

- `mode=model` only represents model-scenario coverage
- `mode=full` represents full-scenario coverage for that single run
- different workflow runs should not be silently merged into one “overall desktop E2E coverage” result

If we later want overall desktop E2E coverage, that should be handled by a dedicated matrix or aggregation workflow that merges multiple modes intentionally.

## Phase 6: Integrate Codecov for visualization

### Goal

Upload each desktop E2E Istanbul report to Codecov so the open source repository gets:

1. PR- and commit-level coverage visualization
2. patch coverage and project coverage comparison
3. file-level visualization and historical trends
4. separate display lanes for desktop E2E versus other test sources

### Integration principles

1. **Use `lcov.info` as the primary upload format**
   - `lcov` is Codecov’s most stable and broadly supported input
   - keep `coverage-final.json` for debugging and local inspection, but do not treat it as the primary upload source
2. **Upload desktop E2E coverage under a dedicated flag**
   - for example: `desktop-e2e`
   - if we later split by mode, we can add flags such as:
     - `desktop-e2e-smoke`
     - `desktop-e2e-model`
     - `desktop-e2e-update`
3. **Do not implicitly merge unrelated modes into one upload**
   - each workflow run should upload coverage for its own selected mode
   - aggregated coverage should come from a dedicated matrix / merge workflow
4. **Codecov should complement, not replace, raw artifact retention**
   - `captures/coverage/**` should still be uploaded to GitHub Actions artifacts

### Authentication strategy

Because this is an open source repository, prefer **OIDC-based upload** over long-lived tokens:

1. install the Codecov GitHub App on the repo/org
2. add workflow permission:
   - `id-token: write`
3. use `codecov/codecov-action`
4. set `use_oidc: true`

This is better suited to a public repo and avoids managing an additional secret.

If repository policy or Codecov organization settings prevent this, fall back to `CODECOV_TOKEN`.

### Workflow integration recommendation

After coverage merging finishes in `.github/workflows/desktop-e2e.yml`, add an upload step:

```yml
permissions:
  contents: read
  id-token: write

- name: Upload desktop E2E coverage to Codecov
  if: ${{ inputs.coverage == 'true' || github.event.inputs.coverage == 'true' }}
  uses: codecov/codecov-action@v6
  with:
    use_oidc: true
    files: e2e/desktop/captures/coverage/lcov.info
    flags: desktop-e2e
    name: desktop-e2e-${{ github.run_id }}
    fail_ci_if_error: true
    verbose: true
    os: macos
```

Additional recommendations:

1. If the self-hosted runner is misdetected by the action, explicitly set:
   - `os: macos`
   - if needed, try `macos-arm64`
2. If we later upload per-mode lanes, `flags` can become:
   - `desktop-e2e,desktop-e2e-${mode}`
   but unrelated flags should not be mixed into the same upload without intention

### Recommended Codecov display model

Treat desktop E2E as a **separate coverage lane** in Codecov instead of mixing it with unit or integration coverage.

Recommended approach:

1. use `flags` to separate desktop E2E from other test sources
2. add a `codecov.yml` in the repository root
3. define dedicated status checks, for example:
   - `project`: overall desktop E2E coverage
   - `patch`: desktop E2E coverage for changed files

Example:

```yml
coverage:
  status:
    project:
      desktop-e2e:
        flags:
          - desktop-e2e
    patch:
      desktop-e2e:
        flags:
          - desktop-e2e
```

If we later upload unit / web-e2e / desktop-e2e simultaneously, these lanes can continue to be separated by flags.

### Recommended new file

- `codecov.yml`

Initial responsibilities:

1. define the `desktop-e2e` flag status checks
2. decide whether patch / project thresholds should be enabled
3. control PR comment / status behavior

For the first version, stay conservative:

- enable display/statuses
- avoid hard minimum thresholds for the first 1-2 weeks, until the signal is stable

### Visualization benefits

Once integrated, the open source workflow gets:

1. desktop E2E coverage changes directly on PRs
2. file/line-level visibility into which code is actually exercised by packaged desktop scenarios
3. comparison across commits and trend tracking
4. a public, transparent signal for “is this desktop path exercised by real E2E?”

### Risks and mitigations

#### Risk 1: Codecov mixes desktop E2E with other coverage sources

Mitigation:

- use dedicated `flags`
- explicitly scope statuses in `codecov.yml`

#### Risk 2: auth instability for public repo / fork PR uploads

Mitigation:

- prefer OIDC
- keep GitHub artifact uploads as the fallback source of truth
- even if Codecov upload fails, the HTML artifact should still be produced

#### Risk 3: self-hosted macOS runner platform detection issues

Mitigation:

- explicitly set `os: macos` in the action
- validate first on a test branch

#### Risk 4: successful upload but misleading interpretation

Mitigation:

- document clearly in the plan and README that this lane only reflects the selected desktop E2E scenario for that run
- distinguish desktop E2E from unit coverage via flags and PR comment wording

## Recommended file changes

### Workflow

- `.github/workflows/desktop-e2e.yml`

Add:

- `coverage` input
- coverage artifact upload
- coverage summary output
- Codecov upload step

### E2E shell orchestration

- `e2e/desktop/scripts/run-e2e.sh`

Add:

- coverage directory initialization
- `NODE_V8_COVERAGE` / custom coverage env injection
- trigger coverage merge on exit, or run it as a dedicated workflow step

### Playwright Electron harness

- `e2e/desktop/tests/packaged-e2e.mjs`

Add:

- a target-aware Chromium precise coverage collector
- raw coverage dump / flush in `finally`
- scenario metadata binding

### Coverage merge/report scripts

Recommended additions:

- `e2e/desktop/scripts/merge-coverage.mjs`
- `e2e/desktop/scripts/report-coverage.mjs`

### Coverage visualization config

Recommended addition:

- `codecov.yml`

### Conditional runtime hooks

Keep runtime changes minimal:

- desktop main shutdown path
- controller startup/shutdown path

Enable them only when `NEXU_DESKTOP_E2E_COVERAGE=1`.

## Why not start with source-code instrumentation

An alternative would be to instrument desktop/controller code with Istanbul/Babel/Vite and then collect `__coverage__` during E2E. This is not recommended for the first version because:

1. packaged Electron + sidecars is a multi-process, multi-target runtime rather than a single frontend bundle
2. instrumentation changes output shape and runtime characteristics
3. it is less uniform across main / preload / sidecar / webview paths
4. this repo already has source maps, which makes a V8-based approach a better fit

So the first version should prefer:

- Node side: `NODE_V8_COVERAGE`
- Chromium side: `Profiler.startPreciseCoverage`
- reporting side: Istanbul merge

## Risks and mitigations

### Risk 1: launchd / sidecars do not inherit `NODE_V8_COVERAGE`

Mitigation:

- explicitly propagate the env in desktop runtime env generation
- emit redacted env diagnostics in coverage mode

### Risk 2: preload coverage is missing or misattributed

Mitigation:

- first validate whether preload scripts appear in Chromium precise coverage locally
- if they do not, add a preload-specific fallback collector

### Risk 3: unstable path remapping

Mitigation:

- keep a fixed mapping table
- add golden tests for each path category
- record the mapping version in `meta.json`

### Risk 4: coverage mode slows E2E too much

Mitigation:

- keep coverage off by default
- enable it only for targeted `source=build` runs
- do not enable it by default for nightly schedules

### Risk 5: force-killed processes lose coverage output

Mitigation:

- flush explicitly on graceful shutdown paths
- write raw coverage incrementally to reduce end-of-run single-point failure risk

## Acceptance criteria

The plan is successful once all of the following are true:

1. `desktop-e2e.yml` can run successfully with `coverage=true, source=build`.
2. A single E2E run produces a merged coverage report.
3. The report includes visible first-party hits from:
   - desktop main
   - renderer
   - at least one business webview page
   - controller code
4. The report does not contain large amounts of third-party code or duplicated file paths.
5. Different `mode` values produce distinct, separately archivable coverage results.
6. The CI summary shows a readable coverage overview for the run.

## Recommended implementation order

1. **Add the coverage-only workflow switch first**
2. **Integrate Node V8 coverage** (main + controller)
3. **Integrate Playwright/CDP precise coverage** (renderer + webview)
4. **Build remap/merge/report tooling**
5. **Add CI summary, artifact presentation, and Codecov upload last**

This gets us to a trustworthy 60-70% of the end-to-end coverage pipeline first, then fills in Chromium-side details, instead of aiming for a one-shot all-in implementation.

## Suggested future extensions

1. Add a matrix aggregation workflow to merge union coverage across `smoke/login/model/update/resilience/full`
2. Add PR baseline comparison so only changed files’ E2E coverage is highlighted
3. Keep desktop E2E coverage separate from Vitest/unit coverage to avoid metric confusion
4. Split `desktop-e2e` into per-mode flags for finer-grained visualization
5. If Codecov proves insufficient, add a custom coverage dashboard later
