#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COLLECTOR="${SCRIPT_DIR}/collect-nexu-identity.mjs"

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if [ -x "/opt/homebrew/bin/node" ]; then
    echo "/opt/homebrew/bin/node"
    return 0
  fi

  if [ -x "/usr/local/bin/node" ]; then
    echo "/usr/local/bin/node"
    return 0
  fi

  local nvm_candidate
  nvm_candidate="$(ls -1d "${HOME}/.nvm/versions/node/"*/bin/node 2>/dev/null | tail -n 1 || true)"
  if [ -n "${nvm_candidate}" ] && [ -x "${nvm_candidate}" ]; then
    echo "${nvm_candidate}"
    return 0
  fi

  return 1
}

NODE_BIN="$(resolve_node_bin || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "ERROR: Node.js binary not found. Install Node or add it to PATH." >&2
  exit 127
fi

exec "${NODE_BIN}" "${COLLECTOR}" "$@"
