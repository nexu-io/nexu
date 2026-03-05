#!/usr/bin/env bash
# Deploy workspace templates from this directory to the Nexu API.
#
# writeMode is auto-detected:
#   - Files containing <!-- NEXU-PLATFORM-START --> markers → "inject"
#   - Files without markers → "seed"
#
# Usage:
#   ./deploy.sh                          # defaults: localhost:3000, token from .env
#   API_URL=https://api.nexu.app INTERNAL_API_TOKEN=xxx ./deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_URL="${API_URL:-http://localhost:3000}"
TOKEN="${INTERNAL_API_TOKEN:-gw-secret-token}"

for FILE in "${SCRIPT_DIR}"/*.md; do
  [ -f "$FILE" ] || continue

  NAME="$(basename "$FILE")"

  # Auto-detect writeMode from marker presence
  if grep -q "NEXU-PLATFORM-START" "$FILE"; then
    WRITE_MODE="inject"
  else
    WRITE_MODE="seed"
  fi

  CONTENT=$(jq -Rs '.' "$FILE")
  BODY=$(jq -n --argjson content "$CONTENT" --arg wm "$WRITE_MODE" \
    '{content: $content, writeMode: $wm}')

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "${API_URL}/api/internal/workspace-templates/${NAME}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  if [ "$HTTP_CODE" = "200" ]; then
    echo "OK    $NAME (writeMode=$WRITE_MODE)"
  else
    echo "FAIL  $NAME (HTTP $HTTP_CODE)" >&2
  fi
done
