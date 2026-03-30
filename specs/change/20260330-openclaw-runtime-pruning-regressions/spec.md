---
id: 20260330-openclaw-runtime-pruning-regressions
name: Openclaw Runtime Pruning Regressions
status: researched
created: '2026-03-30'
---

## Overview

### Problem Statement
- P0 bugs #425 and #431 both point to user-visible OpenClaw capability regressions in the shipped Nexu runtime: PDF content recognition fails, and webpage review/browser actions are reported as unsupported.
- These regressions matter because they break core attachment and browser-assisted agent workflows in the latest build.

### Goals
- Confirm whether #425 and #431 are both caused by Nexu's OpenClaw runtime dependency pruning.
- Document the evidence path from issue symptom → runtime dependency → prune rule → packaged sidecar behavior.
- Capture practical reproduction paths suitable for validating fixes.

### Scope
- In scope: `openclaw-runtime` install/prune flow, desktop OpenClaw sidecar preparation, and the specific runtime dependencies behind PDF extraction and Playwright-backed browser features.
- Out of scope: implementing the fix, changing OpenClaw upstream source, or redesigning browser/PDF feature UX.

### Constraints
- Do not modify OpenClaw source code directly; fix must happen in Nexu-owned runtime packaging/pruning flow.
- Desktop sidecar content is derived from `openclaw-runtime/node_modules`, so runtime install/prune behavior affects packaged desktop builds.

### Ideas & Approaches
- Restore only the pruned dependencies that are proven runtime-required for these P0 scenarios.
- Keep pruning for low-risk packages, but treat `pdfjs-dist` and Playwright runtime support as required for supported Nexu workflows.

### Open Questions
- For #431, is restoring `playwright-core` alone sufficient in Nexu packaging, or must the full Playwright package/browser-support path also be restored for the user-facing workflow?
- Should the final fix remove these prune rules entirely or gate them behind an explicit lightweight-build mode?

### Success Criteria
- Spec documents a reproducible path for both bugs and clearly ties each failure to the current pruning chain.
- Team can use the spec to implement and verify a targeted runtime-packaging fix.

## Research

### Existing System
- Root install uses `openclaw-runtime:install` → `npm --prefix ./openclaw-runtime run install:cached` (`package.json:17`).
- Cached runtime install runs a normal npm install/ci and then always executes `node ./prune-runtime.mjs` when inputs changed (`openclaw-runtime/postinstall.mjs:94-96`).
- Pruning targets are defined centrally in `openclaw-runtime/prune-runtime-paths.mjs`.
- Desktop packaging copies `openclaw-runtime/node_modules` into the sidecar, excluding only `openclaw` while staging a patched copy of that package (`apps/desktop/scripts/prepare-openclaw-sidecar.mjs:787-796`).

### Reproduction Paths
1. **Issue #425 — PDF file recognition failure**
   - User path: send a PDF file to a model in a Discord channel or DM and ask it to analyze the file.
   - Expected failing symptom: runtime returns `Optional dependency pdfjs-dist is required for PDF extraction: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pdfjs-dist' imported from .`
   - Good validation path after a fix: repeat the same PDF upload flow and confirm extracted PDF content is analyzed instead of throwing the missing dependency error.
2. **Issue #431 — Playwright runtime not available**
   - User path: ask any model to open/review a webpage.
   - Expected failing symptom: browser-assisted workflow is refused as unsupported, matching OpenClaw's Playwright-unavailable error path.
   - Good validation path after a fix: repeat the webpage review prompt and confirm the runtime can execute a Playwright-backed browser action rather than returning an unsupported/browser-unavailable response.

### Key Findings
- `openclaw-runtime/prune-runtime-paths.mjs:23-31` explicitly prunes `node_modules/pdfjs-dist`, and the file comment already warns this may break PDF parsing / attachment ingestion paths.
- OpenClaw's PDF fallback explicitly depends on `pdfjs-dist` (`openclaw-runtime/node_modules/openclaw/docs/tools/pdf.md:83`).
- Built OpenClaw bundles throw the exact missing-dependency error seen in #425 when `pdfjs-dist` cannot be imported.
- `openclaw-runtime/prune-runtime-paths.mjs:54-59` explicitly prunes `node_modules/playwright-core`, and the file comment already warns this may break browser control / pw-ai / Playwright-backed automation.
- OpenClaw docs state some browser features require Playwright and will return `Playwright is not available in this gateway build` when unavailable (`openclaw-runtime/node_modules/openclaw/docs/tools/browser.md:335-342`).
- Current local runtime/sidecar trees do not contain `pdfjs-dist` or `playwright-core`, matching the prune rules and the observed failures.

### Options Evaluated
1. **Dependency pruning is the shared root cause** — recommended
   - Evidence directly links both issue symptoms to packages explicitly deleted by Nexu-owned prune rules.
   - This matches both the runtime error strings and the desktop sidecar packaging flow.
2. **Only #425 is pruning-related, #431 is a separate browser integration issue**
   - Less likely based on current evidence, but still possible if #431 additionally requires the full Playwright package or browser binaries beyond `playwright-core`.

### Recommendation
- Treat both issues as OpenClaw runtime pruning regressions first.
- Fix and verify the pruning/packaging chain before investigating secondary browser-support gaps.

## Design

<!-- Technical approach, architecture decisions -->

## Plan

<!-- Break down implementation and verification into steps -->

- [ ] Phase 1: Implement the first part of the feature
  - [ ] Task 1
  - [ ] Task 2
  - [ ] Task 3
- [ ] Phase 2: Implement the second part of the feature
  - [ ] Task 1
  - [ ] Task 2
  - [ ] Task 3
- [ ] Phase 3: Test and verify
  - [ ] Test criteria 1
  - [ ] Test criteria 2

## Notes

<!-- Optional: Alternatives considered, open questions, etc. -->
