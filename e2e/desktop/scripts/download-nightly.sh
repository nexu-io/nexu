#!/usr/bin/env bash
#
# Download the latest nightly signed DMG + ZIP.
# Run: npm run download
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/artifacts"

log() { printf '[download] %s\n' "$1" >&2; }

resolve_mac_arch() {
  local arm64_capable
  arm64_capable="$(sysctl -in hw.optional.arm64 2>/dev/null || true)"
  if [ "$arm64_capable" = "1" ]; then
    printf 'arm64\n'
    return 0
  fi

  case "$(uname -m)" in
    arm64)
      printf 'arm64\n'
      ;;
    x86_64)
      printf 'x64\n'
      ;;
    *)
      log "ERROR: unsupported mac architecture: $(uname -m)"
      return 1
      ;;
  esac
}

MAC_ARCH="$(resolve_mac_arch)"
DEFAULT_DMG_URL="https://desktop-releases.nexu.io/nightly/$MAC_ARCH/nexu-latest-nightly-mac-$MAC_ARCH.dmg"
DEFAULT_ZIP_URL="https://desktop-releases.nexu.io/nightly/$MAC_ARCH/nexu-latest-nightly-mac-$MAC_ARCH.zip"

DMG_URL="${NEXU_DESKTOP_E2E_DMG_URL:-$DEFAULT_DMG_URL}"
ZIP_URL="${NEXU_DESKTOP_E2E_ZIP_URL:-$DEFAULT_ZIP_URL}"

mkdir -p "$ARTIFACT_DIR"

log "Using macOS artifact architecture: $MAC_ARCH"

download() {
  local url="$1"
  local target="$ARTIFACT_DIR/$(basename "$url")"
  local temp_target="$target.partial"

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
  rm -f "$temp_target"
  curl -fL --retry 3 --retry-delay 5 --progress-bar -o "$temp_target" "$url"
  mv "$temp_target" "$target"
  log "Saved to $target ($(du -h "$target" | cut -f1))"
}

download "$DMG_URL"
download "$ZIP_URL"

log ""
log "Artifacts ready in $ARTIFACT_DIR"
ls -lh "$ARTIFACT_DIR"
