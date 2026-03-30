#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="nexu-launchd"
LAUNCH_SCRIPT="$REPO_ROOT/scripts/dev-launchd.sh"

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    echo "tmux is required for background launchd mode commands" >&2
    exit 1
  fi
}

session_exists() {
  tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

start_bg() {
  require_tmux
  if session_exists; then
    echo "Background session '$SESSION_NAME' already running"
    return 0
  fi

  tmux new-session -d -s "$SESSION_NAME" "$LAUNCH_SCRIPT start"
  echo "Started background session '$SESSION_NAME'"
}

stop_bg() {
  "$LAUNCH_SCRIPT" stop
  if session_exists; then
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  fi
}

restart_bg() {
  require_tmux
  stop_bg
  start_bg
}

show_status() {
  "$LAUNCH_SCRIPT" status
  if session_exists; then
    echo ""
    echo "Background session '$SESSION_NAME': running"
  else
    echo ""
    echo "Background session '$SESSION_NAME': not running"
  fi
}

show_logs() {
  require_tmux
  if ! session_exists; then
    echo "Background session '$SESSION_NAME' is not running" >&2
    exit 1
  fi

  tmux capture-pane -pt "$SESSION_NAME" -S -200
}

case "${1:-start}" in
  start)
    start_bg
    ;;
  stop)
    stop_bg
    ;;
  restart)
    restart_bg
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
