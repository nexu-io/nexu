---
id: "20260317-openclaw-runtime-pruning-baseline"
name: "Openclaw Runtime Pruning Baseline"
status: new
created: "2026-03-17"
---

## Overview

当前仓库里存在两套彼此独立的 OpenClaw runtime 裁剪逻辑，它们共同影响 `openclaw-runtime/node_modules/openclaw` 及其运行依赖，但没有统一的单一真相来源，导致不同运行场景使用的 runtime 基线并不一致。

第一套裁剪逻辑位于 `openclaw-runtime/prune-runtime.mjs`，由根目录 `postinstall` 和 `pnpm openclaw-runtime:install` 触发。它发生在 `openclaw-runtime` 安装阶段，当前会按照 `openclaw-runtime/prune-runtime-paths.mjs` 删除若干 `node_modules` 依赖目录，例如 `koffi`、`pdfjs-dist`、`playwright-core` 等。这套裁剪会影响所有依赖 repo-local OpenClaw runtime 的场景，包括普通本地开发、desktop 开发和 desktop 打包，因为它们都以 `openclaw-runtime/` 作为起点。

第二套裁剪逻辑位于 `apps/desktop/scripts/lib/prune-openclaw-package.mjs`，由 `apps/desktop/scripts/prepare-openclaw-sidecar.mjs` 和 `apps/desktop/scripts/prepare-pglite-sidecar.mjs` 调用。它发生在 desktop sidecar 准备阶段：`pnpm desktop:start` 会通过 `apps/desktop/dev.sh` 调用 `prepare:openclaw-sidecar`，`pnpm desktop:dist:mac` 会通过 `apps/desktop/scripts/prepare-runtime-sidecars.mjs --release` 调用同一套 sidecar 准备流程。这套裁剪当前会删除 `node_modules/openclaw/docs`，并进一步删除 `node_modules/openclaw/extensions/*/src`。

按场景拆开看，当前裁剪行为如下：

- `dev`：使用 `openclaw-runtime` 时，只会命中 `openclaw-runtime/prune-runtime.mjs`，不会执行 desktop sidecar 的二次裁剪。
- `desktop dev`：先使用已经过 `openclaw-runtime/prune-runtime.mjs` 处理的 `openclaw-runtime` 作为输入，再在 sidecar 准备阶段额外执行 `prune-openclaw-package.mjs`。
- `desktop dist`：同样先基于已经过 `openclaw-runtime/prune-runtime.mjs` 处理的 `openclaw-runtime`，然后在 release sidecar 组装阶段再次执行 `prune-openclaw-package.mjs`。

整体流程可以概括为：先安装并裁剪 `openclaw-runtime` 的依赖闭包，再由 desktop 流程复制或链接这份 runtime 到 sidecar，最后对 sidecar 中的 `openclaw` 包内容做第二次裁剪。也就是说，desktop 相关场景实际运行的并不是“单次裁剪后的 runtime”，而是“在基础 runtime 之上又做过追加裁剪的 runtime”。

现在暴露出来的问题是，这两套规则没有统一管理，导致普通开发场景和 desktop 场景看到的 runtime 内容不同。具体表现是：Feishu extension 的入口 `index.ts` 仍然依赖 `./src/bitable.js`、`./src/channel.js` 等源码路径，但 desktop sidecar 裁剪会删除 `extensions/feishu/src`，从而在 `desktop dev` / `desktop dist` 场景出现插件加载失败，而在仅依赖 `openclaw-runtime/prune-runtime.mjs` 的场景里不一定提前暴露同类问题。

我们要达成的目标是：为 OpenClaw runtime 建立一份统一、可复用、可验证的裁剪基线，让 `dev`、`desktop dev`、`desktop dist` 三条链路都消费同一套裁剪规则和同一份运行时内容；任何裁剪带来的运行时破坏，都应该在最早的本地开发阶段暴露，而不是只在 desktop sidecar 或打包产物中出现。与此同时，这份统一裁剪基线必须以“保持 OpenClaw 运行正确”为前提，不能为了缩小体积而删除实际运行仍需依赖的包内源码或模块文件。

## Research

<!-- What have we found out? What are the alternatives considered? -->

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
