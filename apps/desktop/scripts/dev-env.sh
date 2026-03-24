#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp"

ensure_dev_electron_lsui_element() {
  local electron_exec electron_app info_plist current_value

  electron_exec="$(pnpm --dir "$ROOT_DIR" exec node -e 'const electron=require("electron"); process.stdout.write(electron)')"
  if [ -z "$electron_exec" ] || [ ! -x "$electron_exec" ]; then
    return 0
  fi

  electron_app="${electron_exec%/Contents/MacOS/Electron}"
  info_plist="$electron_app/Contents/Info.plist"
  if [ ! -f "$info_plist" ]; then
    return 0
  fi

  current_value="$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$info_plist" 2>/dev/null || true)"
  if [ "$current_value" = "true" ] || [ "$current_value" = "1" ]; then
    return 0
  fi

  /usr/libexec/PlistBuddy -c 'Set :LSUIElement true' "$info_plist" 2>/dev/null || \
    /usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$info_plist"
}

for env_file in "$ROOT_DIR/.env" "$ROOT_DIR/apps/controller/.env" "$APP_DIR/.env"; do
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

export NEXU_WORKSPACE_ROOT="$ROOT_DIR"
export NEXU_DESKTOP_APP_ROOT="$APP_DIR"
export NEXU_DESKTOP_RUNTIME_ROOT="$TMP_DIR/desktop"

ensure_dev_electron_lsui_element

exec "$@"
