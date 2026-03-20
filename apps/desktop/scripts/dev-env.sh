#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp"

for env_file in "$APP_DIR/.env" "$ROOT_DIR/apps/controller/.env"; do
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    break
  fi
done

export NEXU_WORKSPACE_ROOT="$ROOT_DIR"
export NEXU_DESKTOP_APP_ROOT="$APP_DIR"
export NEXU_DESKTOP_RUNTIME_ROOT="$TMP_DIR/desktop"

exec "$@"
