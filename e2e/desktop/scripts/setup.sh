#!/usr/bin/env bash
#
# One-time machine setup for desktop E2E automation.
# Run: npm run setup  (or: bash scripts/setup.sh)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf '[setup] %s\n' "$1" >&2; }

# ---------- Node.js ----------
if ! command -v node &>/dev/null; then
  log "ERROR: Node.js not found. Install via nvm or brew:"
  log "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  log "  nvm install 24"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 22 ]; then
  log "ERROR: Node.js >= 22 required, got $(node -v)"
  exit 1
fi
log "Node.js $(node -v) OK"

# ---------- npm dependencies ----------
log "Installing dependencies..."
cd "$REPO_ROOT"
npm install

# ---------- Playwright ----------
if ! npx playwright --version &>/dev/null; then
  log "Installing Playwright browsers..."
  npx playwright install
fi
log "Playwright $(npx playwright --version) OK"

# ---------- directories ----------
mkdir -p "$REPO_ROOT/artifacts" "$REPO_ROOT/captures" "$REPO_ROOT/.tmp"

log ""
log "Setup complete. Next steps:"
log "  npm run download    # Download latest nightly build"
log "  npm test            # Run full E2E"
