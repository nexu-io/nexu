# Dev Controller 启动崩溃 (exit 78) 调试记录

**日期**: 2026-04-07
**症状分支**: `refactor/openclaw-skills-watcher-nudge`(branch off `origin/main`)
**结论**: 这不是 openclaw 版本问题,也不是当前分支两个提交的问题,而是上游 `main` 的 dingtalk channel 提交 (#775) 引入的 dev 模式半构建问题。

---

## 1. 症状

`pnpm start` 启动 dev stack 时反复失败,呈现两种相关现象:

### 现象 A — Controller 启动后立即崩溃 (第一次尝试)
```
[bootstrap] controller installService done label=io.nexu.controller.dev
[bootstrap] controller ensureRunning status=running pid=23300 label=io.nexu.controller.dev
[bootstrap] controller post-start validation failed
  reason=launchd_stopped launchdStatus=stopped launchdPid=none
[bootstrap] retrying controller startup originalPort=50800 retryPort=50801
[bootstrap] Controller startup recovery failed
```

进程被 fork 出来 (PID 23300),但马上以 **exit code 78 (BSD `EX_CONFIG` = 配置错误)** 退出。Controller 自己的 `controller.error.log` 没有任何新内容,说明崩溃发生在 pino logger 初始化之前 — 也就是 module load 阶段。

### 现象 B — 重试后 launchd 拒绝再次 fork (第二次尝试)
```
[bootstrap] controller ensureRunning status=stopped pid=none
[bootstrap] controller kickstart done status=stopped pid=none
```

这次连 PID 都没分配。这是 macOS launchd 的 **崩溃节流 (throttle)** 安全机制:同一个 service 在短时间内崩溃多次后,launchd 会拒绝再次启动它,直到节流窗口过期 (默认 ~10s)。

### 现象 C — Electron 主进程的 IPC 报错(下游症状,不是根因)
```
TypeError: fetch failed
  [cause]: connect ECONNREFUSED 127.0.0.1:50800
```

Electron 主进程的 `host:invoke` IPC handler 尝试代理调用 controller 的 HTTP API 失败。这只是因为 controller 没起来,**是症状不是根因**。

---

## 2. 排除的几个错误假设

| 假设 | 验证结果 |
|---|---|
| 我们的 refactor 提交破坏了 controller | ❌ 我们的代码 (`nudgeSkillsWatcher`、libtv 前置 fix) 都是在 controller 启动后才会执行的路径,根本不在 module load 阶段。dist 里 `grep nudgeSkillsWatcher` 有 1 处 ✓,`grep touchAnySkillMarker` 有 0 处 ✓,typecheck + lint 都过 ✓ |
| 端口 50800 被其他进程占用 | ❌ 第二次重试用了端口 50801,同样以 exit 78 崩溃。如果是端口冲突,换个端口就好了 |
| `@nexu/shared` dist 过期 | ❌ Colin 已经跑过 `pnpm install && pnpm --filter @nexu/shared build`,问题依旧 |
| openclaw 包版本变化 | ❌ `openclaw-runtime/package.json` 在 `feat/medeo-video-skill` 和 `origin/main` 上都是 `"openclaw": "2026.3.7"`。`openclaw-runtime/node_modules/` 也已经完整安装 |
| Stale launchd plist 路径 | ❌ Bootstrap 日志显示 `installService done` 成功,说明 plist 写入成功 |

---

## 3. 真正的根因

### 上游提交 `e825ac79` (#775 dingtalk channel support) 改了三件事

#### 改动 1: Controller build 脚本新增了一个步骤
```diff
- "build": "tsc",
+ "build": "tsc && node scripts/bundle-runtime-plugins.mjs",
+ "bundle-runtime-plugins": "node scripts/bundle-runtime-plugins.mjs",
```

#### 改动 2: Controller 源码新增了对 `dingtalk-connector` 的核心引用
受影响的关键文件 (都在启动路径上):

- `apps/controller/src/runtime/openclaw-runtime-plugin-writer.ts`
- `apps/controller/src/lib/channel-binding-compiler.ts`
- `apps/controller/src/lib/openclaw-config-compiler.ts`
- `apps/controller/src/routes/misc-compat-routes.ts`

#### 改动 3: Controller 启动时硬依赖三个 runtime 插件存在
`bundle-runtime-plugins.mjs` 的输出目录是 `apps/controller/.dist-runtime/plugins/`,需要打包的三个插件:

| Plugin id | NPM 包名 |
|---|---|
| `dingtalk-connector` | `@dingtalk-real-ai/dingtalk-connector` |
| `wecom` | `@wecom/wecom-openclaw-plugin` |
| `openclaw-qqbot` | `@tencent-connect/openclaw-qqbot` |

这三个包从 workspace 的 `node_modules` 里被 `cp -r` 进 `.dist-runtime/plugins/<id>/`,让 controller 在运行时能加载它们。

### 你的环境为什么坏了

Dev 模式下的 `apps/controller/dist/` 是由 **tsc-watcher** 编译出来的:
```json
"dev": "tsx watch src/index.ts"
```

**tsc-watcher 只跑 `tsc`,根本不会跑 `bundle-runtime-plugins.mjs`**。所以结果是:

| 状态 | 实际情况 |
|---|---|
| `apps/controller/dist/` | ✓ 存在,TypeScript 编译干净 (Apr 7 15:04 编译产物) |
| `apps/controller/.dist-runtime/plugins/` | ✗ **整个目录在你机器上不存在** |
| Controller 启动行为 | 加载到 `dingtalk-connector` 引用 → 找不到对应的 plugin 文件 → 抛异常 → 进程在 module load 阶段就死掉 → exit 78 |

### 为什么 controller.error.log 是空的

崩溃发生在 `import` 链解析阶段,在 pino logger 还没被实例化之前。Module load 异常会被 Node.js 直接打到 stderr 然后 `process.exit(非零)`,launchd 把这个非零退出码报告为 78。所以日志文件里看不到任何东西 — 只有 launchd 的 exit code 是唯一的线索。

### 为什么 OpenClaw gateway 也连不上 (port 18789)

Controller 没起来 → controller 没办法启动管理 OpenClaw 的子进程 → openclaw gateway 也不会被启动 → 18789 自然也是 ECONNREFUSED。这是 controller 死掉的连锁反应,不是另一个独立 bug。

---

## 4. 修复步骤

按顺序执行:

```bash
# 1. 停掉所有 dev 进程
pnpm stop

# 2. 清掉 launchd 的崩溃节流状态
launchctl bootout "gui/$(id -u)/io.nexu.controller.dev" 2>/dev/null
launchctl bootout "gui/$(id -u)/io.nexu.openclaw.dev" 2>/dev/null

# 3. 等节流窗口过期
sleep 15

# 4. 跑 controller 的完整 build (核心步骤)
pnpm --filter @nexu/controller build

# 5. 干净启动 dev stack
pnpm start
```

### 每一步在做什么

1. **`pnpm stop`** — 停掉之前残留的 dev Electron / launchd 服务。
2. **`launchctl bootout`** — 显式清掉节流状态。注意 `2>/dev/null` 是为了忽略 "service already unregistered" 的报错(如果之前已经被清掉了,这不是错误)。
3. **`sleep 15`** — 让 launchd 的节流计时器自然过期。
4. **`pnpm --filter @nexu/controller build`** — **这是核心修复**。它会跑完整的 `tsc && node scripts/bundle-runtime-plugins.mjs`:
   - 第一段 `tsc` 重新编译 TypeScript (幂等的,很快)
   - 第二段 `bundle-runtime-plugins.mjs` 才是关键:把三个 runtime 插件从 `node_modules` 复制到 `apps/controller/.dist-runtime/plugins/`,补齐缺失的部分
5. **`pnpm start`** — 干净启动。Controller 这次能找到 `.dist-runtime/plugins/dingtalk-connector/` 等目录,初始化成功,绑定 50800,后续的 OpenClaw、Web 才能跟上。

### 验证修复成功的标志

启动后在第二个终端跑:

```bash
pnpm logs | grep --line-buffered -E "openclaw skills watcher|doSync|bundled|libtv|installService|kickstart"
```

应该看到:
1. `installService done` ✓
2. `controller ensureRunning status=running pid=<PID>` ✓
3. **没有 `post-start validation failed`** ✓
4. 后续应该出现 `doSync: complete configPushed=true`
5. 接着出现我们 refactor 加的日志:`{"reason":"config-pushed",...,"msg":"openclaw skills watcher nudged"}`(这就是 Test A 的 PASS 信号)

---

## 5. 为什么这个 bug 之前一直没暴露

| 检查 | 是否能发现这个问题? |
|---|---|
| `pnpm typecheck` | ❌ 只跑 `tsc --noEmit`,根本不触发 runtime 插件打包 |
| `pnpm lint` | ❌ 只读源文件 |
| `pnpm test` | ❌ 单元测试不模拟启动流程 |
| Dev tsc-watcher | ❌ 只跑 tsc,不跑后置 bundler |
| **打包版 Nexu.app** | ✓ CI pipeline 跑的是完整的 `pnpm build`,所以 `.dist-runtime/` 是齐全的,sidecar 里能找到插件 — **这就是为什么你的打包版本能跑、dev 版本跑不起来** |

任何在 #775 之后从 `main` 拉新分支的开发同学,都会在第一次 `pnpm start` 时撞上这堵 exit-78 的墙,并且 typecheck/lint/install 都不报错,完全无从下手。

---

## 6. 建议的产品级修复 (不属于本次 nudge refactor 分支的范围)

应该开一个独立的 PR 修这个 dev 模式的半构建问题。可选方案:

### 方案 A: dev 启动脚本里强制跑一次 bundle (推荐)
在 `scripts/dev-launchd.sh start` 或 `scripts/dev/src/services/controller.ts` 的 controller 启动入口,**先跑一次同步的** `node apps/controller/scripts/bundle-runtime-plugins.mjs`,再启动 controller。代价是首次启动多 1-2 秒,换来的是开发者永远不会再撞这个墙。

### 方案 B: tsc-watcher 后置钩子
让 tsc-watcher 在每次成功编译后自动跑一次 bundler。但 tsc-watcher 本身没有原生 hook 支持,需要套一层 wrapper。

### 方案 C: 把 bundling 改成由 controller 启动时按需做
Controller 启动时先检查 `.dist-runtime/plugins/` 是否存在,不存在就同步执行 bundle 脚本再继续。最快、最不侵入,但启动路径变重了。

### 方案 D: 把 controller dev 命令改成完整 build 而不是 tsc-watch
`apps/controller/package.json` 里把 `dev` 从 `tsx watch src/index.ts` 改成 `tsc --watch && node scripts/bundle-runtime-plugins.mjs` (用 chokidar 重跑 bundler 当 dist 变化时)。最干净,但牺牲了 tsx 的快速启动。

---

## 7. 关键证据 (供后续 reference)

### 当前分支 `apps/controller/dist/` 内容
```
app, index.d.ts, index.d.ts.map, index.js, index.js.map,
lib, routes, runtime, services, store,
types.d.ts, types.d.ts.map, types.js, types.js.map
```
✗ 没有 `runtime-plugins/`、`plugins/`、`.dist-runtime/`

### `apps/controller/scripts/bundle-runtime-plugins.mjs` 输出目录
```js
const outputRoot = path.join(controllerRoot, ".dist-runtime", "plugins");
```

### Controller 源码引用 dingtalk-connector 的位置
```
apps/controller/src/runtime/openclaw-runtime-plugin-writer.ts:  "dingtalk-connector",
apps/controller/src/lib/channel-binding-compiler.ts:    dingtalk: "dingtalk-connector",
apps/controller/src/lib/channel-binding-compiler.ts:    return "dingtalk-connector";
apps/controller/src/lib/openclaw-config-compiler.ts:      ...(connectedPluginIds.includes("dingtalk-connector")
apps/controller/src/routes/misc-compat-routes.ts:  channel: "dingtalk-connector";
```

### 引入这次回归的提交
```
e825ac79 feat: add dingtalk channel support (#775)
作者: Siri-Ray <109605599+Siri-Ray@users.noreply.github.com>
日期: Thu Apr 2 18:16:39 2026 +0800
影响文件:
  - apps/controller/package.json (build script + 新增依赖)
  - apps/controller/src/* (新增 dingtalk-connector 引用)
  - apps/controller/scripts/bundle-runtime-plugins.mjs (新文件)
  - 其他: pnpm-lock.yaml, runtime plugin 配置等
```
