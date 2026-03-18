#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp"
export NEXU_WORKSPACE_ROOT="$ROOT_DIR"
export NEXU_DESKTOP_APP_ROOT="$APP_DIR"
export NEXU_DESKTOP_RUNTIME_ROOT="$TMP_DIR/desktop"
ELECTRON_DIR="$APP_DIR"
LOCK_DIR="$TMP_DIR/locks/desktop-dev.lock"
LOG_DIR="$TMP_DIR/logs"
LOG_FILE="$LOG_DIR/desktop-dev.log"
SESSION_NAME="nexu-desktop"
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

validate_workspace_layout() {
  if [ ! -f "$ROOT_DIR/package.json" ] || [ ! -f "$APP_DIR/package.json" ]; then
    cat >&2 <<EOF
[desktop-dev] invalid workspace layout detected

Expected:
- NEXU_WORKSPACE_ROOT -> repo root containing package.json
- NEXU_DESKTOP_APP_ROOT -> apps/desktop containing package.json

Resolved values:
- NEXU_WORKSPACE_ROOT=$ROOT_DIR
- NEXU_DESKTOP_APP_ROOT=$APP_DIR

Try:
1. Run from the Nexu repo checkout root
2. Start with: pnpm desktop:start
3. If launching manually, export both env vars before starting Electron
EOF
    exit 1
  fi
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
  pkill -9 -f "$ROOT_DIR/.tmp/sidecars/web/index.js" 2>/dev/null || true

  for port in 18789 50800 50810 50832; do
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
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:api-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:gateway-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:openclaw-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" prepare:web-sidecar
  run_logged pnpm --dir "$ELECTRON_DIR" build
}

start_session() {
  run_logged pnpm --dir "$ROOT_DIR" exec electron --version
  log "starting tmux session '$SESSION_NAME'"
  tmux new-session -d -s "$SESSION_NAME" \
    "cd \"$ROOT_DIR\" && export NEXU_WORKSPACE_ROOT=\"$ROOT_DIR\" NEXU_DESKTOP_APP_ROOT=\"$ELECTRON_DIR\" NEXU_DESKTOP_RUNTIME_ROOT=\"$NEXU_DESKTOP_RUNTIME_ROOT\"; pnpm exec electron apps/desktop; sleep 2; while pgrep -f \"$ELECTRON_MAIN_MATCH\" >/dev/null; do sleep 1; done"
}

start() {
  acquire_lock
  validate_workspace_layout
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
  validate_workspace_layout
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  kill_residual_processes
  log "stopped '$SESSION_NAME'"
}

reset_state() {
  stop
  rm -rf "$NEXU_DESKTOP_RUNTIME_ROOT"
  log "reset desktop runtime state at '$NEXU_DESKTOP_RUNTIME_ROOT'"
}

restart() {
  stop
  start
}

status() {
  validate_workspace_layout
  if session_exists; then
    log "tmux session '$SESSION_NAME' is running"
  else
    log "tmux session '$SESSION_NAME' is not running"
  fi
  pgrep -fal "$ELECTRON_MAIN_MATCH" || true
}

logs() {
  tmux capture-pane -pt "$SESSION_NAME" -S -200
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
  reset-state  Stop runtime and delete repo-local desktop state
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
  reset-state) reset_state ;;
  status) status ;;
  logs) logs ;;
  devlog) devlog ;;
  control) control ;;
  *)
    usage
    exit 1
    ;;
esac
