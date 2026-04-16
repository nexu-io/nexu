# mac 侧功能验证方案

## 分支

- 当前分支：`chore/mac-validation-plan`
- 来源分支：`feat/windows-distribution-smoke`
- 目标：在 mac 环境下单独验证桌面分发与运行时主链路，确认近期跨平台重构没有破坏既有 mac 行为。

## 这次先看清的核心节点

### 1. mac 打包入口

- 根脚本入口：`package.json`
  - `pnpm dist:mac`
  - `pnpm dist:mac:unsigned`
  - `pnpm check:dist`
- 桌面打包入口：`apps/desktop/package.json`
  - `dist:mac` -> `node ./scripts/dist-mac.mjs`

### 2. mac 打包主流程

核心文件：`apps/desktop/scripts/dist-mac.mjs`

当前打包链路不是单纯 electron-builder，一共包含这些关键阶段：

1. 生成/刷新 `build-config.json`
2. 清理 `apps/desktop/release` 与 `.dist-runtime`
3. 构建 `@nexu/shared`
4. 构建 `@nexu/controller`
5. 准备 slimclaw-managed OpenClaw runtime
6. 构建 `@nexu/web`
7. 构建 `@nexu/desktop`
8. 上传 sourcemaps
9. 执行 `prepare-runtime-sidecars.mjs --release`
10. 处理 DMG tooling
11. 处理 pnpm symlink（`sharp` / `@img`）
12. 运行 electron-builder 生成 `dmg` / `zip`
13. 对 notarized app 做 stapling

直接结论：**mac 验证不能只看 app 能不能起，还必须覆盖 sidecar 准备、打包产物、packaged 启动后的运行时接管。**

### 3. packaged smoke 入口

核心文件：`scripts/desktop-check-dist.mjs`

它会：

- 自动定位 `Nexu.app/Contents/MacOS/Nexu`
- 注入隔离的 `PACKAGED_HOME` / `PACKAGED_USER_DATA_DIR` / `PACKAGED_LOGS_DIR`
- 启动 packaged app
- 调用 `scripts/desktop-ci-check.mjs dist`
- 完成后 kill 掉 app 进程

这说明 **`pnpm check:dist` 是现成的 packaged smoke 主入口**，应成为 mac 验证方案的主检查器，而不是重新手搓脚本。

### 4. packaged 校验实际判定项

核心文件：`scripts/desktop-ci-check.mjs`

dist 模式下会检查：

- 端口是否起来
  - controller `50800`
  - web `50810`
- readiness 是否通过
  - `/api/internal/desktop/ready`
  - `/workspace`
  - openclaw `/health`
- 进程是否存活
- `desktop-diagnostics.json` 是否满足：
  - `coldStart.status === "succeeded"`
  - renderer `didFinishLoad === true`
  - workspace webview `didFinishLoad === true`
  - `controller` / `openclaw` unit 处于 `running`
  - `lastError === null`
- 同时抓取并检查持久化日志：
  - `cold-start.log`
  - `desktop-main.log`
  - `runtime-units/*.log`

直接结论：**mac 验证的成功标准已经在代码里比较明确，优先复用这些判定，而不是口头判断“看起来能用”。**

### 5. mac 特有运行时骨架

核心文件：

- `apps/desktop/main/platforms/mac/launchd-lifecycle.ts`
- `apps/desktop/main/platforms/mac/launchd-paths.ts`
- `apps/desktop/main/services/quit-handler.ts`
- `specs/guides/desktop-runtime-guide.md`

mac 侧这次最关键的特殊点不是 UI，而是 **packaged + launchd + 外置 sidecar/runtime**：

- packaged 模式下会把 runner / controller sidecar / openclaw sidecar 外置到 `~/.nexu/runtime/`
- 启动时会尝试基于 `runtime-ports.json` attach 到已有服务
- identity 不匹配会转为 cold start
- stale session 会自动 bootout
- 退出时有两条分支：
  - Quit Completely：停 launchd 服务并删 `runtime-ports.json`
  - Run in Background：隐藏窗口但保留服务

直接结论：**mac 验证的核心不是“打包成功”，而是“打包产物启动后，launchd 生命周期仍然符合预期”。**

## 风险判断

当前最值得优先验证的风险点有 5 个：

1. **sidecar 打包成功但 packaged 冷启动失败**
   - 通常会体现在 `prepare-runtime-sidecars`、runtime roots、或外置路径解析
2. **launchd attach / stale cleanup 逻辑回归**
   - 表现为重复拉起、误 attach、旧会话污染
3. **退出路径回归**
   - 表现为 Quit Completely 后服务未停，或 Background 模式错误退出
4. **packaged 日志与诊断产物缺失**
   - 会导致 smoke 脚本无法准确判断成功/失败
5. **mac 特有签名/打包路径问题**
   - 尤其是 symlink、sidecar 资源、unsigned 本地验证路径

## 验证策略

原则：**先验证本地开发主链路，再进入 packaged 验证。**

原因：

- 当前分支近期改动很大一部分就在 `tools/dev`、桌面运行时平台抽象、controller/web/desktop 的协同启动链路
- 如果本地开发链路本身已经异常，那么后续 packaged 失败没有分析价值，容易把问题误判成打包/launchd 问题
- mac 环境下要确保“日常开发可用”与“分发链路可用”两条线都成立，其中**本地开发应作为前置 gate**

### Phase 0：本地开发基线验证（必须先过）

目的：确认当前 mac 环境下，日常开发主链路没有被近期平台重构破坏。

建议执行：

```bash
pnpm --filter @nexu/shared build
pnpm dev start
pnpm dev logs desktop
pnpm dev status desktop
pnpm dev status controller
pnpm dev status web
pnpm dev status openclaw
pnpm dev stop
```

通过标准：

- 四个服务都能启动/停止
- `desktop` / `controller` / `web` / `openclaw` 状态正常
- `pnpm dev logs desktop` 中没有明显冷启动阻塞
- 本地开发模式下可以完成桌面壳启动与 workspace 主界面加载

建议补充的人工检查：

1. 打开桌面窗口后确认没有白屏
2. 确认 webview/workspace 实际可见
3. 至少执行一次 stop -> restart -> stop，确认 `tools/dev` 编排是稳定的

如果 Phase 0 没过：

- **暂停 packaged 验证**
- 优先排查 `tools/dev`、桌面冷启动、controller/web readiness、OpenClaw 启动链路

### Phase 1：本地开发稳定性加压验证

目的：确认问题不只是“首次能启动”，而是本地开发日常循环可用。

建议执行：

```bash
pnpm dev start
pnpm dev restart
pnpm dev status desktop
pnpm dev status controller
pnpm dev status web
pnpm dev status openclaw
pnpm dev stop
```

重点观察：

- `restart` 后各服务是否能重新回到 ready
- 是否出现残留端口、僵尸进程、重复拉起
- 日志路径是否按预期写入 `.tmp/desktop/electron/logs` 与 `.tmp/dev/logs/...`

通过标准：

- start / restart / stop 三段循环都稳定
- 不出现明显的会话残留和状态错乱

### Phase 2：unsigned mac 打包闭环

目的：先验证本机可重复执行的本地打包链路，不把 notarization 当成前置阻塞。

建议执行：

```bash
pnpm dist:mac:unsigned
```

关注点：

- `dist-mac.mjs` 各 timed step 是否完整通过
- `apps/desktop/release/` 下是否生成 `.app` / `.dmg` / `.zip`
- `.dist-runtime` 是否准备完成

通过标准：

- 打包完整结束
- 产物存在
- 没有 sidecar 缺失/资源缺失类错误

### Phase 3：packaged smoke 主链路

目的：验证 packaged app 在隔离 home 下可以完成冷启动并通过自动检查。

建议执行：

```bash
pnpm check:dist
```

通过标准：

- `desktop-check-dist.mjs` 能成功拉起 packaged app
- `desktop-ci-check.mjs dist` 通过
- 检查项至少满足：
  - controller/web/openclaw readiness 正常
  - renderer 与 workspace webview 完成加载
  - diagnostics 中 `coldStart.status=succeeded`
  - `controller` / `openclaw` unit 为 running 且无 lastError

输出物：

- `.tmp/desktop-ci-test/`
- packaged logs
- runtime unit logs

### Phase 4：mac launchd 生命周期专项

目的：确认 recent refactor 后，mac 特有的后台驻留与重新附着行为没坏。

建议验证 4 个场景：

1. **首次冷启动**
   - 关注是否生成外置 runner / controller sidecar / openclaw sidecar
2. **二次启动 attach**
   - 关注是否复用已有服务而非重复冷启动
3. **Quit Completely**
   - 关注 launchd 服务是否 bootout，`runtime-ports.json` 是否清理
4. **Run in Background**
   - 关注窗口隐藏后服务是否仍保持可用

重点观察文件/目录：

- `~/Library/LaunchAgents/runtime-ports.json`
- `~/Library/LaunchAgents/io.nexu.controller.plist`
- `~/Library/LaunchAgents/io.nexu.openclaw.plist`
- `~/.nexu/runtime/nexu-runner.app/`
- `~/.nexu/runtime/controller-sidecar/`
- `~/.nexu/runtime/openclaw-sidecar/`

通过标准：

- attach 行为符合预期
- 完全退出后不会残留错误会话
- 后台运行模式不误停服务

### Phase 5：异常恢复专项

目的：确认 stale session / 残留状态不会让下次 packaged 启动卡死。

建议场景：

- 启动 packaged app 后强杀 Electron
- 再次启动 packaged app
- 观察是否触发 stale session recovery，并恢复到正常服务状态

通过标准：

- 不会永久卡在 attach
- 不会因为旧 `runtime-ports.json` 挂死主链路

## 建议执行顺序

1. `Phase 0` 先确认本地开发可用
2. `Phase 1` 再确认本地开发循环稳定
3. `Phase 2` 做 `dist:mac:unsigned`
4. `Phase 3` 跑 `pnpm check:dist`
5. 只有在 smoke 通过后，再做 `Phase 4/5` 的人工生命周期专项

原因很简单：

- 如果本地开发链路先坏了，packaged 失败的定位会失真
- 只有本地开发主链路稳定，packaged 主链路失败才值得归因到打包/launchd/sidecar 外置
- 只有 packaged 主链路通了，launchd attach / background / stale recovery 的专项验证才有意义

## 失败时优先排查顺序

1. `apps/desktop/scripts/dist-mac.mjs` 打包阶段失败点
2. `apps/desktop/scripts/prepare-runtime-sidecars.mjs` sidecar 准备
3. `scripts/desktop-check-dist.mjs` packaged 启动与隔离目录注入
4. `scripts/desktop-ci-check.mjs` readiness / diagnostics / logs 判定
5. `apps/desktop/main/platforms/mac/launchd-lifecycle.ts` attach / teardown
6. `apps/desktop/main/platforms/mac/launchd-paths.ts` 外置 runner / sidecar 路径解析
7. `apps/desktop/main/services/quit-handler.ts` 退出与后台逻辑

## FAQ / 已知事项

### Q: 为什么 desktop 会突然显示 offline / Agent Starting，但 web / controller / desktop 都还在运行？

高概率是 **`openclaw` 被测试清理流程误杀** 了，而不是 desktop 壳本身坏掉。

已确认现象：

- `desktop / web / controller` 仍显示 running
- `openclaw` 变成 `stale`
- controller 日志持续出现：
  - `openclaw_ws_error`
  - `openclaw_ws_closed code=1006`
- desktop 日志出现：
  - `external runtime openclaw unavailable on port 18789`

当前已知触发方式：

- 在活跃的本地 dev stack 上直接跑 `pnpm test`
- 某些 launchd / teardown / orphan cleanup 测试会把当前 dev `openclaw` 误识别为 orphan 并杀掉

临时处理方式：

```bash
pnpm dev restart openclaw
```

如果 controller 仍未自动恢复，再补看：

```bash
pnpm dev status openclaw
pnpm dev logs controller
pnpm dev logs openclaw
```

当前决定：

- **先记为 FAQ，不在本轮处理测试隔离问题**
- 本地人工验证期间，避免在同一套活跃 dev stack 上直接运行整套 `pnpm test`

## 本轮结论

当前代码已经具备一套较完整的 mac 验证骨架，但**正确顺序必须是“先本地开发、后 packaged 分发”**。最优策略是：

1. 先把 `pnpm dev` 主链路验证干净
2. 再围绕 `dist:mac:unsigned` + `check:dist` 建立 packaged 闭环
3. 最后补 launchd 生命周期专项检查

下一步建议直接进入执行态：

1. 先跑 `Phase 0`
2. 再跑 `Phase 1`
3. 然后才进入 `pnpm dist:mac:unsigned`
4. 再跑 `pnpm check:dist`
5. 若 packaged 主链路通过，再做 attach / background / stale recovery 人工专项
