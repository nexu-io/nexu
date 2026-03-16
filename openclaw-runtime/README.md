# OpenClaw Runtime

`openclaw-runtime/` 是一个 minimal 的 openclaw 目录，用来替代全局安装的 openclaw。

## 安装

在根目录 `pnpm install` 的时候会自动安装。

或者你可以手动运行：

```bash
pnpm openclaw-runtime:install
```

## For 本地开发

固定使用这个目录里的 openclaw 启动 Gateway：

```bash
OPENCLAW_STATE_DIR="$PWD/.openclaw" \
./openclaw-wrapper gateway run ...
```

`./openclaw-wrapper` 是仓库根目录下的 wrapper 脚本，行为上等价于执行本地 runtime 里的 `openclaw` CLI，但不需要每次手写完整的入口路径。

## For 桌面端应用

打包阶段，使用这个目录里的 openclaw 打包到桌面端安装包中。

对于桌面端应用，使用稳定的启动基线是：

- 一份明确的 Node runtime（可以是 Electron 自带，或者独立 Node runtime）
- 一个外置的 `openclaw` 目录
- 一个明确的入口脚本 `openclaw.mjs`

## 为什么入口选择 openclaw.mjs

`./openclaw-wrapper` 最终会执行 `openclaw-runtime/node_modules/openclaw/openclaw.mjs`，它是 `openclaw` 包内的 CLI 入口脚本。

它负责：

- 检查 Node 版本
- 初始化一些启动期行为（例如 warning filter / compile cache）
- 加载真正的 `dist/entry.(m)js`

因此它适合作为 runtime 的直接入口。

相比之下：

- `npm exec openclaw -- ...` 更适合开发时临时调用
- `node_modules/.bin/openclaw` 本质上是包管理器生成的 shim
- `node openclaw.mjs ...` 更接近最终产品中的真实调用方式

## 依赖管理

```bash
# 安装完整依赖
npm --prefix ./openclaw-runtime run install:full
# 安装裁剪后的依赖
npm --prefix ./openclaw-runtime run install:pruned
# 清理依赖
npm --prefix ./openclaw-runtime run clean
```

## 依赖裁剪循环

定义一个最小循环，用来安全地裁剪 `openclaw-runtime/` 的依赖。

### 1. 确定删除策略

先修改 `openclaw-runtime/prune-runtime-paths.mjs`，加入本轮准备删除的路径。

### 2. 重新安装并裁剪

```bash
npm --prefix ./openclaw-runtime run clean && npm --prefix ./openclaw-runtime run install:pruned
```

### 3. 重启服务

使用 PM2 重启下面两个进程：

- 终端 3：OpenClaw Gateway 运行时
- 终端 4：Nexu Gateway 服务

重启后，需要观察 OpenClaw 和 Nexu Gateway 是否正常运行。

### 4. 运行冒烟测试

当前最小冒烟测试是：

1. 在 Slack 中向测试 bot 发送 `hello`
2. 观察 OpenClaw 是否正常回复

后续需要建立完善的 smoke test suite，覆盖完整的运行时行为。

### 推荐节奏

- 每轮只新增一小批裁剪规则
- 每轮都执行完整的 clean -> install:pruned -> restart -> smoke test
- 一旦失败，先回到完整安装基线进行对照

如果某轮裁剪后行为异常，先回到完整安装基线：

```bash
npm --prefix ./openclaw-runtime run clean && npm --prefix ./openclaw-runtime run install:full
```

然后重新启动终端 3 和终端 4，再重复同样的 Slack `hello` 冒烟测试。

如果完整安装恢复正常，就可以基本确认问题来自本轮 pruning 规则。
