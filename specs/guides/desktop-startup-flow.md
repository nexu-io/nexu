# Desktop Startup Flow

This document describes the desktop startup sequence. Packaged app startup still uses the launchd/bootstrap path. Local development now uses explicit `pnpm dev start <service>` service orchestration and desktop attaches in external-runtime mode.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│ Electron BrowserWindow                                        │
│  └─ file://...desktop/dist/index.html  (desktop shell)       │
│       └─ <webview src="http://127.0.0.1:50810/workspace">    │
│            └─ API → :50810/api/* → proxy → controller:50800   │
├──────────────────────────────────────────────────────────────┤
│ Embedded Web Server (:50810)                                  │
│  ├─ Static files: apps/web/dist/*                             │
│  ├─ API proxy: /api/* → controller:50800                      │
│  ├─ Mock auth: /api/auth/get-session → desktop local session  │
│  └─ CORS headers for vite dev server (dev mode)               │
├──────────────────────────────────────────────────────────────┤
│ launchd LaunchAgents                                          │
│  ├─ io.nexu.controller.dev  → Controller (:50800)             │
│  └─ io.nexu.openclaw.dev    → OpenClaw Gateway (:18789)       │
└──────────────────────────────────────────────────────────────┘
```

## Startup Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Scripts Dev (dev)** | `pnpm dev start` | Lightweight full-stack startup (`openclaw` -> `controller` -> `web` -> `desktop`). Per-service commands remain available when needed. |
| **Orchestrator** | `pnpm --filter @nexu/desktop dev` | Frontend development. Vite HMR, tmux orchestration |
| **Packaged** | Open Nexu.app | Packaged desktop-managed runtime |

## Directory Layout

### Development (`pnpm dev start` / `pnpm dev start <service>`)

All dev state is repo-scoped under `.tmp/`, fully isolated from the packaged app.

```
{repo}/
├── .tmp/
│   ├── desktop/
│   │   └── nexu-home/              # NEXU_HOME for dev
│   │       ├── config.json          # Controller config (bots, channels, providers)
│   │       ├── compiled-openclaw.json
│   │       ├── skill-ledger.json
│   │       ├── skillhub-cache/
│   │       ├── logs/                # Controller + OpenClaw service logs
│   │       │   ├── controller.log
│   │       │   ├── controller.error.log
│   │       │   ├── openclaw.log
│   │       │   └── openclaw.error.log
│   │       └── runtime/
│   │           └── openclaw/
│   │               └── state/       # OpenClaw runtime state
│   │                   ├── openclaw.json    # Generated config
│   │                   ├── extensions/      # Runtime plugins
│   │                   ├── skills/          # Installed skills
│   │                   └── agents/          # Agent workspaces
│   └── launchd/
│       ├── io.nexu.controller.dev.plist
│       ├── io.nexu.openclaw.dev.plist
│       └── runtime-ports.json       # Port metadata for attach
```

### Packaged (Nexu.app)

```
~/.nexu/                              # NEXU_HOME for packaged
├── config.json
├── compiled-openclaw.json
├── skill-ledger.json
├── skillhub-cache/
├── logs/
│   ├── controller.log
│   ├── controller.error.log
│   ├── openclaw.log
│   └── openclaw.error.log
├── openclaw-sidecar/                 # Extracted from payload.tar.gz on first launch
│   ├── .archive-stamp
│   ├── node_modules/openclaw/openclaw.mjs
│   └── ...
└── runtime/
    └── openclaw/
        └── state/                    # Same structure as dev

~/Library/LaunchAgents/
├── io.nexu.controller.plist
├── io.nexu.openclaw.plist
└── runtime-ports.json

~/Library/Application Support/@nexu/desktop/
└── logs/                             # Electron main process logs
    ├── cold-start.log
    ├── desktop-main.log
    └── desktop-diagnostics.json
```

### Label Isolation

Dev and packaged modes use different launchd labels to prevent cross-attachment:

| | Dev | Packaged |
|---|---|---|
| Controller label | `io.nexu.controller.dev` | `io.nexu.controller` |
| OpenClaw label | `io.nexu.openclaw.dev` | `io.nexu.openclaw` |
| Plist directory | `.tmp/launchd/` | `~/Library/LaunchAgents/` |
| NEXU_HOME | `.tmp/desktop/nexu-home/` | `~/.nexu/` |

## Startup Sequence

### Phase 1: Explicit service startup (dev only)

```
pnpm dev start openclaw
pnpm dev start controller
pnpm dev start web
pnpm dev start desktop
  └─ tools/dev desktop service
       ├─ ensure desktop build artifacts
       ├─ launch Electron directly
       └─ attach desktop to external runtime targets
```

### Phase 2: Port Allocation + Bootstrap

```
Electron main process
  ├─ allocateDesktopRuntimePorts()          # Probe ports, auto-offset if occupied
  │    ├─ controller: 50800 (→50801 if occupied)
  │    ├─ web: 50810 (→50811 if occupied)
  │    └─ openclaw: 18789 (→18790 if occupied)
  ├─ createMainWindow()                     # loadFile(dist/index.html)
  └─ runLaunchdColdStart()
       ├─ resolveLaunchdPaths()
       │    └─ (packaged) ensurePackagedOpenclawSidecar()  # Extract tar with retry
       └─ bootstrapWithLaunchd()            # Unified attach/cold-start flow
```

### Phase 3: Unified Bootstrap (attach or cold start)

`bootstrapWithLaunchd()` uses a single per-service flow:

```
1. Read runtime-ports.json (from previous session)
2. Check each service status via launchctl print
3. Per-service decision:
   ├─ Running + healthy + ports match → KEEP (attach)
   ├─ Running + unhealthy → TEARDOWN + restart
   └─ Not running → INSTALL plist + START
4. Start embedded web server
5. Write runtime-ports.json
```

**Port recovery**: When at least one service is still running from a previous session, ports are recovered from `runtime-ports.json` instead of using freshly allocated ports. This ensures all services use consistent ports.

**Validation**: The running service's `NEXU_HOME` (extracted from `launchctl print` environment) must match the expected home directory. A dev session will not attach to packaged services and vice versa.

### Phase 4: Controller Readiness

```
waitForControllerReadiness()
  ├─ Poll /api/auth/get-session (adaptive: 50ms → 250ms)
  └─ Controller bootstrap (~2s)
       ├─ prepare() + ensureRuntimeModelPlugin() + cloudModels  ── parallel
       ├─ ensureValidDefaultModel()
       ├─ syncAllImmediate()              # Write openclaw.json + skills
       ├─ wsClient.connect()              # Connect to OpenClaw gateway WS
       └─ startBackgroundLoops()          # Health loop + sync loop
       └─ bootPhase: "booting" → "ready"  (on first WS connection)
```

### Phase 5: Gateway Connection

```
OpenClaw gateway startup (~5-7s from cold)
  ├─ Read openclaw.json (gateway.port from env.openclawGatewayPort)
  ├─ Load plugins: feishu, openclaw-weixin, nexu-runtime-model, nexu-platform-bootstrap
  ├─ Start channels: feishu (WebSocket), weixin (long-polling)
  └─ Gateway WS reachable → health loop detects → wsClient.retryNow()
```

### Phase 6: UI Rendering

```
Desktop Shell (file://...dist/index.html)
  ├─ Nexu 4-color logo animation (loader overlay)
  ├─ Poll /api/internal/desktop/ready (every 2s)
  │    └─ controllerReady=true → set webview src
  ├─ <webview> loads http://127.0.0.1:50810/workspace
  │    ├─ /api/auth/get-session → mock desktop session (embedded web server)
  │    ├─ AuthLayout passes
  │    └─ HomePage renders
  └─ webview did-finish-load → loader disappears → UI visible
```

## Attach Mechanism

When the app is reopened after "Run in Background" (packaged) or after a crash, it attempts to attach to already-running launchd services instead of cold-starting.

### Full Attach (both services running)

Typical time: **~200ms** from bootstrap start to complete.

1. Read `runtime-ports.json` → recover ports
2. Both services `status=running` via `launchctl print`
3. Validate `NEXU_HOME` from service environment matches expectations
4. Probe controller `/health` (2s timeout) → healthy
5. Probe openclaw port (1s TCP connect) → listening
6. Start embedded web server on recovered web port
7. Skip `waitForControllerReadiness` (already ready)

### Partial Attach (one service running)

Typical time: **~2-3s** (only cold-starts the missing service).

1. Read `runtime-ports.json` → recover ports
2. One service running, one stopped
3. Running service: validate health → keep
4. Stopped service: generate plist with recovered ports → install → start
5. Wait for the restarted service's readiness

### Fallback to Cold Start

Triggers when:
- `runtime-ports.json` missing or corrupt
- `isDev` mode mismatch
- `NEXU_HOME` mismatch (tears down stale services first)
- Both services stopped
- Health probe fails on running service

## Port Architecture

| Component | Default Port | Source |
|-----------|-------------|--------|
| Controller HTTP | 50800 | Plist `PORT` env var |
| OpenClaw Gateway | 18789 | Plist `OPENCLAW_GATEWAY_PORT` → `env.openclawGatewayPort` → `openclaw.json gateway.port` |
| Embedded Web Server | 50810 | `runtimeConfig.ports.web` |

All three ports use the same source chain: Electron allocates → writes to plist env → controller reads from env → writes to config. If a default port is occupied, Electron auto-increments (+1, +2, ...) until a free port is found.

The `runtime-ports.json` file persists the actual ports used, enabling attach to recover them on next launch.

## Status Display

```
Startup timeline:
  RuntimeStatus: starting → starting → active
  gatewayStatus: starting → starting → active (WS connected)
  channels: connecting → connecting → connected
  bootPhase: booting → ready (after first WS connection)

UI indicators:
  Nexu Alpha badge: "Starting up" (yellow pulse) → "Running" (green)
  Channels: "Connecting" (yellow pulse) → "Connected" (green)
  Agent: "Agent starting..." (yellow) → "Agent running" (green)
  WeChat session expired: "Reconnect required" (orange warning)
```

## File Watch (Auto Hot Reload)

The explicit `pnpm dev` flow does not provide an aggregate desktop wrapper watcher:

| Change | Watcher | Effect | Latency |
|--------|---------|--------|---------|
| Controller (`apps/controller/src/`) | `tsc --watch` | `launchctl kickstart -k` restarts service | ~2-3s |
| Web UI (`apps/web/src/`) | Polling (find + stat, 3s interval) | `pnpm --filter @nexu/web build` | ~5-8s |
| Desktop Shell (`apps/desktop/src/`) | No auto-watch | Rebuild desktop, then `pnpm dev restart desktop` | ~20s |

## Exit Behavior

### Dev Mode (`pnpm dev stop <service>`)

- Close window / Dock quit → Electron exits normally
- Service cleanup is explicit; stop desktop/web/controller/openclaw through `pnpm dev stop <service>`

### Packaged Mode (Nexu.app)

Close window triggers a dialog:
- **Quit Completely**: bootout all launchd services → delete `runtime-ports.json` → exit
- **Run in Background**: hide window, services keep running. Dock click restores window
- **Cancel**: no action

## OpenClaw Sidecar (Packaged Only)

The packaged app bundles OpenClaw as `payload.tar.gz`. On first launch:

1. `ensurePackagedOpenclawSidecar()` checks for existing extraction via `.archive-stamp`
2. If stamp mismatch or missing: `rm -rf` old sidecar → `tar -xzf` → write stamp
3. Retry up to 3 times with 1s pause (handles macOS ENOTEMPTY race)
4. Extracted to `~/.nexu/openclaw-sidecar/`
5. Subsequent launches skip extraction if stamp matches

## Key Files

| File | Responsibility |
|------|---------------|
| `scripts/dev-launchd.sh` | Dev startup script (build + launchd + file watchers) |
| `apps/desktop/main/index.ts` | Electron main process entry, cold start orchestration |
| `apps/desktop/main/services/launchd-bootstrap.ts` | Unified bootstrap: attach, cold start, port recovery, runtime-ports.json |
| `apps/desktop/main/services/launchd-manager.ts` | launchctl command wrapper, env var extraction from running services |
| `apps/desktop/main/services/plist-generator.ts` | Generate launchd plist XML with env vars |
| `apps/desktop/main/services/embedded-web-server.ts` | HTTP server: static files + API proxy + mock auth |
| `apps/desktop/main/services/quit-handler.ts` | Quit dialog, service cleanup, runtime-ports.json deletion |
| `apps/desktop/main/runtime/manifests.ts` | Sidecar extraction, path resolution |
| `apps/desktop/src/components/surface-frame.tsx` | 4-color Nexu loader + webview overlay |
| `apps/controller/src/app/bootstrap.ts` | Controller bootstrap (parallel prep, sync, WS connect) |
| `apps/controller/src/app/env.ts` | Controller env: NEXU_HOME, OPENCLAW_STATE_DIR, ports |
| `apps/controller/src/runtime/state.ts` | RuntimeState + bootPhase lifecycle |
| `apps/controller/src/runtime/loops.ts` | Health loop (gateway probe + WS retryNow) + sync loop |
| `apps/controller/src/lib/openclaw-config-compiler.ts` | Compile controller config → openclaw.json |
