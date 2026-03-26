# CI Packaging Follow-ups

## Goal

继续压缩 desktop CI 尤其是 heavy packaging 的总耗时，同时保留 PR fast gate 和 main/release 打包验证的置信度。

## Current state

- [x] PR `desktop-ci-dist-lite` 已降级为 fast gate：`arm64` + `dir` + packaged runtime health check
- [x] PR 上重复的 `build` / `test` 已移出 `desktop-ci-dist-lite`
- [x] `dist-mac.mjs` 已加入 timing，并确认当前主要瓶颈集中在：
  - `prepare runtime sidecars`
  - `run electron-builder`
- [x] `prepare-runtime-sidecars` / `prepare-openclaw-sidecar` 已补充子步骤 timing
- [ ] heavy workflow 已拆出共享 build/test prepare，但 sidecar/runtime 产物仍按架构分别准备

## Success criteria

- [ ] `Desktop CI Dist Full` 不再为 `arm64` / `x64` 重复执行完整的 runtime/sidecar prepare
- [x] heavy workflow 的共享 build 产物已能被 package matrix 复用
- [ ] packaging 逻辑为后续 Windows 复用保留清晰边界（common prepare vs platform package）
- [ ] CI 日志能清晰显示 prepare 和 package 各自耗时

## Execution checklist

### 1. Split heavy workflow into prepare + package matrix

- [ ] 新建/改造 heavy workflow 的 `prepare-runtime` job
  - [x] `pnpm install --frozen-lockfile`
  - [x] `pnpm build`
  - [ ] `node apps/desktop/scripts/prepare-runtime-sidecars.mjs --release`
  - [x] 输出/上传 prepare artifact
- [x] 新建/改造 heavy workflow 的 `package` matrix job
  - [x] matrix: `arm64` / `x64`
  - [x] 下载 prepare artifact
  - [x] 执行 `pnpm dist:mac:unsigned`
  - [x] 保留 packaged runtime validation
- [ ] 确认 heavy workflow 中 prepare 只运行一次
- [ ] 确认 `arm64` / `x64` package job 不再重复完整 prepare

### 2. Introduce reusable prepare outputs

- [ ] 确认并固定 prepare artifact 列表
  - [x] `apps/controller/dist`
  - [x] `apps/web/dist`
  - [x] `apps/desktop/dist`
  - [x] `apps/desktop/dist-electron`
  - [ ] `openclaw-runtime/node_modules`
  - [ ] `apps/desktop/.dist-runtime`
- [x] 标注哪些产物是跨架构可复用的
- [x] 标注哪些产物必须在 package 阶段重新生成
- [ ] 将 prepare artifact 列表写入 workflow 注释或配套文档

### 3. Separate common assets from arch-specific packaging

- [ ] 梳理 common prepare vs platform package 边界
- [ ] 审视这些脚本的职责是否需要再拆分
  - [ ] `apps/desktop/scripts/prepare-controller-sidecar.mjs`
  - [ ] `apps/desktop/scripts/prepare-openclaw-sidecar.mjs`
  - [ ] `apps/desktop/scripts/prepare-web-sidecar.mjs`
  - [ ] `apps/desktop/scripts/dist-mac.mjs`
- [ ] 记录哪些 sidecar 内容未来可被 Windows 复用
- [ ] 记录哪些 sidecar/package 内容是 macOS 专用

### 4. Optimize controller sidecar dependency closure

- [x] 给 `copyRuntimeDependencyClosure` 增加 timing
- [ ] 确认 controller sidecar 是否是 sidecar prepare 的主要耗时来源
- [ ] 评估指纹缓存方案
  - [ ] 基于 `apps/controller/package.json`
  - [ ] 基于 `pnpm-lock.yaml`
  - [ ] 基于 `apps/controller/dist/**`
  - [ ] 基于关键静态目录 hash
- [ ] 评估分层输出方案
  - [ ] `node_modules` 层
  - [ ] `dist/static/config` 层
- [ ] 选定下一步落地方向（缓存 or 分层 or 两者结合）

### 5. Keep PR fast gate minimal

- [x] `desktop-ci-dev` 负责 `build` / `test` / `check:dev`
- [x] `desktop-ci-dist-lite` 只负责 packaged-path correctness
- [x] PR workflow 不再上传 desktop build artifact
- [x] PR workflow 不再生成 `zip` / `dmg` / blockmap
- [ ] 后续改动避免把重复的 `build/test` 再引回 `desktop-ci-dist-lite`

## Suggested order

- [ ] 第 1 步：拆 `desktop-ci-dist-full.yml` 为 prepare + package matrix
- [ ] 第 2 步：固化 prepare artifact 列表
- [x] 第 3 步：给 controller sidecar closure copy 增加 timing
- [ ] 第 4 步：依据 timing 决定是否做 closure fingerprint / 分层复用
- [ ] 第 5 步：为 Windows 预留 common prepare / platform package 边界

## Verification checklist

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] 手动检查 heavy workflow YAML 依赖关系是否正确
- [ ] 观察 heavy workflow 新 timing：prepare vs package 是否明显分离

## Notes

- [ ] 不跨 run 强缓存 `.dist-runtime`，优先做 workflow 内 artifact 复用
- [ ] 下一阶段主要收益点集中在 heavy workflow，不再优先优化 PR fast gate
- [ ] Windows 后续应复用 prepare/package 分层思路，而不是直接复用 mac 专用打包产物

## Current shared prepare artifact set

- [x] `packages/shared/dist`
- [x] `apps/controller/dist`
- [x] `apps/web/dist`
- [x] `apps/desktop/dist`
- [x] `apps/desktop/dist-electron`
- [ ] `openclaw-runtime/node_modules`（暂未共享，避免跨架构风险）
- [ ] `apps/desktop/.dist-runtime`（暂未共享，sidecar/native 内容仍需按架构准备）

## Current boundary decision

- [x] Common prepare（当前已共享）
  - [x] shared/controller/web/desktop build outputs
  - [x] macOS launchd e2e / unit test 前置验证
- [ ] Platform package（当前仍待继续下沉）
  - [x] arch-specific `pnpm install`
  - [x] arch-specific `dist:mac:unsigned`
  - [ ] arch-specific sidecar/runtime prepare 进一步拆层
