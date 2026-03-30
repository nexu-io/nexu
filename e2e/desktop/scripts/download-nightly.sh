#!/usr/bin/env bash
#
# Download the latest nightly signed DMG + ZIP.
# Run: npm run download
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/artifacts"

DMG_URL="${NEXU_DESKTOP_E2E_DMG_URL:-https://desktop-releases.nexu.io/nightly/arm64/nexu-latest-nightly-mac-arm64.dmg}"
ZIP_URL="${NEXU_DESKTOP_E2E_ZIP_URL:-https://desktop-releases.nexu.io/nightly/arm64/nexu-latest-nightly-mac-arm64.zip}"

log() { printf '[download] %s\n' "$1" >&2; }

mkdir -p "$ARTIFACT_DIR"

download() {
  local url="$1"
  local target="$ARTIFACT_DIR/$(basename "$url")"

  if [ -f "$target" ]; then
    local age_hours
    age_hours=$(( ( $(date +%s) - $(stat -f %m "$target") ) / 3600 ))
    if [ "$age_hours" -lt 12 ]; then
      log "Skipping $target (${age_hours}h old, < 12h)"
      return 0
    fi
    log "Re-downloading $target (${age_hours}h old)"
  fi

  log "Downloading $(basename "$url")..."
  curl -fL --retry 3 --retry-delay 5 --progress-bar -o "$target" "$url"
  log "Saved to $target ($(du -h "$target" | cut -f1))"
}

download "$DMG_URL"
download "$ZIP_URL"

log ""
log "Artifacts ready in $ARTIFACT_DIR"
ls -lh "$ARTIFACT_DIR"
