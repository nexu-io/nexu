#!/usr/bin/env bash
#
# Kill ALL Nexu processes — Electron, launchd services, and orphans.
#
# Usage:
#   ./scripts/kill-all.sh          # Kill everything
#   ./scripts/kill-all.sh --dry    # Show what would be killed (no action)
#
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry" ]] && DRY_RUN=true

UID_VAL=$(id -u)
DOMAIN="gui/$UID_VAL"

LAUNCHD_LABELS=(
  "io.nexu.controller.dev"
  "io.nexu.openclaw.dev"
  "io.nexu.controller"
  "io.nexu.openclaw"
)

PROCESS_PATTERNS=(
  "Nexu"
  "Electron.*apps/desktop"
  "controller/dist/index.js"
  "openclaw.mjs gateway"
  "openclaw.mjs.*gateway"
  "chrome_crashpad_handler"
  "clawhub"
)

KNOWN_PORTS=(50800 50810 18789)

echo "=== Nexu Kill All ==="
echo ""

# 0. Dismiss any lingering quit dialogs (only if Nexu is running)
echo "--- Quit dialog ---"
if pgrep -q "Nexu" 2>/dev/null; then
  for label in "完全退出" "Quit Completely" "取消" "Cancel"; do
    osascript -e "tell application \"System Events\" to tell process \"Nexu\" to click button \"$label\" of window 1" 2>/dev/null && echo "  Clicked: $label" && break || true
  done
  sleep 1
else
  echo "  No Nexu process, skipping"
fi

# 1. Bootout launchd services
echo ""
echo "--- Launchd services ---"
for label in "${LAUNCHD_LABELS[@]}"; do
  if launchctl print "$DOMAIN/$label" &>/dev/null; then
    if $DRY_RUN; then
      echo "  [dry] Would bootout: $label"
    else
      echo "  Booting out: $label"
      launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    fi
  else
    echo "  Not registered: $label"
  fi
done

# 2. Kill processes by pattern
echo ""
echo "--- Processes ---"
for pattern in "${PROCESS_PATTERNS[@]}"; do
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    for pid in $pids; do
      [[ "$pid" == "$$" ]] && continue
      cmd=$(ps -p "$pid" -o args= 2>/dev/null || echo "unknown")
      if $DRY_RUN; then
        echo "  [dry] Would kill PID $pid: $cmd"
      else
        echo "  Killing PID $pid: $cmd"
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi
done

# 3. Free known ports
echo ""
echo "--- Ports ---"
for port in "${KNOWN_PORTS[@]}"; do
  pid=$(lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    cmd=$(ps -p "$pid" -o args= 2>/dev/null || echo "unknown")
    if $DRY_RUN; then
      echo "  [dry] Port $port occupied by PID $pid: $cmd"
    else
      echo "  Port $port occupied by PID $pid — killing: $cmd"
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    echo "  Port $port: free"
  fi
done

echo ""
if $DRY_RUN; then
  echo "Dry run complete. Run without --dry to execute."
else
  echo "Done. All Nexu processes killed."
fi
