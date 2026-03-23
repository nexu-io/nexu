# Nexu Desktop launchd Process Architecture Design

> **Status**: Draft
> **Date**: 2026-03-23

## 1. Background

### 1.1 Current Architecture Pain Points

**Double restart issue**:
```text
Config change → OpenClaw detects change
            → OpenClaw spawns new process itself (no supervisor detected)
            → Old process exit(0)
            → Controller sees exit → calls scheduleRestart()
            → May cause double restart or process management chaos
```

**Orphan process issue**:
- After Desktop crash, Controller/OpenClaw processes may become orphans
- Need manual cleanup on next startup (`killOrphanedOpenClawProcesses()`)
- Port conflicts cause startup failures

**Process tree fragility**:
- All services are child processes of Electron main process
- Electron crash = entire stack crash
- No system-level recovery mechanism

### 1.2 OpenClaw's Supervisor Detection Mechanism

OpenClaw has built-in supervisor detection logic (`supervisor-markers.ts`):

```typescript
// macOS: detect launchd environment variables
const LAUNCHD_SUPERVISOR_HINT_ENV_VARS = [
  "LAUNCH_JOB_LABEL",
  "LAUNCH_JOB_NAME",
  "OPENCLAW_LAUNCHD_LABEL"
];

// Linux: detect systemd environment variables
const SYSTEMD_SUPERVISOR_HINT_ENV_VARS = [
  "OPENCLAW_SYSTEMD_UNIT",
  "INVOCATION_ID",
  "SYSTEMD_EXEC_PID",
  "JOURNAL_STREAM"
];

// Generic: custom markers
"OPENCLAW_SERVICE_MARKER", "OPENCLAW_SERVICE_KIND"
```

When supervisor is detected, OpenClaw will:
1. Return `mode: "supervised"` instead of spawning new process
2. Call `launchctl kickstart` (macOS) or `systemctl restart` (Linux)
3. Let supervisor fully control process lifecycle

---

## 2. Target Architecture

### 2.1 Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                          launchd                                 │
│                                                                  │
│  ┌────────────────────┐                                         │
│  │ com.nexu.desktop   │  Electron GUI Shell                     │
│  │ (LaunchAgent)      │  - Window management                    │
│  │                    │  - User interaction                     │
│  │                    │  - Embedded HTTP Server (Web UI)        │
│  │                    │  - Monitor other services               │
│  └─────────┬──────────┘                                         │
│            │ launchctl kickstart / bootout                      │
│            │                                                     │
│  ┌─────────▼──────────┐  ┌───────────────────┐                  │
│  │ com.nexu.controller│  │ com.nexu.openclaw │                  │
│  │ (LaunchAgent)      │  │ (LaunchAgent)     │                  │
│  │                    │  │                   │                  │
│  │ - Hono API Server  │  │ - OpenClaw Gateway│                  │
│  │ - Config management│  │ - Bot Runtime     │                  │
│  │ - State storage    │  │ - Channel connect │                  │
│  └────────────────────┘  └───────────────────┘                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Process Responsibilities

| Process | launchd Label | Responsibilities | KeepAlive |
|---------|---------------|------------------|-----------|
| **Desktop** | `com.nexu.desktop` | GUI Shell + Embedded Web Server | No (user-launched) |
| **Controller** | `com.nexu.controller` | API Server, config management, state storage | Yes (auto-restart on crash) |
| **OpenClaw** | `com.nexu.openclaw` | Bot Runtime, channel connections | Yes (auto-restart on crash) |

### 2.3 Key Design Decisions

#### Decision 1: Controller and OpenClaw as Independent LaunchAgents

**Rationale**:
- System-level process management, independent of Electron
- Automatic crash recovery without Electron involvement
- After Desktop crash, next startup can take over running services
- Supports "background service" mode (close GUI, keep bots running)

#### Decision 2: Desktop as GUI Shell + Service Orchestrator

**Rationale**:
- Desktop is no longer "parent process", but "control panel"
- Manages service lifecycle via `launchctl` commands
- Monitors service status, displays in UI
- When user closes Desktop, can choose:
  - Stop all services (full exit)
  - Keep running in background (close GUI only)

#### Decision 3: Web UI Embedded in Electron Main Process

**Approach**: Electron Main Process runs embedded HTTP Server, serves static files + proxies API

**Rationale**:
- Eliminates one separate process (Web Sidecar)
- Zero changes to Web code, still HTTP access
- Unified development/production mode

#### Decision 4: Development and Production Both Use launchd

**Rationale**:
- Consistent environments, reduces "works on my machine" issues
- Orphan process issues discovered during development
- Unified code paths, no if (dev) / else (prod) branches

---

## 3. Unified Logging Architecture

### 3.1 Log Path Design

All logs stored in `NEXU_LOG_DIR` directory:

| Environment | Log Directory | Description |
|-------------|---------------|-------------|
| **Production** | `~/Library/Logs/Nexu/` | macOS standard log location |
| **Development** | `{repo}/.tmp/logs/` | Isolated within repo |

### 3.2 Log File Structure

```text
{NEXU_LOG_DIR}/
├── controller.log      # Controller stdout
├── controller.err      # Controller stderr
├── openclaw.log        # OpenClaw stdout
├── openclaw.err        # OpenClaw stderr
├── desktop.log         # Electron main process
└── launchd/            # launchd operation logs
    └── service-ops.log
```

### 3.3 Convenient Log Viewing

```bash
# Development: view all logs
pnpm logs
# Equivalent to: tail -f .tmp/logs/*.log

# View specific service
pnpm logs:controller
pnpm logs:openclaw

# Production
tail -f ~/Library/Logs/Nexu/*.log

# Or use Console.app
open -a Console ~/Library/Logs/Nexu/
```

### 3.4 Log Environment Variables

```bash
# Unified across plist and code
NEXU_LOG_DIR=/path/to/logs

# Controller
CONTROLLER_LOG_PATH=${NEXU_LOG_DIR}/controller.log

# OpenClaw
OPENCLAW_LOG_PATH=${NEXU_LOG_DIR}/openclaw.log
```

---

## 4. launchd Configuration Details

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

        <!-- OpenClaw managed by launchd, not Controller -->
        <key>RUNTIME_MANAGE_OPENCLAW_PROCESS</key>
        <string>false</string>

        <!-- Tell Controller it's managed by launchd -->
        <key>NEXU_LAUNCHD_MANAGED</key>
        <string>true</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>${CONTROLLER_WORKDIR}</string>

    <!-- Auto-restart on crash -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- Restart throttle -->
    <key>ThrottleInterval</key>
    <integer>5</integer>

    <!-- Logs -->
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

        <!-- OpenClaw detects launchd management -->
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

### 4.3 Development vs Production plist Variables

| Variable | Development | Production |
|----------|-------------|------------|
| `Label` | `com.nexu.controller.dev` | `com.nexu.controller` |
| `NODE_PATH` | `$(which node)` | `app.resourcesPath/runtime/node` |
| `CONTROLLER_ENTRY` | `.tmp/sidecars/controller/dist/index.js` | `app.resourcesPath/runtime/controller/dist/index.js` |
| `NEXU_HOME` | `.tmp/desktop/nexu-home` | `~/Library/Application Support/Nexu` |
| `NEXU_LOG_DIR` | `.tmp/logs` | `~/Library/Logs/Nexu` |
| `NODE_ENV` | `development` | `production` |

---

## 5. Web UI Embedded Implementation

Electron Main Process runs embedded HTTP Server, reuses existing Web Sidecar logic:

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

      // API proxy → Controller (including /openapi.json)
      if (
        url.pathname.startsWith("/api") ||
        url.pathname.startsWith("/v1") ||
        url.pathname === "/openapi.json"
      ) {
        return proxyToController(req, res, `http://127.0.0.1:${controllerPort}`);
      }

      // Static files
      let filePath = path.join(webRoot, url.pathname);

      // SPA fallback: if file doesn't exist or is directory, serve index.html
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

    // Error handling
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

**Benefits**:
- Eliminates one separate process
- Zero changes to Web code
- Port remains 50810, consistent dev/prod behavior

---

## 6. Desktop Application Changes

### 6.1 LaunchdManager Service

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
    // Use os.userInfo() to get UID, avoid hardcoding
    this.uid = os.userInfo().uid;
    this.domain = `gui/${this.uid}`;
  }

  async installService(label: string, plistContent: string): Promise<void> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    await fs.mkdir(this.plistDir, { recursive: true });
    await fs.writeFile(plistPath, plistContent, "utf8");

    // Check if service is already registered to avoid duplicate bootstrap
    const isRegistered = await this.isServiceRegistered(label);
    if (!isRegistered) {
      await execFileAsync("launchctl", ["bootstrap", this.domain, plistPath]);
    }
  }

  async uninstallService(label: string): Promise<void> {
    try {
      await execFileAsync("launchctl", ["bootout", `${this.domain}/${label}`]);
    } catch (err) {
      // Service may not be running, log but don't throw
      console.warn(`Failed to bootout ${label}:`, err instanceof Error ? err.message : err);
    }
    try {
      await fs.unlink(path.join(this.plistDir, `${label}.plist`));
    } catch (err) {
      // plist may not exist
      console.warn(`Failed to remove plist for ${label}:`, err instanceof Error ? err.message : err);
    }
  }

  async startService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["kickstart", `${this.domain}/${label}`]);
  }

  async stopService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["kill", "SIGTERM", `${this.domain}/${label}`]);
  }

  /** Gracefully stop service: send SIGTERM then wait, force kill on timeout */
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

    // Timeout, force stop
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

  /** Check if service is registered with launchd */
  async isServiceRegistered(label: string): Promise<boolean> {
    try {
      await execFileAsync("launchctl", ["print", `${this.domain}/${label}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Check if plist file exists */
  async hasPlistFile(label: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.plistDir, `${label}.plist`));
      return true;
    } catch {
      return false;
    }
  }

  /** Check if service is installed (plist exists and registered) */
  async isServiceInstalled(label: string): Promise<boolean> {
    const hasPlist = await this.hasPlistFile(label);
    const isRegistered = await this.isServiceRegistered(label);
    return hasPlist && isRegistered;
  }
}
```

### 6.2 Bootstrap Flow

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

  // 1. Ensure plist installed
  for (const [service, label] of Object.entries(labels)) {
    if (!(await launchd.isServiceInstalled(label))) {
      const plist = generatePlist(service as "controller" | "openclaw", env);
      await launchd.installService(label, plist);
    }
  }

  // 2. Start services not running
  const controllerStatus = await launchd.getServiceStatus(labels.controller);
  if (controllerStatus.status !== "running") {
    await launchd.startService(labels.controller);
    await waitForControllerReadiness(env.controllerPort);
  }

  const openclawStatus = await launchd.getServiceStatus(labels.openclaw);
  if (openclawStatus.status !== "running") {
    await launchd.startService(labels.openclaw);
  }

  // 3. Start embedded Web Server
  await startEmbeddedWebServer({
    port: env.webPort,
    webRoot: env.webRoot,
    controllerPort: env.controllerPort,
  });
}
```

### 6.3 Exit Behavior

```typescript
app.on("before-quit", async (event) => {
  event.preventDefault();

  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Quit Completely", "Run in Background", "Cancel"],
    defaultId: 0,
    title: "Quit Nexu",
    message: "Choose exit mode",
    detail: "Running in background keeps services running, bots continue working",
  });

  if (response === 2) return; // Cancel

  if (response === 0) {
    // Quit completely: gracefully stop all services
    const launchd = new LaunchdManager();
    await launchd.stopServiceGracefully(labels.openclaw);
    await launchd.stopServiceGracefully(labels.controller);
  }

  app.exit(0);
});
```

---

## 7. Development Mode

### 7.1 Development Script

```bash
#!/bin/bash
# scripts/dev-launchd.sh (called by pnpm dev)

set -e

REPO_ROOT=$(pwd)
LOG_DIR="$REPO_ROOT/.tmp/logs"
PLIST_DIR="$REPO_ROOT/.tmp/launchd"
ELECTRON_PID=""

# Cleanup function
cleanup() {
  echo "Cleaning up..."
  if [ -n "$ELECTRON_PID" ]; then
    kill "$ELECTRON_PID" 2>/dev/null || true
  fi
  # Optional: stop launchd services
  # launchctl kill SIGTERM gui/$(id -u)/com.nexu.controller.dev 2>/dev/null || true
  # launchctl kill SIGTERM gui/$(id -u)/com.nexu.openclaw.dev 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$LOG_DIR" "$PLIST_DIR"

# 1. Build
pnpm build

# 2. Generate dev plist
pnpm exec tsx scripts/generate-dev-plist.ts \
  --plist-dir="$PLIST_DIR" \
  --log-dir="$LOG_DIR" \
  --repo-root="$REPO_ROOT"

# 3. Install/restart services (show errors instead of silencing)
UID_VAL=$(id -u)

# Bootstrap (show error if fails)
if ! launchctl bootstrap gui/$UID_VAL "$PLIST_DIR/com.nexu.controller.dev.plist" 2>&1; then
  echo "Note: Controller service may already be bootstrapped"
fi
if ! launchctl bootstrap gui/$UID_VAL "$PLIST_DIR/com.nexu.openclaw.dev.plist" 2>&1; then
  echo "Note: OpenClaw service may already be bootstrapped"
fi

# Kickstart
launchctl kickstart -k gui/$UID_VAL/com.nexu.controller.dev
launchctl kickstart -k gui/$UID_VAL/com.nexu.openclaw.dev

# 4. Start Electron
pnpm exec electron apps/desktop &
ELECTRON_PID=$!

# 5. Tail logs and wait for Electron to exit
tail -f "$LOG_DIR"/*.log &
wait $ELECTRON_PID
```

### 7.2 Development Commands

```bash
# Start (build + install plist + start services + Electron + logs)
pnpm dev

# Restart single service
pnpm restart:controller
pnpm restart:openclaw

# View logs
pnpm logs                 # All logs
pnpm logs:controller      # Controller only
pnpm logs:openclaw        # OpenClaw only

# Stop all services
pnpm stop

# Clean up (stop + uninstall plist + delete state)
pnpm reset-state
```

### 7.3 Development plist Location

Development mode plist stored within repo, isolated from production:

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

## 8. Implementation Checklist

### 8.1 Fix Double Restart

- [ ] `apps/controller/src/runtime/openclaw-process.ts`: Add `OPENCLAW_SERVICE_MARKER` and `OPENCLAW_SERVICE_KIND` environment variables when spawning

### 8.2 Web UI Embedded

- [ ] `apps/desktop/src/main/embedded-web-server.ts`: Implement embedded HTTP Server
- [ ] `apps/desktop/src/main/index.ts`: Call `startEmbeddedWebServer()` in bootstrap flow
- [ ] Remove Web Sidecar process startup logic
- [ ] Remove `apps/desktop/sidecars/web/` (or keep for other uses)

### 8.3 launchd Architecture

- [ ] `apps/desktop/src/main/services/launchd-manager.ts`: Implement LaunchdManager
- [ ] `apps/desktop/src/main/plist-templates.ts`: plist template generation (dev/prod)
- [ ] `apps/desktop/src/main/bootstrap-launchd.ts`: launchd bootstrap flow
- [ ] `scripts/generate-dev-plist.ts`: Development plist generation script
- [ ] `scripts/dev-launchd.sh`: Development startup script
- [ ] Update `package.json` scripts: `dev`, `stop`, `restart:*`, `logs`, `logs:*`
- [ ] Unified log directory environment variable `NEXU_LOG_DIR`
- [ ] Desktop exit behavior changes (quit completely vs background)
- [ ] `apps/controller/src/app/env.ts`: Add `NEXU_LOG_DIR` and `NEXU_LAUNCHD_MANAGED` to schema

### 8.4 Background Service Mode

- [ ] Exit dialog asking "Quit Completely" vs "Run in Background"
- [ ] Settings page "Run in Background" toggle
- [ ] Launch at login option (set plist `RunAtLoad: true`)

---

## 9. Risks and Mitigations

### 9.1 Enterprise Environment Compatibility

**Risk**: Enterprise security software (CrowdStrike, Jamf, etc.) or MDM policies may block LaunchAgent creation

**Note**: `~/Library/LaunchAgents/` is a user-space directory, macOS itself does not restrict writes. Signed + notarized apps work fine for regular users. Only enterprise environments may be restricted.

**Mitigation**:
- Detect write failure and fall back to traditional process tree mode
- Document that enterprise users may need IT whitelist

### 9.2 Uninstall Cleanup

**Risk**: User deletes .app but leaves plist and services behind

**Mitigation**:
- Provide official uninstaller tool
- README with manual cleanup steps
- Consider pkg installer + uninstall script

---

## 10. Appendix

### A. Common launchd Commands

```bash
# List all Nexu services
launchctl list | grep nexu

# View service details
launchctl print gui/$(id -u)/com.nexu.controller

# Start service
launchctl kickstart gui/$(id -u)/com.nexu.controller

# Restart service (-k = kill first)
launchctl kickstart -k gui/$(id -u)/com.nexu.controller

# Stop service
launchctl kill SIGTERM gui/$(id -u)/com.nexu.controller

# Install plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nexu.controller.plist

# Uninstall service
launchctl bootout gui/$(id -u)/com.nexu.controller
```

### B. Directory Structure

**Production**:
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

**Development**:
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

### C. References

- [launchd.plist(5) man page](https://www.manpagez.com/man/5/launchd.plist/)
- [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [OpenClaw supervisor-markers.ts](../../../Documents/openclaw/src/infra/supervisor-markers.ts)
