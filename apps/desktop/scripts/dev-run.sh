#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
ELECTRON_MAIN_MATCH="$ROOT_DIR/node_modules/.pnpm/electron@.*/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \."

export NEXU_DESKTOP_BUILD_SOURCE="${NEXU_DESKTOP_BUILD_SOURCE:-local-dev}"
export NEXU_DESKTOP_BUILD_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '%s' 'unknown')"
export NEXU_DESKTOP_BUILD_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf '%s' 'unknown')"
export NEXU_DESKTOP_BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
export NEXU_DESKTOP_LAUNCH_ID="${1:-desktop-launch-unknown}"

exec "$APP_DIR/scripts/dev-env.sh" pnpm exec electron apps/desktop &
pid=$!

sleep 2
while pgrep -f "$ELECTRON_MAIN_MATCH" >/dev/null; do
  sleep 1
done

wait "$pid"
