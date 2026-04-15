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
- Should the final fix remove these prune rules entirely or gate them behind an explicit lightweight-build mode?

### Success Criteria
- Spec documents a reproducible path for both bugs and clearly ties each failure to the current pruning chain.
- Team can use the spec to implement and verify a targeted runtime-packaging fix.

## Research

### Existing System (at investigation time)
- Root install entered through the repo-level runtime install flow for `openclaw-runtime`, which drove the cached install/prune path under that package.
- Cached runtime install runs a normal npm install/ci and then always executes `node ./prune-runtime.mjs` when inputs changed (`openclaw-runtime/postinstall.mjs:94-96`).
- Pruning targets are defined centrally in `openclaw-runtime/prune-runtime-paths.mjs`.
- Desktop packaging copies `openclaw-runtime/node_modules` into the sidecar, excluding only `openclaw` while staging a patched copy of that package (`apps/desktop/scripts/prepare-openclaw-sidecar.mjs:787-796`).

### Minimal Reproduction Paths
1. **Issue #425 — PDF file recognition failure**
   - In the normal IM conversation entrypoint, upload a PDF attachment and ask the model to directly read, summarize, or analyze the file contents.
   - Prefer a prompt that requires actual PDF text extraction from the attachment itself, rather than asking about the file at a high level or relying on user-pasted text/images.
   - Expected failing symptom: the model refuses direct PDF reading and reports that the current environment is missing a PDF parsing dependency; at the runtime layer this corresponds to `Optional dependency pdfjs-dist is required for PDF extraction: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pdfjs-dist' imported from .`
   - Validation after a fix: repeat the same attached-PDF flow and confirm the model can extract and analyze the PDF contents directly instead of failing with a missing-PDF-dependency response.
   - Post-fix validation status:
     - Direct local-path attempts still failed when the PDF tool was pointed at files outside OpenClaw's allowed media directories (`Local media path is not under an allowed directory`), which is a separate sandbox/path-policy issue rather than a missing runtime dependency.
     - URL-based validation now succeeds end-to-end: the agent downloaded `https://www.orimi.com/pdf-test.pdf`, called the `pdf` tool successfully, and returned parsed content from the document (`sessions/77da3690-21f7-4102-889d-cf5b30ac4818.jsonl:47-51`).
2. **Issue #431 — Playwright runtime not available**
   - In the normal IM conversation entrypoint, ask a model to open a webpage and then perform a real browser interaction such as clicking a link/button, expanding a section, or reporting where a click navigates.
   - Prefer interaction-heavy prompts over plain webpage summarization, because simple “review this page” requests may succeed through non-Playwright fallback paths and do not reliably reproduce the bug.
   - Expected failing symptom: the model can sometimes open/read the page but refuses or fails the interaction step with an unsupported / browser-unavailable / missing-Playwright style response, matching OpenClaw's Playwright-unavailable error path.
   - Validation after a fix: repeat the same interaction prompt and confirm the runtime can execute the Playwright-backed action (for example, complete the click and report the resulting destination or changed page state) rather than returning an unsupported/browser-unavailable response.
   - Post-fix validation status:
     - Local validation succeeded: the agent opened `https://nettee.io/`, clicked the “全部文章 (26) →” entry, and correctly reported the resulting destination `https://nettee.io/zh/blog`, confirming Playwright-backed interaction now works in the local runtime.

### Key Findings (from the investigation-time implementation)
- `openclaw-runtime/prune-runtime-paths.mjs:23-31` explicitly prunes `node_modules/pdfjs-dist`, and the file comment already warns this may break PDF parsing / attachment ingestion paths.
- OpenClaw's PDF fallback explicitly depends on `pdfjs-dist` (`openclaw-runtime/node_modules/openclaw/docs/tools/pdf.md:83`).
- Built OpenClaw bundles throw the exact missing-dependency error seen in #425 when `pdfjs-dist` cannot be imported.
- `openclaw-runtime/prune-runtime-paths.mjs:54-59` explicitly prunes `node_modules/playwright-core`, and the file comment already warns this may break browser control / pw-ai / Playwright-backed automation.
- OpenClaw docs state some browser features require Playwright and will return `Playwright is not available in this gateway build` when unavailable (`openclaw-runtime/node_modules/openclaw/docs/tools/browser.md:335-342`).
- PDF fallback also requires `@napi-rs/canvas`; pruning that subtree caused the PDF path to remain broken until it was restored alongside `pdfjs-dist`.
- After updating Nexu-owned prune rules to keep `pdfjs-dist`, `@napi-rs`, and `playwright-core`, local validation now succeeds for URL-downloaded PDF parsing and Playwright-backed click/navigation flows.
- The remaining direct-attachment/local-file PDF failures observed during validation were caused by OpenClaw's allowed-directory restriction for local media paths, not by missing runtime dependencies.

### Options Evaluated
1. **Dependency pruning is the shared root cause** — recommended
   - Evidence directly links both issue symptoms to packages explicitly deleted by Nexu-owned prune rules.
   - Restoring the pruned runtime dependencies resolved the local URL-based PDF flow and the Playwright interaction flow.
2. **Only #425 is pruning-related, #431 is a separate browser integration issue**
   - Current local validation does not support this anymore; Playwright interaction started working once the runtime pruning fix landed.

### Recommendation
- Treat both issues as OpenClaw runtime pruning regressions first.
- Keep `pdfjs-dist`, `@napi-rs`, and `playwright-core` in the Nexu runtime.
- Treat any remaining attached/local PDF failures as a separate follow-up on file handoff / allowed-directory policy rather than on missing runtime dependencies.

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
