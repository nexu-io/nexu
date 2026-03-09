#!/usr/bin/env bash
# Update existing agent workspaces with new templates.
# Only replaces files that still contain the OLD default template marker.
#
# Usage:
#   ./update-existing-agents.sh                  # dry-run (default)
#   ./update-existing-agents.sh --apply          # actually replace files

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NAMESPACE="${NAMESPACE:-nexu}"
DATA_DIR="${DATA_DIR:-/data/openclaw/agents}"
DRY_RUN=true

if [[ "${1:-}" == "--apply" ]]; then
  DRY_RUN=false
fi

# Files to check & replace (seed-mode files that changed)
# HEARTBEAT.md, TOOLS.md, USER.md didn't change content — skip them
SEED_FILES=(BOOTSTRAP.md IDENTITY.md SOUL.md)

# Old template marker — all old defaults contain this exact string
OLD_MARKER="Nexu agent"

# Get gateway pods
PODS=$(kubectl get pods -n "$NAMESPACE" -l app=nexu-gateway -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
if [[ -z "$PODS" ]]; then
  # Fallback: match by name prefix
  PODS=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep "^nexu-gateway")
fi

echo "=== Workspace Template Update ==="
echo "Mode: $(if $DRY_RUN; then echo 'DRY-RUN (pass --apply to execute)'; else echo 'APPLY'; fi)"
echo "Pods: $PODS"
echo ""

for POD in $PODS; do
  echo "--- $POD ---"

  # List agent directories
  AGENTS=$(kubectl exec -n "$NAMESPACE" "$POD" -- ls "$DATA_DIR" 2>/dev/null || true)

  for AGENT in $AGENTS; do
    WORKSPACE="$DATA_DIR/$AGENT"

    for FILE in "${SEED_FILES[@]}"; do
      FILEPATH="$WORKSPACE/$FILE"

      # Check if file exists and contains old marker
      HAS_OLD=$(kubectl exec -n "$NAMESPACE" "$POD" -- sh -c "grep -c '$OLD_MARKER' '$FILEPATH' 2>/dev/null || echo 0" | tr -d '[:space:]')

      if [[ "$HAS_OLD" -gt 0 ]]; then
        if $DRY_RUN; then
          echo "  WOULD REPLACE  $AGENT/$FILE  (found '$OLD_MARKER' $HAS_OLD times)"
        else
          # Copy new template content into the pod and replace
          kubectl cp "$SCRIPT_DIR/$FILE" "$NAMESPACE/$POD:$FILEPATH"
          echo "  REPLACED       $AGENT/$FILE"
        fi
      fi
    done
  done
done

echo ""
echo "Done."
