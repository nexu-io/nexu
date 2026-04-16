# CI 优化方案（2026-03-26）

## 背景

当前 CI 的慢点主要集中在 macOS desktop 打包链路。以 `Desktop CI Dist` 运行 `23594039477` 为例：

- `macos-15-intel / x64` 总耗时约 **22m31s**
- `macos-14 / arm64` 总耗时约 **7m34s**
- 最慢步骤是 `Build unsigned macOS desktop bundle`
  - x64: **9m47s**
  - arm64: **3m05s**
- 其次是 `Install dependencies`
  - x64: **4m01s**
  - arm64: **1m06s**

另外，主 `CI` 工作流里存在重复校验：

- `typecheck` job 跑 `pnpm typecheck`
- `lint` job 跑 `pnpm lint`
- 而根脚本里的 `pnpm lint` 其实还会再次执行 `pnpm -r typecheck`

这意味着至少有一份 typecheck 是纯重复。

## 当前瓶颈

### 1. PR 上跑双架构 desktop dist，x64 成本过高

`desktop-ci-dist.yml` 对 PR 和 main 都跑：

- `macos-14 / arm64`
- `macos-15-intel / x64`

但从 wall time 看，PR 最慢路径基本被 Intel 打包拖住。

### 2. PR 打包产物过重

当前每次 desktop dist 都要求同时产出：

- `*.dmg`
- `*.zip`

而 workflow 里的运行验证实际依赖的是解包后的 `Nexu.app`。对 PR 来说，同时构建 DMG + ZIP 更像“发布前验证”，不是“变更正确性验证”。

### 3. 主 CI 有重复 typecheck

当前 `ci.yml` 的 `lint` job 已包含 typecheck，再单独跑 `typecheck` job 会重复消耗安装、解析、TS program 构建时间。

### 4. desktop dist 的触发范围偏大

`desktop-ci-dist.yml` 当前会被这些改动触发：

- `apps/desktop/**`
- `apps/web/**`
- `packages/shared/**`
- `openclaw-runtime/**`
- 若干根脚本/配置文件

这会导致很多“只改 web UI / shared schema / 非打包相关脚本”的 PR 也进入完整双架构 desktop 打包。

### 5. 打包脚本每次都做全量 sidecar 准备

`apps/desktop/scripts/dist-mac.mjs` 每次打包都会：

- build shared/controller/web/desktop
- 执行 `slimclaw:prepare`
- 执行 `prepare-runtime-sidecars --release`
- 清空 `release/` 和 `.dist-runtime/`

这是正确但昂贵的“全量重建”路径，适合 release，不适合作为每个 PR 的默认门禁。

## 优化目标

1. 将大多数 PR 的 CI wall time 降到 **10 分钟以内**
2. 将 desktop 相关 PR 的默认 macOS 校验压到 **8-12 分钟**
3. 保留 main 分支与发布前的双架构高置信度验证
4. 尽量先改 workflow 编排，少改构建系统本身

## 方案

### P0：把 PR 的 Desktop Dist 从“双架构”改成“arm64 默认，x64 延后”

**建议：**

- PR：只跑 `macos-14 / arm64`
- `main` push / release / 手动触发：继续跑 `arm64 + x64`

**收益：**

- 直接移除当前 PR 上最慢的 **22m** Intel 路径
- 对大部分开发者来说，PR wall time 会立刻下降到当前 arm64 水平附近

**实现方式：**

- 在 `desktop-ci-dist.yml` 中按 event 或 input 控制 matrix
- 或拆成两个 workflow：
  - `desktop-ci-pr.yml`：arm64 only
  - `desktop-ci-release.yml`：dual-arch

**风险：**

- x64 特有问题会从 PR 阶段后移到 main/release 阶段

**缓解：**

- 对桌面安装器、原生模块、路径处理等高风险改动，可通过 `workflow_dispatch` 或 label 触发 x64 额外校验

---

### P0：PR 上只构建验证所需的最小产物

**建议：**

- PR 默认只生成一种产物（优先 `zip` 或直接 `.app` bundle）
- `dmg` 仅在 main/release 构建

**原因：**

- 当前 CI 校验真正消费的是 `Nexu.app`
- `dmg` 更偏分发介质，不是 PR correctness gate 的核心输入

**预期收益：**

- 压缩 `electron-builder` 阶段时长
- 减少 artifact 上传体积与后置处理时间

**实现方向：**

- 给 `dist-mac.mjs` 增加 CI 模式参数，例如：
  - `--ci-pr` -> 仅构建 zip
  - `--release` -> 构建 dmg + zip
- workflow 里把“验证产物存在”从“必须有 dmg+zip”改成“PR 要求 zip，release 要求 dmg+zip”

---

### P0：去掉主 CI 里的重复 typecheck

**建议二选一：**

1. 保留独立 `typecheck` job，把根 `lint` 改成纯 Biome
2. 删除独立 `typecheck` job，只保留 `lint` 里的 typecheck

**更推荐：** 方案 1。

原因：

- 职责更清晰：`lint` 只做格式/静态规范，`typecheck` 只做 TS 正确性
- 两个 job 仍可并行
- 避免重复跑 `pnpm -r typecheck`

**预期收益：**

- 少一次 monorepo 全量 TS program 构建
- 少一个重复 install + 执行链路

---

### P1：收紧 desktop dist 的触发条件

**建议：** 把触发规则从“凡是 web/shared 变更都打包”调整为“只有可能影响打包结果或 desktop runtime 的改动才打包”。

可考虑分层：

- `desktop-ci-dev.yml`：继续覆盖 `apps/desktop/**`、`apps/web/**`、`packages/shared/**`
- `desktop-ci-dist.yml`：优先只覆盖
  - `apps/desktop/**`
  - `apps/controller/**`（如 sidecar 内容受影响）
  - `openclaw-runtime/**`
  - 打包脚本、根 lockfile、workspace 配置

**收益：**

- 纯 web UI PR 不再被完整 desktop dist 阻塞

**风险：**

- 需要认真梳理“哪些改动真的会影响 release bundle”

**建议做法：**

- 先保守收紧一轮
- 再用 1-2 周观察漏报情况

---

### P1：把“快速正确性”与“重型分发验证”拆成两层

**建议拆分：**

1. **Fast PR gate**
   - ubuntu: lint / typecheck / build
   - macOS arm64: desktop dev check
   - macOS arm64: lightweight packaged check

2. **Heavy packaging validation**
   - dual-arch dist
   - dmg 校验
   - 完整 artifact 上传

**触发建议：**

- Fast gate：所有相关 PR
- Heavy packaging：main、release tag、workflow_dispatch、或特定 label

这比“所有 PR 都跑发布级别验证”更符合 CI 分层原则。

---

### P2：评估缓存 sidecar/release 前置产物

这部分先做测量，再决定是否投入实现。

候选缓存对象：

- `apps/controller/dist`
- `apps/web/dist`
- `apps/desktop/dist-electron` / `dist`
- `.dist-runtime`
- `openclaw-runtime` 安装结果

**注意：** 这里复杂度更高，cache key 设计不好会引入脏缓存问题。相较之下，前面的 workflow 分层收益更大、风险更低，应该优先。

## 推荐落地顺序

### 第 1 周

1. `ci.yml` 去掉重复 typecheck
2. `desktop-ci-dist.yml` 改为 PR 仅 arm64
3. PR 上只要求最小桌面产物（优先 zip）

### 第 2 周

4. 收紧 desktop dist 触发范围
5. 将 heavy dual-arch dist 下沉到 main / manual dispatch

### 第 3 周（可选）

6. 基于日志补充 step 级耗时埋点
7. 评估 sidecar / runtime 产物缓存是否值得做

## 成功指标

- PR 的 `Desktop CI Dist` 中位耗时下降 **50%+**
- PR 总体 required checks wall time 下降 **30%+**
- main 分支的 dual-arch 通过率不下降
- 2 周内没有因触发条件过窄导致的漏检回归

## 我建议先改的 3 件事

1. **PR 只跑 arm64 desktop dist**
2. **PR 不再强制构建 DMG**
3. **根 `lint` 去掉内嵌 typecheck，消除重复校验**

这三项改动最小、收益最大、回滚也最容易。
