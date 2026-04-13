#!/usr/bin/env bash
#
# Launchd-based development script for Nexu Desktop
#
# Usage:
#   ./scripts/dev-launchd.sh         # Start services (auto-cleans first)
#   ./scripts/dev-launchd.sh stop    # Stop all services
#   ./scripts/dev-launchd.sh restart # Restart services
#   ./scripts/dev-launchd.sh status  # Show service status
#   ./scripts/dev-launchd.sh logs    # Tail all logs
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_NEXU_HOME="$REPO_ROOT/.tmp/desktop/nexu-home"
LOG_DIR="$DEV_NEXU_HOME/logs"
PLIST_DIR="$REPO_ROOT/.tmp/launchd"
UID_VAL=$(id -u)
DOMAIN="gui/$UID_VAL"

# Service labels (dev mode)
CONTROLLER_LABEL="io.nexu.controller.dev"
OPENCLAW_LABEL="io.nexu.openclaw.dev"

# Ports
CONTROLLER_PORT="${CONTROLLER_PORT:-50800}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"

# Paths
NODE_BIN="${NODE_BIN:-$(which node)}"
CONTROLLER_ENTRY="$REPO_ROOT/apps/controller/dist/index.js"
# Dev state dirs — repo-scoped, isolated from packaged app's ~/.nexu/
OPENCLAW_STATE_DIR="$DEV_NEXU_HOME/runtime/openclaw/state"
OPENCLAW_CONFIG="$OPENCLAW_STATE_DIR/openclaw.json"

mkdir -p "$LOG_DIR" "$PLIST_DIR" "$OPENCLAW_STATE_DIR" "$DEV_NEXU_HOME"

# Full cleanup - stops and removes all related services and processes
full_cleanup() {
  echo "Performing full cleanup..."

  # 1. Kill Electron first with SIGKILL to bypass quit handler
  #    (quit handler would race with our launchd cleanup)
  echo "  Killing Electron..."
  pkill -9 -f "Electron.*apps/desktop" 2>/dev/null || true
  pkill -f "vite.*apps/desktop" 2>/dev/null || true

  # 2. Bootout launchd services (stops + unregisters in one step)
  echo "  Booting out launchd services..."
  launchctl bootout "$DOMAIN/$OPENCLAW_LABEL" 2>/dev/null || true
  launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true

  sleep 1

  # 3. Kill any remaining orphan processes (including current tools/dev
  #    supervisors and older direct launch patterns)
  pkill -9 -f -- "--nexu-dev-service=openclaw" 2>/dev/null || true
  pkill -9 -f -- "--nexu-dev-service=controller" 2>/dev/null || true
  pkill -9 -f "openclaw.mjs gateway" 2>/dev/null || true
  pkill -9 -f "controller/dist/index.js" 2>/dev/null || true

  # Also stop any process still occupying our service ports.
  if lsof -i ":$CONTROLLER_PORT" -P -n &>/dev/null; then
    echo "  Port $CONTROLLER_PORT occupied — killing occupying process..."
    lsof -ti ":$CONTROLLER_PORT" | xargs kill -9 2>/dev/null || true
  fi
  if lsof -i ":$OPENCLAW_PORT" -P -n &>/dev/null; then
    echo "  Port $OPENCLAW_PORT occupied — killing occupying process..."
    lsof -ti ":$OPENCLAW_PORT" | xargs kill -9 2>/dev/null || true
  fi
  pkill -9 -f "chrome_crashpad_handler" 2>/dev/null || true

  # 4. Wait for ports to be free (with timeout)
  local max_wait=10
  local waited=0
  while [ $waited -lt $max_wait ]; do
    local port_busy=0
    if lsof -i ":$CONTROLLER_PORT" -P -n &>/dev/null; then
      port_busy=1
    fi
    if lsof -i ":$OPENCLAW_PORT" -P -n &>/dev/null; then
      port_busy=1
    fi
    if [ $port_busy -eq 0 ]; then
      break
    fi
    echo "  Waiting for ports to be free..."
    sleep 1
    waited=$((waited + 1))
  done

  echo "Cleanup complete."
}

stop_services() {
  echo "Stopping services..."

  # Try graceful SIGTERM first — this triggers the unified gracefulShutdown()
  # handler in the Electron main process, which does proper teardown.
  echo "  Sending SIGTERM to Electron..."
  pkill -TERM -f "Electron.*apps/desktop" 2>/dev/null || true

  # Wait up to 10 seconds for Electron + children to exit gracefully
  local max_graceful=10
  local waited=0
  while [ $waited -lt $max_graceful ]; do
    if ! pgrep -f "Electron.*apps/desktop" &>/dev/null; then
      echo "  Electron exited gracefully after ${waited}s"
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  # If Electron is still alive, escalate to SIGKILL
  if pgrep -f "Electron.*apps/desktop" &>/dev/null; then
    echo "  Electron did not exit, sending SIGKILL..."
    pkill -9 -f "Electron.*apps/desktop" 2>/dev/null || true
  fi

  # Bootout launchd services (in case graceful shutdown didn't do it)
  if launchctl print "$DOMAIN/$OPENCLAW_LABEL" &>/dev/null; then
    echo "  Stopping $OPENCLAW_LABEL..."
    launchctl bootout "$DOMAIN/$OPENCLAW_LABEL" 2>/dev/null || true
  fi
  if launchctl print "$DOMAIN/$CONTROLLER_LABEL" &>/dev/null; then
    echo "  Stopping $CONTROLLER_LABEL..."
    launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
  fi

  # Wait for ports to be freed
  local max_wait=8
  waited=0
  while [ $waited -lt $max_wait ]; do
    local port_busy=0
    lsof -i ":$CONTROLLER_PORT" -P -n &>/dev/null && port_busy=1
    lsof -i ":$OPENCLAW_PORT" -P -n &>/dev/null && port_busy=1
    [ $port_busy -eq 0 ] && break
    sleep 1
    waited=$((waited + 1))
  done

  # Force-kill any remaining orphan processes
  pkill -9 -f -- "--nexu-dev-service=openclaw" 2>/dev/null || true
  pkill -9 -f -- "--nexu-dev-service=controller" 2>/dev/null || true
  pkill -9 -f "openclaw.mjs gateway" 2>/dev/null || true
  pkill -9 -f "controller/dist/index.js" 2>/dev/null || true
  lsof -ti ":$CONTROLLER_PORT" | xargs kill -9 2>/dev/null || true
  lsof -ti ":$OPENCLAW_PORT" | xargs kill -9 2>/dev/null || true
  pkill -9 -f "chrome_crashpad_handler" 2>/dev/null || true

  # Kill tsc --watch and web watcher background processes.
  # These are started by start_services and normally cleaned by the EXIT
  # trap, but `pnpm stop` calls stop_services directly without triggering
  # the trap, leaving watchers alive and printing to the terminal.
  pkill -f "tsc --watch.*apps/controller" 2>/dev/null || true
  pkill -f "find.*apps/web/src" 2>/dev/null || true

  echo "Services stopped."
}

# Remove stale plist files so Electron regenerates them on next boot
purge_plists() {
  rm -f "$PLIST_DIR"/*.plist 2>/dev/null || true
}

start_services() {
  echo "=== Nexu Desktop (launchd mode) ==="
  echo ""

  # Always cleanup first to ensure clean state
  full_cleanup

  echo ""
  echo "Log directory: $LOG_DIR"
  echo ""

  # Clean stale dist to avoid stale incremental output (tsc doesn't remove
  # dist files for deleted source files) and ensure desktop bundles fresh code
  echo "Building..."
  rm -rf "$REPO_ROOT/packages/shared/dist" "$REPO_ROOT/apps/controller/dist" "$REPO_ROOT/apps/desktop/dist-electron"
  pnpm build

  # Ensure desktop shell dist exists (Electron loadFile needs it on disk)
  if [ ! -f "$REPO_ROOT/apps/desktop/dist/index.html" ]; then
    echo "Building desktop shell..."
    pnpm --filter @nexu/desktop build
  fi

  # Remove stale plist files so Electron generates fresh ones
  purge_plists

  mkdir -p "$LOG_DIR"

  # Initialize watcher PIDs (set -u safe)
  CONTROLLER_WATCH_PID=""
  WEB_WATCH_PID=""

  # When this script exits (Electron quit, Ctrl+C, etc), stop everything
  trap 'echo ""; echo "Cleaning up..."; [ -n "$CONTROLLER_WATCH_PID" ] && kill "$CONTROLLER_WATCH_PID" 2>/dev/null; [ -n "$WEB_WATCH_PID" ] && kill "$WEB_WATCH_PID" 2>/dev/null; stop_services' EXIT INT TERM

  # Start controller file watcher in background:
  # tsc --watch → auto-restart launchd service on successful compile
  echo "Starting controller watcher..."

  (
    cd "$REPO_ROOT/apps/controller"
    initial_compile_complete=0
    pnpm exec tsc --watch --preserveWatchOutput 2>&1 | while IFS= read -r line; do
      echo "[controller:tsc] $line"
      if echo "$line" | grep -q "Found 0 errors"; then
        if [ $initial_compile_complete -eq 0 ]; then
          initial_compile_complete=1
          echo "[controller] Initial watch compile complete; skipping restart."
          continue
        fi
        echo "[controller] Restarting service..."
        launchctl kickstart -k "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null && echo "[controller] Restarted." || true
      fi
    done
  ) &
  CONTROLLER_WATCH_PID=$!

  # Web watcher: poll for source changes every 3s, rebuild if detected
  (
    last_hash=""
    while true; do
      hash=$(find "$REPO_ROOT/apps/web/src" -name '*.ts' -o -name '*.tsx' -o -name '*.css' 2>/dev/null | sort | xargs stat -f '%m' 2>/dev/null | md5)
      if [ -n "$last_hash" ] && [ "$hash" != "$last_hash" ]; then
        echo "[web] Changes detected, rebuilding..."
        (cd "$REPO_ROOT" && pnpm --filter @nexu/web build 2>&1 | tail -1 | sed 's/^/[web] /')
        echo "[web] Rebuilt. Refresh page to see changes."
      fi
      last_hash="$hash"
      sleep 3
    done
  ) &
  WEB_WATCH_PID=$!

  # Start Electron desktop with launchd mode (blocks until quit).
  # tools/dev owns the desktop dev-launch compatibility path now; launchd mode
  # keeps the direct Electron launch here because the app boot path is already
  # launchd-specific and does not reuse the tools/dev desktop worker model.
  echo "Starting Electron desktop (launchd mode)..."
  echo ""
  cd "$REPO_ROOT"
  NEXU_USE_LAUNCHD=1 NEXU_HOME="$DEV_NEXU_HOME" NEXU_WORKSPACE_ROOT="$REPO_ROOT" \
    pnpm exec electron apps/desktop
}

show_status() {
  echo "=== Service Status ==="
  echo ""
  echo "Controller ($CONTROLLER_LABEL):"
  if launchctl print "$DOMAIN/$CONTROLLER_LABEL" &>/dev/null; then
    launchctl print "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null | grep -E "state|pid|last exit" || true
    # Check port
    if lsof -i ":$CONTROLLER_PORT" -P -n &>/dev/null; then
      echo "  Port $CONTROLLER_PORT: listening"
    else
      echo "  Port $CONTROLLER_PORT: not listening"
    fi
  else
    echo "  Not registered"
  fi
  echo ""
  echo "OpenClaw ($OPENCLAW_LABEL):"
  if launchctl print "$DOMAIN/$OPENCLAW_LABEL" &>/dev/null; then
    launchctl print "$DOMAIN/$OPENCLAW_LABEL" 2>/dev/null | grep -E "state|pid|last exit" || true
    # Check port
    if lsof -i ":$OPENCLAW_PORT" -P -n &>/dev/null; then
      echo "  Port $OPENCLAW_PORT: listening"
    else
      echo "  Port $OPENCLAW_PORT: not listening"
    fi
  else
    echo "  Not registered"
  fi
  echo ""
  echo "=== Electron Desktop ==="
  if pgrep -f "Electron.*apps/desktop" &>/dev/null; then
    echo "  Running"
    pgrep -f "Electron.*apps/desktop" | head -1 | xargs ps -p 2>/dev/null | tail -1 || true
  else
    echo "  Not running"
  fi
}

tail_logs() {
  echo "Tailing logs from $LOG_DIR..."
  echo "(Press Ctrl+C to stop)"
  echo ""
  if ls "$LOG_DIR"/*.log &>/dev/null; then
    tail -f "$LOG_DIR"/*.log
  else
    echo "No log files found yet. Start services first."
  fi
}

# Main
case "${1:-start}" in
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    sleep 1
    start_services
    ;;
  status)
    show_status
    ;;
  logs)
    tail_logs
    ;;
  clean)
    full_cleanup
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|clean}"
    exit 1
    ;;
esac
