#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export BITABLE_BASE_TOKEN="${BITABLE_BASE_TOKEN:-IjTWbPUYlaaD6asCUf5crYPFnoc}"
export BITABLE_TABLE_ID="${BITABLE_TABLE_ID:-tbl2Yd8krZwfzFsS}"
export BITABLE_VIEW_ID="${BITABLE_VIEW_ID:-vewgOAhLMw}"
export GITHUB_REPO="${GITHUB_REPO:-nexu-io/nexu}"
export GITHUB_BASE_LABELS="${GITHUB_BASE_LABELS:-source:feishu,triage}"
export LARK_IDENTITY="${LARK_IDENTITY:-bot}"

if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    export GITHUB_TOKEN="$(gh auth token)"
  fi
fi

python3 "$BASE_DIR/scripts/sync_feishu_bitable_to_github.py"
