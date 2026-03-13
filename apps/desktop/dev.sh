#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
export NEXU_WORKSPACE_ROOT="$ROOT_DIR"
export NEXU_DESKTOP_APP_ROOT="$APP_DIR"
CHAT_DIR="$ROOT_DIR/apps/chat"
ELECTRON_DIR="$APP_DIR"
TMP_DIR="$ROOT_DIR/.tmp"
LOCK_DIR="$TMP_DIR/locks/desktop-dev.lock"
LOG_DIR="$TMP_DIR/logs"
LOG_FILE="$LOG_DIR/desktop-dev.log"
SESSION_NAME="nexu-desktop"
ELECTRON_MATCH="$ELECTRON_DIR/node_modules/.pnpm/electron@"
ELECTRON_MAIN_MATCH="$ROOT_DIR/node_modules/.pnpm/electron@.*/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \\."

mkdir -p "$TMP_DIR/locks" "$LOG_DIR"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_FILE"
}

run_logged() {
  log "run: $*"
  "$@" 2>&1 | tee -a "$LOG_FILE"
}

acquire_lock() {
  if [ -d "$LOCK_DIR" ] && [ "${DEV_SH_LOCK_HELD:-0}" = "1" ]; then
    return 0
  fi
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    sleep 0.1
  done
  export DEV_SH_LOCK_HELD=1
  trap 'rm -rf "$LOCK_DIR"' EXIT
}

session_exists() {
  tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

kill_residual_processes() {
  log "killing residual processes"
  pkill -9 -f "$ELECTRON_MATCH" 2>/dev/null || true
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
  done < <(pgrep -f "$ELECTRON_DIR/node_modules/.pnpm/electron@.*/Electron \\.$" 2>/dev/null || true)
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
  done < <(pgrep -f "$ROOT_DIR/node_modules/.pnpm/electron@.*/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \\.$" 2>/dev/null || true)
  pkill -9 -f "PGliteSocketServer" 2>/dev/null || true
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/api/dist/index.js" 2>/dev/null || true
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/gateway/dist/index.js" 2>/dev/null || true
  pkill -9 -f "$ELECTRON_DIR/node_modules/openclaw/openclaw.mjs" 2>/dev/null || true
  pkill -9 -f "openclaw-gateway" 2>/dev/null || true
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/openclaw/bin/openclaw" 2>/dev/null || true
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/pglite/index.js" 2>/dev/null || true
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/session-chat/server.js" 2>/dev/null || true
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/web/index.js" 2>/dev/null || true

  for port in 18789 50800 50810 50820 50822 50832; do
    while IFS= read -r pid; do
      [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  done
}

build_runtime() {
  log "building runtime artifacts"
  local web_port="${NEXU_WEB_PORT:-50810}"
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:pglite-sidecar
  run_logged pnpm --dir "$ROOT_DIR" --filter @nexu/shared build
  run_logged pnpm --dir "$ROOT_DIR" --filter @nexu/api build
  run_logged pnpm --dir "$ROOT_DIR" --filter @nexu/gateway build
  run_logged env VITE_AUTH_BASE_URL="http://127.0.0.1:${web_port}" pnpm --dir "$ROOT_DIR" --filter @nexu/web build
  run_logged pnpm --dir "$CHAT_DIR" build
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:api-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:gateway-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:openclaw-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:session-chat-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:web-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" build
}

start_session() {
  log "starting tmux session '$SESSION_NAME'"
  tmux new-session -d -s "$SESSION_NAME" \
    "cd \"$ELECTRON_DIR\" && export NEXU_WORKSPACE_ROOT=\"$ROOT_DIR\" NEXU_DESKTOP_APP_ROOT=\"$ELECTRON_DIR\"; pnpm exec electron .; sleep 2; while pgrep -f \"$ELECTRON_MAIN_MATCH\" >/dev/null; do sleep 1; done"
}

start() {
  acquire_lock
  if session_exists; then
    log "tmux session '$SESSION_NAME' already exists"
    return 0
  fi
  kill_residual_processes
  build_runtime
  start_session
  log "started tmux session '$SESSION_NAME'"
}

stop() {
  acquire_lock
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  kill_residual_processes
  log "stopped '$SESSION_NAME'"
}

restart() {
  stop
  start
}

status() {
  if session_exists; then
    log "tmux session '$SESSION_NAME' is running"
  else
    log "tmux session '$SESSION_NAME' is not running"
  fi
  pgrep -fal "$ELECTRON_MATCH" || true
  pgrep -fal "$ELECTRON_MAIN_MATCH" || true
}

logs() {
  tmux capture-pane -pt "$SESSION_NAME":0 -S -200
}

control() {
  open "file://$ELECTRON_DIR/dist/index.html"
}

devlog() {
  tail -n 200 "$LOG_FILE"
}

usage() {
  cat <<'EOF'
Usage: ./apps/desktop/dev.sh <command>

Commands:
  start    Build and launch Electron in tmux
  stop     Stop tmux session and residual local processes
  restart  Stop then start
  status   Show tmux and Electron process status
  logs     Show last 200 tmux lines
  devlog   Show last 200 wrapper log lines
  control  Open the local control plane shell directly
EOF
}

COMMAND="${1:-start}"

case "$COMMAND" in
  start) start ;;
  stop) stop ;;
  restart) restart ;;
  status) status ;;
  logs) logs ;;
  devlog) devlog ;;
  control) control ;;
  *)
    usage
    exit 1
    ;;
esac
