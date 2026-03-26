#!/usr/bin/env bash
#
# desktop-stop-smoke.sh — Verify clean shutdown after dev.sh stop
#
# Checks that:
# 1. No Nexu processes remain after stop
# 2. Controller port is free
# 3. OpenClaw port is free
# 4. Web port is free
# 5. No launchd services remain registered (dev labels)
# 6. No stale runtime-ports.json
#
# Usage:
#   bash scripts/desktop-stop-smoke.sh
#
# Must be run AFTER dev.sh stop has completed.

set -euo pipefail

CONTROLLER_PORT="${NEXU_CONTROLLER_PORT:-50800}"
OPENCLAW_PORT="${NEXU_OPENCLAW_PORT:-18789}"
WEB_PORT="${NEXU_WEB_PORT:-50810}"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  ✓ $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  ✗ $1" >&2
}

echo "=== Desktop Stop Smoke Test ==="
echo ""

# ---------------------------------------------------------------------------
# 1. No Nexu processes remain
# ---------------------------------------------------------------------------

echo "--- Process checks ---"

for pattern in "controller/dist/index.js" "openclaw.mjs gateway" "openclaw-gateway" "apps/web/dist/index.js"; do
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [ -z "$pids" ]; then
    pass "no processes matching '$pattern'"
  else
    fail "residual process(es) matching '$pattern': $pids"
  fi
done

# Check for Electron dev processes
electron_pids=$(pgrep -f "Electron.*apps/desktop" 2>/dev/null || true)
if [ -z "$electron_pids" ]; then
  pass "no Electron dev processes"
else
  fail "residual Electron process(es): $electron_pids"
fi

# Check for tsc watcher (started by dev-launchd.sh, should be killed on stop)
tsc_pids=$(pgrep -f "tsc --watch.*apps/controller" 2>/dev/null || true)
if [ -z "$tsc_pids" ]; then
  pass "no tsc watcher processes"
else
  fail "residual tsc watcher process(es): $tsc_pids"
fi

# ---------------------------------------------------------------------------
# 2-4. Ports are free
# ---------------------------------------------------------------------------

echo ""
echo "--- Port checks ---"

for port in $CONTROLLER_PORT $OPENCLAW_PORT $WEB_PORT; do
  if ! lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null; then
    pass "port $port is free"
  else
    occupier=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    fail "port $port still occupied by pid=$occupier"
  fi
done

# ---------------------------------------------------------------------------
# 5. No launchd services registered (dev labels)
# ---------------------------------------------------------------------------

echo ""
echo "--- Launchd checks ---"

if [ "$(uname)" = "Darwin" ]; then
  for label in "io.nexu.controller.dev" "io.nexu.openclaw.dev"; do
    if ! launchctl print "$DOMAIN/$label" &>/dev/null; then
      pass "launchd label '$label' not registered"
    else
      fail "launchd label '$label' still registered"
    fi
  done
else
  pass "skipped launchd checks (not macOS)"
fi

# ---------------------------------------------------------------------------
# 6. No stale runtime-ports.json
# ---------------------------------------------------------------------------

echo ""
echo "--- State checks ---"

RUNTIME_PORTS=".tmp/launchd/runtime-ports.json"
if [ ! -f "$RUNTIME_PORTS" ]; then
  pass "no stale runtime-ports.json"
else
  fail "stale runtime-ports.json exists at $RUNTIME_PORTS"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "=== Results: $PASS_COUNT passed, $FAIL_COUNT failed ==="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
