# Desktop `Export Diagnostics` 执行经验

通过菜单 `Help -> Export Diagnostics…` 导出诊断包。

## 执行方式

### 1) 先确认桌面端已运行

```bash
pnpm desktop:status
```

期望看到 tmux session `nexu-desktop` 处于 running。

如果未运行，请先启动桌面端。

```bash
pnpm desktop:start
```

### 2) 用 AppleScript 触发菜单并保存（Agent 执行规范）

目标：通过 `Help -> Export Diagnostics…` 导出 zip 到 `<nexu-repo-root>/.tmp/diagnostics`。

不要把 AppleScript 当成“固定脚本一次跑完”，而是按状态机执行：**定位进程 -> 聚焦 -> 点击菜单 -> 等待保存面板 -> 输入路径并保存 -> 校验产物**。

#### 失败根因（必须先理解）

- `keystroke` / `key code` 是发给当前前台窗口，不是绑定到 `p`。
- `set frontmost of p to true` 只做一次不够，执行过程中焦点可能被用户操作或系统弹窗抢走。
- 保存 sheet 出现有抖动，固定 `delay` 可能提前输入，导致按键落空或发错窗口。

#### Agent 执行原则

1. 每个关键动作前都重新确认目标进程前置（至少：点菜单前、发按键前）。
2. 只在检测到 `sheet 1 of window 1 of p` 存在后再发送 `Cmd+Shift+G` 与回车序列。
3. 所有 UI 动作允许有限重试（建议 2-3 次），失败要显式报错，不静默吞掉。
4. 不依赖“命令退出码成功”；必须用文件时间戳校验是否真的产出新 zip。

#### 关键代码片段（用于组合，不要固化成单一长脚本）

获取 PID：

```bash
PID=$(ps -ax -o pid,command | rg "Electron apps/desktop$" | awk '{print $1}' | head -n 1)
```

聚焦目标进程：

```applescript
tell application "System Events"
  set p to first process whose unix id is (targetPid as integer)
  set frontmost of p to true
end tell
```

点击菜单项：

```applescript
click menu item "Export Diagnostics…" of menu 1 of menu bar item "Help" of menu bar 1 of p
```

等待保存 sheet：

```applescript
repeat 40 times
  tell application "System Events"
    if exists sheet 1 of window 1 of p then exit repeat
  end tell
  delay 0.1
end repeat
```

输入目录并确认保存：

```applescript
keystroke "G" using {command down, shift down}
keystroke "<nexu-repo-root>/.tmp/diagnostics"
key code 36
key code 36
```

## 校验命令

导出后立刻确认文件存在，记得确认文件时间戳。

```bash
ls -lt <nexu-repo-root>/.tmp/diagnostics/nexu-diagnostics-*.zip
```

建议同时检查导出包体积与大文件分布：

```bash
ZIP=<nexu-repo-root>/.tmp/diagnostics/nexu-diagnostics-<timestamp>.zip
TMP=<nexu-repo-root>/.tmp/diagnostics-check
rm -rf "$TMP" && mkdir -p "$TMP"
unzip -q "$ZIP" -d "$TMP"
du -ah "$TMP"/nexu-diagnostics-* | sort -hr | head -n 20
```

## 导出包目录结构（已确认）

解压后应有单一顶层目录，不会把文件散落到当前目录：

```text
nexu-diagnostics-<timestamp>/
├── diagnostics/
│   ├── desktop-diagnostics.json
│   ├── startup-health.json
│   ├── sentry/
│   │   └── *.json
│   └── crashes/
│       └── *.json
├── logs/
│   ├── cold-start.log
│   ├── desktop-main.log
│   ├── openclaw/
│   │   └── openclaw-*.log
│   └── runtime-units/
│       ├── controller.log
│       ├── openclaw.log
│       └── web.log
├── config/
│   └── openclaw.json
└── summary/
    ├── environment-summary.json
    ├── additional-artifacts.json
    └── manifest.json
```

建议用下面命令直接看 ZIP 内部路径（比依赖 Finder 展示更可靠）：

```bash
unzip -l <nexu-repo-root>/.tmp/diagnostics/nexu-diagnostics-<timestamp>.zip
```

## 新增信息说明（用于排障完整性）

- `diagnostics/startup-health.json`
  - 升级/回滚健康状态（失败计数、版本、最后检查时间）。
- `diagnostics/sentry/**/*.json`
  - 本地 Sentry 会话/队列/上下文快照（JSON 递归采集，做统一脱敏）。
- `diagnostics/crashes/*.json`
  - 最近 7 天 `DiagnosticReports` 中文件名包含 `exu` 的崩溃报告，转成 JSON（包含 `content` 文本字段）。
- `logs/openclaw/openclaw-*.log`
  - `/tmp/openclaw` 下 OpenClaw 原生日志，补足 runtime-units 之外的排障信息。
- `summary/additional-artifacts.json`
  - 新增采集文件索引（源路径、归档路径、大小、修改时间），用于快速判断“收齐了没有”。

## 环境差异说明（本地启动 vs 打包版本）

- 两种运行方式统一通过 Electron `userData` 相关路径采集（避免绑定旧路径）。
- 本地 `pnpm desktop:restart`：`userData` 在 repo 下 `.tmp/desktop/electron`。
- 打包版本：`userData` 在 `~/Library/Application Support/@nexu/desktop`（或 `NEXU_DESKTOP_USER_DATA_ROOT` 覆盖路径）。

## 脱敏检查（建议）

导出后可快速扫描是否存在疑似明文凭据：

```bash
rg --pcre2 -n -i "gw-secret-token|xox[baprs]-|bearer\s+[a-z0-9._-]{8,}|token\"\s*:\s*\"(?!\[REDACTED\])|password\"\s*:\s*\"(?!\[REDACTED\])|secret\"\s*:\s*\"(?!\[REDACTED\])|dsn\"\s*:\s*\"(?!\[REDACTED\])" \
  <unzipped-diagnostics-root>
```

## 常见问题

1. 报错 `osascript 不允许辅助访问 (-1719)`
   - 给当前终端应用开启：`系统设置 -> 隐私与安全性 -> 辅助功能`。

2. “路径改了，但没保存”
   - 说明只完成了目录跳转，没触发最终 Save。
   - 解决：在路径回车后再补一次或两次 `return`，并在脚本中留短延时。

3. 执行时切到其他软件，导出偶发失败
   - 根因：`keystroke` 发送到当前前台窗口，焦点漂移后会打到错误目标。
   - 解决：每个关键动作前重新 `frontmost`，并显式等待 `sheet` 出现；导出后用 `ls -lt` 强制校验新 zip 是否生成。
