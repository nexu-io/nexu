---
id: "20260317-desktop-nightly-openclaw-packaging-performance"
name: "Desktop Nightly Openclaw Packaging Performance"
status: new
created: "2026-03-17"
---

## Overview

Desktop Nightly macOS packaging is much slower than expected. The original hypothesis was that `openclaw-runtime` native binaries were being copied into the desktop sidecar and re-signed one by one during packaging, increasing both build time and artifact size.

This work investigates the real bottlenecks, trims unnecessary OpenClaw runtime payload, and adds enough timing visibility to separate OpenClaw-side slowdown from Electron Builder packaging work.

Constraints:
- Keep desktop packaging behavior safe and incremental.
- Prefer low-risk pruning first.
- Avoid breaking OpenClaw runtime entrypoints or required runtime docs.

## Research

### Existing System

- `apps/desktop/scripts/dist-mac.mjs` runs repo builds, installs `openclaw-runtime`, prepares sidecars, then calls Electron Builder.
- `apps/desktop/scripts/prepare-openclaw-sidecar.mjs` copies `openclaw-runtime/node_modules` into the packaged sidecar and, on macOS release builds, scans sidecar files to sign Mach-O binaries.
- `openclaw-runtime/prune-runtime-paths.mjs` prunes installed runtime content after `npm install` using an explicit path list.

### Observations From Logs

- The original workflow showed repeated `replacing existing signature` output for OpenClaw runtime binaries.
- After pruning the specific macOS arm64 native binary files, those per-binary re-sign logs disappeared.
- New timed logs showed the real OpenClaw-side bottleneck was not signing but scanning:
  - `prepare:openclaw-sidecar` scanned `39817` files
  - signed `0` native binaries
  - still spent `303.92s`
- Full timed run breakdown:
  - `prepare runtime sidecars`: `359.07s`
  - `electron-builder mac packaging`: `838.39s`
  - full `dist:mac`: `1225.76s`

### Options Evaluated

1. **Prune only exact native binary files** (recommended first step)
   - Lowest risk
   - Removes redundant OpenClaw binary signing work
   - Keeps package JS wrappers and metadata intact
2. **Prune whole optional packages**
   - Better size reduction
   - Higher behavioral risk for optional runtime paths
3. **Skip or narrow native-binary scan before `codesign`**
   - Strong time win even when no binaries remain
   - Complements binary pruning

### Recommendation

Keep the binary-only pruning strategy, and also narrow the OpenClaw sidecar scan so we do not shell out to `file` for every copied runtime file. After that, re-measure Electron Builder, which is still the largest remaining cost.

## Design

### Architecture

`openclaw-runtime install` -> prune selected runtime paths -> copy runtime into desktop sidecar -> inspect candidate native binaries only -> sign any remaining Mach-O files -> package app with Electron Builder

### Implemented / In Progress

1. Added timing logs around major `dist:mac` phases in `apps/desktop/scripts/dist-mac.mjs`.
2. Added timing logs inside OpenClaw sidecar signing in `apps/desktop/scripts/prepare-openclaw-sidecar.mjs`.
3. Changed OpenClaw runtime pruning to remove only the exact macOS binaries previously seen in signing logs.
4. Optimized sidecar signing scan to inspect only native-binary candidates (`.node`, `.dylib`, `.so`, `.dll`, `spawn-helper`) instead of every copied file.

### Files Modified So Far

- `openclaw-runtime/prune-runtime-paths.mjs` - binary-only runtime pruning rules for OpenClaw desktop packaging
- `apps/desktop/scripts/dist-mac.mjs` - phase timing logs for desktop macOS builds
- `apps/desktop/scripts/prepare-openclaw-sidecar.mjs` - native signing timing logs and candidate-only scan optimization

### Expected Outcome

- OpenClaw sidecar preparation should drop sharply from the previous ~304s scan-heavy path.
- If successful, the next dominant cost will remain inside Electron Builder packaging/signing.

## Plan

- [x] Phase 1: Remove redundant OpenClaw native signing inputs
  - [x] Identify exact OpenClaw runtime binaries being re-signed in Desktop Nightly
  - [x] Add binary-only prune targets in `openclaw-runtime/prune-runtime-paths.mjs`
  - [x] Confirm the old per-binary `replacing existing signature` logs disappear
- [x] Phase 2: Add observability and isolate slow stages
  - [x] Add per-phase timing logs to `apps/desktop/scripts/dist-mac.mjs`
  - [x] Add OpenClaw sidecar signing scan/sign timing logs
  - [x] Confirm the current hotspot is sidecar scan time plus Electron Builder packaging
- [x] Phase 3: Remove avoidable OpenClaw sidecar scan cost
  - [x] Restrict sidecar native inspection to likely native-binary candidates only
  - [x] Syntax-check updated build scripts
- [ ] Phase 4: Re-measure and decide next optimization target
  - [ ] Run Desktop Nightly again and capture new `prepare runtime sidecars` timing
  - [ ] Compare new Electron Builder timing after sidecar scan optimization
  - [ ] Decide whether to optimize Electron Builder signing, DMG build, or blockmap generation next

## Notes

### Current Status

- OpenClaw binary re-signing issue: addressed
- OpenClaw sidecar scan inefficiency: addressed in code, awaiting re-run confirmation
- Remaining largest bottleneck: Electron Builder packaging (`838.39s` in latest measured run)

### Open Questions

- After candidate-only scan lands, how much time remains in `prepare runtime sidecars`?
- Within Electron Builder, is the remaining cost dominated by app signing, DMG creation, or blockmap generation?
