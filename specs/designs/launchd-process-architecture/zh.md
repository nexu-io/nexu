# Nexu Desktop launchd 进程架构设计

> **状态**: 设计草案
> **日期**: 2026-03-23

## 1. 问题背景

### 1.1 当前架构的痛点

**双重重启问题**:
```text
配置变化 → OpenClaw 检测到变化
        → OpenClaw 自己 spawn 新进程 (因为没检测到 supervisor)
        → 旧进程 exit(0)
        → Controller 看到 exit → 尝试 scheduleRestart()
        → 可能导致双重重启或进程管理混乱
```

**进程残留问题**:
- Desktop 崩溃后，Controller/OpenClaw 进程可能成为孤儿进程
- 下次启动时需要手动清理 (`killOrphanedOpenClawProcesses()`)
- 端口占用导致启动失败

**进程树脆弱性**:
- 所有服务都是 Electron main process 的子进程
- Electron 崩溃 = 整个栈崩溃
- 无系统级恢复机制

### 1.2 OpenClaw 的 Supervisor 识别机制

OpenClaw 已经内置了完善的 supervisor 识别逻辑 (`supervisor-markers.ts`):

```typescript
// macOS: 检测 launchd 环境变量
const LAUNCHD_SUPERVISOR_HINT_ENV_VARS = [
  "LAUNCH_JOB_LABEL",
  "LAUNCH_JOB_NAME",
  "OPENCLAW_LAUNCHD_LABEL"
];

// Linux: 检测 systemd 环境变量
const SYSTEMD_SUPERVISOR_HINT_ENV_VARS = [
  "OPENCLAW_SYSTEMD_UNIT",
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "JOURNAL_STREAM"
];

// 通用: 自定义标记
"OPENCLAW_SERVICE_MARKER", "OPENCLAW_SERVICE_KIND"
```

当检测到被 supervisor 托管时，OpenClaw 会:
1. 返回 `mode: "supervised"` 而非自己 spawn 新进程
2. 调用 `launchctl kickstart` (macOS) 或 `systemctl restart` (Linux)
3. 让 supervisor 完全控制进程生命周期

---

## 2. 目标架构

### 2.1 架构概览

```text
┌─────────────────────────────────────────────────────────────────┐
│                          launchd                                 │
│                                                                  │
│  ┌────────────────────┐                                         │
│  │ com.nexu.desktop   │  Electron GUI Shell                     │
│  │ (LaunchAgent)      │  - 窗口管理                              │
│  │                    │  - 用户交互                              │
│  │                    │  - 内置 HTTP Server (Web UI)            │
│  │                    │  - 监控其他服务状态                       │
│  └─────────┬──────────┘                                         │
│            │ launchctl kickstart / bootout                      │
│            │                                                     │
│  ┌─────────▼──────────┐  ┌───────────────────┐                  │
│  │ com.nexu.controller│  │ com.nexu.openclaw │                  │
│  │ (LaunchAgent)      │  │ (LaunchAgent)     │                  │
│  │                    │  │                   │                  │
│  │ - Hono API Server  │  │ - OpenClaw Gateway│                  │
│  │ - 配置管理         │  │ - Bot Runtime     │                  │
│  │ - 状态存储         │  │ - Channel 连接    │                  │
│  └────────────────────┘  └───────────────────┘                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 进程职责划分

| 进程 | launchd Label | 职责 | KeepAlive |
|------|---------------|------|-----------|
| **Desktop** | `com.nexu.desktop` | GUI Shell + 内置 Web Server | No (用户手动启动) |
| **Controller** | `com.nexu.controller` | API Server, 配置管理, 状态存储 | Yes (崩溃自动重启) |
| **OpenClaw** | `com.nexu.openclaw` | Bot Runtime, Channel 连接 | Yes (崩溃自动重启) |

### 2.3 关键设计决策

#### 决策 1: Controller 和 OpenClaw 作为独立 LaunchAgent

**理由**:
- 系统级进程管理，不依赖 Electron 存活
- 崩溃自动恢复，无需 Electron 介入
- Desktop 崩溃后，下次启动可以直接接管已运行的服务
- 支持"后台服务"模式 (关闭 GUI 但服务继续运行)

#### 决策 2: Desktop 作为 GUI Shell + 服务编排器

**理由**:
- Desktop 不再是"父进程"，而是"控制面板"
- 通过 `launchctl` 命令管理服务生命周期
- 监控服务状态，显示在 UI 中
- 用户关闭 Desktop 时可选择:
  - 停止所有服务 (完全退出)
  - 保持后台运行 (仅关闭 GUI)

#### 决策 3: Web UI 内置到 Electron Main Process

**方案**: Electron Main Process 内置 HTTP Server，serve 静态资源 + 代理 API

**理由**:
- 减少一个独立进程 (Web Sidecar)
- Web 代码零改动，仍然是 HTTP 访问
- 开发/生产模式统一

#### 决策 4: 开发/生产统一使用 launchd

**理由**:
- 环境一致，减少"在我机器上能跑"的问题
- 进程残留问题在开发时就能发现和解决
- 代码路径统一，无 if (dev) / else (prod) 分支

---

## 3. 统一日志架构

### 3.1 日志路径设计

所有日志统一存放在 `NEXU_LOG_DIR` 目录下：

| 环境 | 日志目录 | 说明 |
|------|---------|------|
| **生产** | `~/Library/Logs/Nexu/` | macOS 标准日志位置 |
| **开发** | `{repo}/.tmp/logs/` | 仓库内隔离 |

### 3.2 日志文件结构

```text
{NEXU_LOG_DIR}/
├── controller.log      # Controller stdout
├── controller.err      # Controller stderr
├── openclaw.log        # OpenClaw stdout
├── openclaw.err        # OpenClaw stderr
├── desktop.log         # Electron main process
└── launchd/            # launchd 操作日志
    └── service-ops.log
```

### 3.3 便捷日志查看

```bash
# 开发模式：一键查看所有日志
pnpm logs
# 等价于: tail -f .tmp/logs/*.log

# 查看特定服务
pnpm logs:controller
pnpm logs:openclaw

# 生产模式
tail -f ~/Library/Logs/Nexu/*.log

# 或者用 Console.app
open -a Console ~/Library/Logs/Nexu/
```

### 3.4 日志环境变量

```bash
# plist 和代码统一使用
NEXU_LOG_DIR=/path/to/logs

# Controller
CONTROLLER_LOG_PATH=${NEXU_LOG_DIR}/controller.log

# OpenClaw
OPENCLAW_LOG_PATH=${NEXU_LOG_DIR}/openclaw.log
```

---

## 4. launchd 配置详解

### 4.1 Controller LaunchAgent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nexu.controller</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${CONTROLLER_ENTRY}</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>${NODE_ENV}</string>

        <key>NEXU_HOME</key>
        <string>${NEXU_HOME}</string>

        <key>NEXU_LOG_DIR</key>
        <string>${NEXU_LOG_DIR}</string>

        <key>CONTROLLER_PORT</key>
        <string>50800</string>

        <!-- OpenClaw 由 launchd 管理，不是 Controller -->
        <key>RUNTIME_MANAGE_OPENCLAW_PROCESS</key>
        <string>false</string>

        <!-- 告诉 Controller 自己被 launchd 托管 -->
        <key>NEXU_LAUNCHD_MANAGED</key>
        <string>true</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>${CONTROLLER_WORKDIR}</string>

    <!-- 崩溃自动重启 -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- 重启退避 -->
    <key>ThrottleInterval</key>
    <integer>5</integer>

    <!-- 日志 -->
    <key>StandardOutPath</key>
    <string>${NEXU_LOG_DIR}/controller.log</string>

    <key>StandardErrorPath</key>
    <string>${NEXU_LOG_DIR}/controller.err</string>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
```

### 4.2 OpenClaw LaunchAgent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nexu.openclaw</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${OPENCLAW_ENTRY}</string>
        <string>gateway</string>
        <string>run</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>${NODE_ENV}</string>

        <!-- OpenClaw 识别被 launchd 托管 -->
        <key>OPENCLAW_LAUNCHD_LABEL</key>
        <string>com.nexu.openclaw</string>

        <key>OPENCLAW_STATE_DIR</key>
        <string>${NEXU_HOME}/openclaw</string>

        <key>OPENCLAW_CONFIG_PATH</key>
        <string>${NEXU_HOME}/openclaw/openclaw.toml</string>

        <key>NEXU_LOG_DIR</key>
        <string>${NEXU_LOG_DIR}</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>${NEXU_HOME}/openclaw</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>StandardOutPath</key>
    <string>${NEXU_LOG_DIR}/openclaw.log</string>

    <key>StandardErrorPath</key>
    <string>${NEXU_LOG_DIR}/openclaw.err</string>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
```

### 4.3 开发 vs 生产 plist 变量

| 变量 | 开发模式 | 生产模式 |
|------|---------|---------|
| `Label` | `com.nexu.controller.dev` | `com.nexu.controller` |
| `NODE_PATH` | `$(which node)` | `app.resourcesPath/runtime/node` |
| `CONTROLLER_ENTRY` | `.tmp/sidecars/controller/dist/index.js` | `app.resourcesPath/runtime/controller/dist/index.js` |
| `NEXU_HOME` | `.tmp/desktop/nexu-home` | `~/Library/Application Support/Nexu` |
| `NEXU_LOG_DIR` | `.tmp/logs` | `~/Library/Logs/Nexu` |
| `NODE_ENV` | `development` | `production` |

---

## 5. Web UI 内置实现

Electron Main Process 内置 HTTP Server，复用现有 Web Sidecar 逻辑：

```typescript
// apps/desktop/src/main/embedded-web-server.ts

import { createServer, IncomingMessage, ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import * as path from "path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export function startEmbeddedWebServer(opts: {
  port: number;
  webRoot: string;
  controllerPort: number;
}): Promise<void> {
  const { port, webRoot, controllerPort } = opts;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      // API 代理 → Controller (包括 /openapi.json)
      if (
        url.pathname.startsWith("/api") ||
        url.pathname.startsWith("/v1") ||
        url.pathname === "/openapi.json"
      ) {
        return proxyToController(req, res, `http://127.0.0.1:${controllerPort}`);
      }

      // 静态文件
      let filePath = path.join(webRoot, url.pathname);

      // SPA fallback: 文件不存在或是目录则返回 index.html
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = path.join(webRoot, "index.html");
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const stat = statSync(filePath);
        res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
        createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    // 错误处理
    server.on("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });
}

async function proxyToController(
  req: IncomingMessage,
  res: ServerResponse,
  controllerUrl: string
): Promise<void> {
  const targetUrl = `${controllerUrl}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
    });

    res.writeHead(response.status, Object.fromEntries(response.headers));
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (err) {
    res.writeHead(502);
    res.end("Bad Gateway");
  }
}
```

**好处**:
- 减少一个独立进程
- Web 代码零改动
- 端口仍是 50810，开发/生产行为一致

---

## 6. Desktop 应用改造

### 6.1 LaunchdManager 服务

```typescript
// apps/desktop/src/main/services/launchd-manager.ts

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

export interface LaunchdService {
  label: string;
  plistPath: string;
  status: "running" | "stopped" | "unknown";
  pid?: number;
}

export class LaunchdManager {
  private readonly plistDir: string;
  private readonly uid: number;
  private readonly domain: string;

  constructor(opts?: { plistDir?: string }) {
    if (process.platform !== "darwin") {
      throw new Error("LaunchdManager only works on macOS");
    }
    this.plistDir = opts?.plistDir ?? path.join(os.homedir(), "Library/LaunchAgents");
    // 使用 os.userInfo() 获取 UID，避免硬编码
    this.uid = os.userInfo().uid;
    this.domain = `gui/${this.uid}`;
  }

  async installService(label: string, plistContent: string): Promise<void> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    await fs.mkdir(this.plistDir, { recursive: true });
    await fs.writeFile(plistPath, plistContent, "utf8");

    // 检查服务是否已注册，避免重复 bootstrap
    const isRegistered = await this.isServiceRegistered(label);
    if (!isRegistered) {
      await execFileAsync("launchctl", ["bootstrap", this.domain, plistPath]);
    }
  }

  async uninstallService(label: string): Promise<void> {
    try {
      await execFileAsync("launchctl", ["bootout", `${this.domain}/${label}`]);
    } catch (err) {
      // 服务可能未运行，记录但不抛出
      console.warn(`Failed to bootout ${label}:`, err instanceof Error ? err.message : err);
    }
    try {
      await fs.unlink(path.join(this.plistDir, `${label}.plist`));
    } catch (err) {
      // plist 可能不存在
      console.warn(`Failed to remove plist for ${label}:`, err instanceof Error ? err.message : err);
    }
  }

  async startService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["kickstart", `${this.domain}/${label}`]);
  }

  async stopService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["kill", "SIGTERM", `${this.domain}/${label}`]);
  }

  /** 优雅停止服务：发送 SIGTERM 后等待退出，超时则强杀 */
  async stopServiceGracefully(label: string, timeoutMs = 5000): Promise<void> {
    await this.stopService(label);

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getServiceStatus(label);
      if (status.status !== "running") {
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // 超时，强制停止
    console.warn(`Service ${label} did not stop in ${timeoutMs}ms, force killing`);
    await execFileAsync("launchctl", ["kill", "SIGKILL", `${this.domain}/${label}`]);
  }

  async restartService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["kickstart", "-k", `${this.domain}/${label}`]);
  }

  async getServiceStatus(label: string): Promise<LaunchdService> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    try {
      const { stdout } = await execFileAsync("launchctl", ["print", `${this.domain}/${label}`]);
      const pidMatch = stdout.match(/pid\s*=\s*(\d+)/);
      const pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;
      const isRunning = stdout.includes("state = running");
      return { label, plistPath, status: isRunning ? "running" : "stopped", pid };
    } catch {
      return { label, plistPath, status: "unknown" };
    }
  }

  /** 检查服务是否已注册到 launchd */
  async isServiceRegistered(label: string): Promise<boolean> {
    try {
      await execFileAsync("launchctl", ["print", `${this.domain}/${label}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** 检查 plist 文件是否存在 */
  async hasPlistFile(label: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.plistDir, `${label}.plist`));
      return true;
    } catch {
      return false;
    }
  }

  /** 检查服务是否已安装（plist 存在且已注册） */
  async isServiceInstalled(label: string): Promise<boolean> {
    const hasPlist = await this.hasPlistFile(label);
    const isRegistered = await this.isServiceRegistered(label);
    return hasPlist && isRegistered;
  }
}
```

### 6.2 启动流程

```typescript
// apps/desktop/src/main/bootstrap-launchd.ts

export interface DesktopEnv {
  plistDir: string;
  isDev: boolean;
  controllerPort: number;
  webPort: number;
  webRoot: string;
}

export async function bootstrapWithLaunchd(env: DesktopEnv): Promise<void> {
  const launchd = new LaunchdManager({ plistDir: env.plistDir });
  const labels = {
    controller: env.isDev ? "com.nexu.controller.dev" : "com.nexu.controller",
    openclaw: env.isDev ? "com.nexu.openclaw.dev" : "com.nexu.openclaw",
  };

  // 1. 确保 plist 已安装
  for (const [service, label] of Object.entries(labels)) {
    if (!(await launchd.isServiceInstalled(label))) {
      const plist = generatePlist(service as "controller" | "openclaw", env);
      await launchd.installService(label, plist);
    }
  }

  // 2. 启动未运行的服务
  const controllerStatus = await launchd.getServiceStatus(labels.controller);
  if (controllerStatus.status !== "running") {
    await launchd.startService(labels.controller);
    await waitForControllerReadiness(env.controllerPort);
  }

  const openclawStatus = await launchd.getServiceStatus(labels.openclaw);
  if (openclawStatus.status !== "running") {
    await launchd.startService(labels.openclaw);
  }

  // 3. 启动内置 Web Server
  await startEmbeddedWebServer({
    port: env.webPort,
    webRoot: env.webRoot,
    controllerPort: env.controllerPort,
  });
}
```

### 6.3 退出行为

```typescript
app.on("before-quit", async (event) => {
  event.preventDefault();

  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["完全退出", "后台运行", "取消"],
    defaultId: 0,
    title: "退出 Nexu",
    message: "选择退出方式",
    detail: "后台运行将保持服务运行，Bot 继续工作",
  });

  if (response === 2) return; // 取消

  if (response === 0) {
    // 完全退出：优雅停止所有服务
    const launchd = new LaunchdManager();
    await launchd.stopServiceGracefully(labels.openclaw);
    await launchd.stopServiceGracefully(labels.controller);
  }

  app.exit(0);
});
```

---

## 7. 开发模式

### 7.1 开发脚本

```bash
#!/bin/bash
# scripts/dev-launchd.sh (pnpm dev 调用)

set -e

REPO_ROOT=$(pwd)
LOG_DIR="$REPO_ROOT/.tmp/logs"
PLIST_DIR="$REPO_ROOT/.tmp/launchd"
ELECTRON_PID=""

# 清理函数
cleanup() {
  echo "Cleaning up..."
  if [ -n "$ELECTRON_PID" ]; then
    kill "$ELECTRON_PID" 2>/dev/null || true
  fi
  # 可选：停止 launchd 服务
  # launchctl kill SIGTERM gui/$(id -u)/com.nexu.controller.dev 2>/dev/null || true
  # launchctl kill SIGTERM gui/$(id -u)/com.nexu.openclaw.dev 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$LOG_DIR" "$PLIST_DIR"

# 1. 构建
pnpm build

# 2. 生成开发用 plist
pnpm exec tsx scripts/generate-dev-plist.ts \
  --plist-dir="$PLIST_DIR" \
  --log-dir="$LOG_DIR" \
  --repo-root="$REPO_ROOT"

# 3. 安装/重启服务（显示错误而非静默）
UID_VAL=$(id -u)

# Bootstrap (如果失败则显示错误)
if ! launchctl bootstrap gui/$UID_VAL "$PLIST_DIR/com.nexu.controller.dev.plist" 2>&1; then
  echo "Note: Controller service may already be bootstrapped"
fi
if ! launchctl bootstrap gui/$UID_VAL "$PLIST_DIR/com.nexu.openclaw.dev.plist" 2>&1; then
  echo "Note: OpenClaw service may already be bootstrapped"
fi

# Kickstart
launchctl kickstart -k gui/$UID_VAL/com.nexu.controller.dev
launchctl kickstart -k gui/$UID_VAL/com.nexu.openclaw.dev

# 4. 启动 Electron
pnpm exec electron apps/desktop &
ELECTRON_PID=$!

# 5. tail 日志并等待 Electron 退出
tail -f "$LOG_DIR"/*.log &
wait $ELECTRON_PID
```

### 7.2 开发命令

```bash
# 启动 (构建 + 安装 plist + 启动服务 + Electron + 日志)
pnpm dev

# 重启单个服务
pnpm restart:controller
pnpm restart:openclaw

# 查看日志
pnpm logs                 # 所有日志
pnpm logs:controller      # 仅 Controller
pnpm logs:openclaw        # 仅 OpenClaw

# 停止所有服务
pnpm stop

# 清理 (停止 + 卸载 plist + 删除状态)
pnpm reset-state
```

### 7.3 开发 plist 位置

开发模式的 plist 放在仓库内，与生产隔离：

```text
{repo}/
└── .tmp/
    ├── launchd/
    │   ├── com.nexu.controller.dev.plist
    │   └── com.nexu.openclaw.dev.plist
    ├── logs/
    │   ├── controller.log
    │   ├── controller.err
    │   ├── openclaw.log
    │   └── openclaw.err
    └── desktop/
        └── nexu-home/
```

---

## 8. 实施清单

### 8.1 修复双重重启

- [ ] `apps/controller/src/runtime/openclaw-process.ts`: spawn 时添加 `OPENCLAW_SERVICE_MARKER` 和 `OPENCLAW_SERVICE_KIND` 环境变量

### 8.2 Web UI 内置

- [ ] `apps/desktop/src/main/embedded-web-server.ts`: 实现内置 HTTP Server
- [ ] `apps/desktop/src/main/index.ts`: 启动流程中调用 `startEmbeddedWebServer()`
- [ ] 移除 Web Sidecar 进程启动逻辑
- [ ] 移除 `apps/desktop/sidecars/web/`（或保留用于其他场景）

### 8.3 launchd 架构

- [ ] `apps/desktop/src/main/services/launchd-manager.ts`: 实现 LaunchdManager
- [ ] `apps/desktop/src/main/plist-templates.ts`: plist 模板生成（开发/生产）
- [ ] `apps/desktop/src/main/bootstrap-launchd.ts`: launchd 启动流程
- [ ] `scripts/generate-dev-plist.ts`: 开发模式 plist 生成脚本
- [ ] `scripts/dev-launchd.sh`: 开发启动脚本
- [ ] 更新 `package.json` scripts: `dev`, `stop`, `restart:*`, `logs`, `logs:*`
- [ ] 统一日志目录环境变量 `NEXU_LOG_DIR`
- [ ] Desktop 退出行为改造（完全退出 vs 后台运行）
- [ ] `apps/controller/src/app/env.ts`: 添加 `NEXU_LOG_DIR` 和 `NEXU_LAUNCHD_MANAGED` 到 schema

### 8.4 后台服务模式

- [ ] 退出时弹窗询问"完全退出" vs "后台运行"
- [ ] 设置页添加"后台运行"开关
- [ ] 开机自启选项（设置 plist `RunAtLoad: true`）

---

## 9. 风险与缓解

### 9.1 企业环境兼容性

**风险**: 企业安全软件 (CrowdStrike, Jamf 等) 或 MDM 策略可能阻止创建 LaunchAgent

**说明**: `~/Library/LaunchAgents/` 是用户空间目录，macOS 本身不限制写入。签名 + 公证的应用在普通用户环境下不会有问题。仅企业环境可能受限。

**缓解**:
- 检测写入失败时，回退到传统进程树模式
- 文档说明企业用户可能需要 IT 白名单

### 9.2 卸载清理

**风险**: 用户删除 .app 后残留 plist 和服务

**缓解**:
- 提供官方卸载工具
- README 说明手动清理步骤
- 考虑 pkg 安装包 + 卸载脚本

---

## 10. 附录

### A. launchd 常用命令

```bash
# 查看所有 Nexu 服务
launchctl list | grep nexu

# 查看服务详情
launchctl print gui/$(id -u)/com.nexu.controller

# 启动服务
launchctl kickstart gui/$(id -u)/com.nexu.controller

# 重启服务 (-k = kill first)
launchctl kickstart -k gui/$(id -u)/com.nexu.controller

# 停止服务
launchctl kill SIGTERM gui/$(id -u)/com.nexu.controller

# 安装 plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nexu.controller.plist

# 卸载服务
launchctl bootout gui/$(id -u)/com.nexu.controller
```

### B. 目录结构

**生产模式**:
```text
~/Library/
├── Application Support/Nexu/
│   ├── config/
│   ├── db/
│   └── openclaw/
│       ├── openclaw.toml
│       ├── skills/
│       └── workspace-templates/
├── LaunchAgents/
│   ├── com.nexu.controller.plist
│   └── com.nexu.openclaw.plist
└── Logs/Nexu/
    ├── controller.log
    ├── controller.err
    ├── openclaw.log
    └── openclaw.err
```

**开发模式**:
```text
{repo}/
└── .tmp/
    ├── launchd/
    │   ├── com.nexu.controller.dev.plist
    │   └── com.nexu.openclaw.dev.plist
    ├── logs/
    │   ├── controller.log
    │   ├── controller.err
    │   ├── openclaw.log
    │   └── openclaw.err
    └── desktop/nexu-home/
        ├── config/
        ├── db/
        └── openclaw/
```

### C. 参考资料

- [launchd.plist(5) man page](https://www.manpagez.com/man/5/launchd.plist/)
- [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [OpenClaw supervisor-markers.ts](../../../Documents/openclaw/src/infra/supervisor-markers.ts)
