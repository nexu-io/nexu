#!/usr/bin/env bash
#
# Push a managed skill from skills/nexubot/<name>/ to the Nexu API.
#
# Usage:
#   bash skills/scripts/push-skill.sh <skill-name> [API_URL] [INTERNAL_TOKEN]
#
# Defaults:
#   API_URL        → http://localhost:3000  (or $NEXU_API_URL)
#   INTERNAL_TOKEN → from $INTERNAL_API_TOKEN env
#
# The script reads all files under skills/nexubot/<name>/, constructs JSON
# via node -e (jq-free), and PUTs to /api/internal/skills/<name>.

set -euo pipefail

SKILL_NAME="${1:-}"
API_URL="${2:-${NEXU_API_URL:-http://localhost:3000}}"
TOKEN="${3:-${INTERNAL_API_TOKEN:-}}"

if [ -z "$SKILL_NAME" ]; then
  echo "Usage: push-skill.sh <skill-name> [API_URL] [INTERNAL_TOKEN]" >&2
  exit 1
fi

# Resolve skill directory relative to repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILL_DIR="$REPO_ROOT/skills/nexubot/$SKILL_NAME"

if [ ! -d "$SKILL_DIR" ]; then
  echo "Error: Skill directory not found: $SKILL_DIR" >&2
  exit 1
fi

if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  echo "Error: SKILL.md not found in $SKILL_DIR" >&2
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo "Error: No API token. Provide as 3rd arg or set INTERNAL_API_TOKEN env." >&2
  exit 1
fi

echo "Pushing skill '$SKILL_NAME' to $API_URL ..."

# Build JSON payload using node (jq-free, works on minimal environments).
# Reads SKILL.md as content, and all files recursively as the files map.
JSON_PAYLOAD=$(node -e '
const fs = require("fs");
const path = require("path");

const skillDir = process.argv[1];

// Read SKILL.md as the content field
const content = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");

// Recursively collect all files
const files = {};
function walk(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.isDirectory()) {
      // Skip node_modules
      if (entry.name === "node_modules") continue;
      walk(path.join(dir, entry.name), rel);
    } else {
      files[rel] = fs.readFileSync(path.join(dir, entry.name), "utf-8");
    }
  }
}
walk(skillDir, "");

console.log(JSON.stringify({ content, files }));
' "$SKILL_DIR")

# PUT to API
HTTP_STATUS=$(curl -s -o /tmp/push-skill-response.json -w "%{http_code}" \
  -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data-raw "$JSON_PAYLOAD" \
  "$API_URL/api/internal/skills/$SKILL_NAME")

RESPONSE=$(cat /tmp/push-skill-response.json)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "Success! Response: $RESPONSE"
else
  echo "Error: HTTP $HTTP_STATUS" >&2
  echo "$RESPONSE" >&2
  exit 1
fi
