#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp"

ensure_dev_electron_lsui_element() {
  # Prevent child processes spawned with the dev Electron binary from creating
  # extra Dock icons. The packaged app has LSUIElement=true baked into its
  # Info.plist; in dev we must patch the node_modules Electron.app plist.
  #
  # Without this, every spawn(process.execPath, ..., { ELECTRON_RUN_AS_NODE:1 })
  # can briefly flash a Dock icon before Electron reads the env var.

  local electron_exec electron_app info_plist current_value

  electron_exec="$(pnpm --dir "$ROOT_DIR" exec node -e 'const electron=require("electron"); process.stdout.write(electron)' 2>/dev/null)" || true
  if [ -z "$electron_exec" ] || [ ! -x "$electron_exec" ]; then
    echo "[dev-env] warning: could not resolve Electron binary path" >&2
    return 0
  fi

  electron_app="${electron_exec%/Contents/MacOS/Electron}"
  info_plist="$electron_app/Contents/Info.plist"
  if [ ! -f "$info_plist" ]; then
    echo "[dev-env] warning: Electron Info.plist not found at $info_plist" >&2
    return 0
  fi

  current_value="$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$info_plist" 2>/dev/null || true)"
  if [ "$current_value" = "true" ] || [ "$current_value" = "1" ]; then
    return 0
  fi

  # Patch the plist — try Set first (key exists but wrong value), then Add
  if /usr/libexec/PlistBuddy -c 'Set :LSUIElement true' "$info_plist" 2>/dev/null || \
     /usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' "$info_plist" 2>/dev/null; then
    # Flush macOS Launch Services cache so the change takes effect immediately.
    # Without this, macOS may use a cached copy of the old plist and still
    # show Dock icons for child processes.
    if /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
      -f "$electron_app" 2>/dev/null; then
      echo "[dev-env] patched Electron LSUIElement=true + flushed LS cache"
    else
      echo "[dev-env] patched Electron LSUIElement=true (LS cache flush skipped)"
    fi
  else
    echo "[dev-env] warning: failed to patch LSUIElement in $info_plist" >&2
  fi
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
