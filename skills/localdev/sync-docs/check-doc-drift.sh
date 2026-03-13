#!/usr/bin/env bash
set -euo pipefail

# Get changed files (branch + working tree)
merge_base=$(git merge-base HEAD origin/main 2>/dev/null) || exit 0
changed=$(git diff --name-only "$merge_base"...HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null; git diff --name-only 2>/dev/null)
[ -z "$changed" ] && exit 0

# Check for code areas that affect docs
affected=()
echo "$changed" | grep -q "apps/api/src/db/schema/" && affected+=("docs/generated/db-schema.md")
echo "$changed" | grep -q "apps/api/src/routes/" && affected+=("docs/references/api-patterns.md")
echo "$changed" | grep -q "apps/web/src/" && affected+=("docs/FRONTEND.md")
echo "$changed" | grep -q "apps/gateway/src/" && affected+=("docs/RELIABILITY.md, ARCHITECTURE.md")
echo "$changed" | grep -q "package.json" && affected+=("CLAUDE.md + AGENTS.md Commands")
echo "$changed" | grep -q "apps/api/src/lib/config-generator" && affected+=("docs/references/openclaw-config-schema.md")
echo "$changed" | grep -q "apps/api/src/auth" && affected+=("docs/SECURITY.md")

[ ${#affected[@]} -eq 0 ] && exit 0

echo "Documentation may need updating. Changed code affects:"
for doc in "${affected[@]}"; do
  echo "  - $doc"
done
echo "Run the sync-docs skill or /sync-docs to review."
