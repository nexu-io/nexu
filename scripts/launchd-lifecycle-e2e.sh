#!/usr/bin/env bash
#
# launchd-lifecycle-e2e.sh — Real launchd integration test for macOS CI
#
# Exercises the full lifecycle: bootstrap → verify running → teardown →
# verify dead → simulate orphan scenario → cold-start cleanup.
#
# Requires macOS (launchd) and pnpm install to have been run.
# Designed to run on GitHub Actions macOS runners and locally.
#
# Usage:
#   bash scripts/launchd-lifecycle-e2e.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$REPO_ROOT/.tmp/launchd-e2e"
NEXU_HOME="$REPO_ROOT/.tmp/launchd-e2e-home"
LOG_DIR="$NEXU_HOME/logs"
STATE_DIR="$REPO_ROOT/.tmp/launchd-e2e-state"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

CONTROLLER_LABEL="io.nexu.controller.e2e"
OPENCLAW_LABEL="io.nexu.openclaw.e2e"

NODE_PATH="$(command -v node)"
CONTROLLER_ENTRY="$REPO_ROOT/apps/controller/dist/index.js"
SLIMCLAW_RUNTIME_ROOT="$REPO_ROOT/packages/slimclaw/.dist-runtime/openclaw"
OPENCLAW_ENTRY="$SLIMCLAW_RUNTIME_ROOT/node_modules/openclaw/openclaw.mjs"
OPENCLAW_BIN="$SLIMCLAW_RUNTIME_ROOT/bin/openclaw"
OPENCLAW_EXTENSIONS_DIR="$SLIMCLAW_RUNTIME_ROOT/node_modules/openclaw/extensions"

# Use high ports to avoid conflicts
CONTROLLER_PORT=51800
OPENCLAW_PORT=51789

PASS_COUNT=0
FAIL_COUNT=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  ✓ $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  ✗ $1" >&2
}

check() {
  local description="$1"
  shift
  if "$@" 2>/dev/null; then
    pass "$description"
  else
    fail "$description"
  fi
}

is_label_registered() {
  launchctl print "$DOMAIN/$1" &>/dev/null
}

get_service_pid() {
  launchctl print "$DOMAIN/$1" 2>/dev/null | grep -oE 'pid = [0-9]+' | grep -oE '[0-9]+' || echo ""
}

is_pid_alive() {
  kill -0 "$1" 2>/dev/null
}

wait_for_port() {
  local port="$1"
  local timeout="${2:-15}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if lsof -iTCP:"$port" -sTCP:LISTEN -P -n &>/dev/null; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

wait_for_exit() {
  local pid="$1"
  local timeout="${2:-10}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ---------------------------------------------------------------------------
# Cleanup (runs on exit, always)
# ---------------------------------------------------------------------------

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  # Bootout services if registered
  launchctl bootout "$DOMAIN/$OPENCLAW_LABEL" 2>/dev/null || true
  launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true

  # Kill any orphans by port
  for port in $CONTROLLER_PORT $OPENCLAW_PORT; do
    local pid
    pid=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$pid" ]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  # Remove plist files
  rm -f "$PLIST_DIR/$CONTROLLER_LABEL.plist" "$PLIST_DIR/$OPENCLAW_LABEL.plist"
  rm -rf "$PLIST_DIR" "$NEXU_HOME" "$STATE_DIR"

  echo ""
  echo "=== Results: $PASS_COUNT passed, $FAIL_COUNT failed ==="
  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

echo "=== Launchd Lifecycle E2E Test ==="
echo ""

if [ "$(uname)" != "Darwin" ]; then
  echo "SKIP: This test requires macOS (launchd)" >&2
  exit 0
fi

if [ ! -f "$CONTROLLER_ENTRY" ]; then
  echo "Building all (controller needs shared)..."
  pnpm build
fi

if [ ! -f "$OPENCLAW_ENTRY" ] || [ ! -f "$OPENCLAW_BIN" ] || [ ! -d "$OPENCLAW_EXTENSIONS_DIR" ]; then
  echo "Prepared slimclaw runtime is missing. Run pnpm slimclaw:prepare first." >&2
  exit 1
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR" "$STATE_DIR" "$STATE_DIR/skills" "$STATE_DIR/tmp"

# ---------------------------------------------------------------------------
# Generate plists for both openclaw + controller.
# Controller external bootstrap now depends on a live OpenClaw control plane
# before it starts serving HTTP, so this e2e must launch OpenClaw first.
# ---------------------------------------------------------------------------

echo "--- Phase 1: Bootstrap ---"

cat > "$PLIST_DIR/$OPENCLAW_LABEL.plist" <<OPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$OPENCLAW_LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$OPENCLAW_ENTRY</string>
        <string>gateway</string>
        <string>run</string>
        <string>--allow-unconfigured</string>
        <string>--port</string>
        <string>$OPENCLAW_PORT</string>
        <string>--auth</string>
        <string>none</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$SLIMCLAW_RUNTIME_ROOT</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ELECTRON_RUN_AS_NODE</key>
        <string>1</string>
        <key>OPENCLAW_CONFIG</key>
        <string>$STATE_DIR/openclaw.json</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>$STATE_DIR/openclaw.json</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>$STATE_DIR</string>
        <key>OPENCLAW_LAUNCHD_LABEL</key>
        <string>$OPENCLAW_LABEL</string>
        <key>OPENCLAW_SERVICE_MARKER</key>
        <string>launchd</string>
        <key>OPENCLAW_IMAGE_BACKEND</key>
        <string>sips</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>PATH</key>
        <string>$PATH</string>
        <key>NODE_PATH</key>
        <string>$SLIMCLAW_RUNTIME_ROOT/node_modules</string>
    </dict>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/openclaw-e2e.log</string>

    <key>StandardErrorPath</key>
    <string>$LOG_DIR/openclaw-e2e.error.log</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
OPLIST

cat > "$PLIST_DIR/$CONTROLLER_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$CONTROLLER_LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$CONTROLLER_ENTRY</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_ROOT/apps/controller</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>$CONTROLLER_PORT</string>
        <key>HOST</key>
        <string>127.0.0.1</string>
        <key>NODE_ENV</key>
        <string>development</string>
        <key>NEXU_HOME</key>
        <string>$NEXU_HOME</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>$STATE_DIR</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>$STATE_DIR/openclaw.json</string>
        <key>OPENCLAW_GATEWAY_PORT</key>
        <string>$OPENCLAW_PORT</string>
        <key>OPENCLAW_BIN</key>
        <string>$OPENCLAW_BIN</string>
        <key>OPENCLAW_EXTENSIONS_DIR</key>
        <string>$OPENCLAW_EXTENSIONS_DIR</string>
        <key>RUNTIME_MANAGE_OPENCLAW_PROCESS</key>
        <string>false</string>
        <key>RUNTIME_GATEWAY_PROBE_ENABLED</key>
        <string>false</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/controller-e2e.log</string>

    <key>StandardErrorPath</key>
    <string>$LOG_DIR/controller-e2e.error.log</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
PLIST

# Bootstrap OpenClaw first so controller external attach can complete
launchctl bootstrap "$DOMAIN" "$PLIST_DIR/$OPENCLAW_LABEL.plist"
check "openclaw service registered" is_label_registered "$OPENCLAW_LABEL"

launchctl kickstart "$DOMAIN/$OPENCLAW_LABEL"
sleep 2

OPENCLAW_PID="$(get_service_pid "$OPENCLAW_LABEL")"
if [ -n "$OPENCLAW_PID" ] && is_pid_alive "$OPENCLAW_PID"; then
  pass "openclaw process running (pid=$OPENCLAW_PID)"
else
  fail "openclaw process not running (pid=${OPENCLAW_PID:-none})"
fi

if wait_for_port "$OPENCLAW_PORT" 20; then
  pass "openclaw port $OPENCLAW_PORT listening"
else
  fail "openclaw port $OPENCLAW_PORT not listening after 20s"
  echo "  --- openclaw stdout ---"
  tail -20 "$LOG_DIR/openclaw-e2e.log" 2>/dev/null || echo "  (no log)"
  echo "  --- openclaw stderr ---"
  tail -20 "$LOG_DIR/openclaw-e2e.error.log" 2>/dev/null || echo "  (no log)"
fi

# Bootstrap controller after OpenClaw is live
launchctl bootstrap "$DOMAIN" "$PLIST_DIR/$CONTROLLER_LABEL.plist"
check "controller service registered" is_label_registered "$CONTROLLER_LABEL"

# Start
launchctl kickstart "$DOMAIN/$CONTROLLER_LABEL"
sleep 2

# Verify running
CONTROLLER_PID="$(get_service_pid "$CONTROLLER_LABEL")"
if [ -n "$CONTROLLER_PID" ] && is_pid_alive "$CONTROLLER_PID"; then
  pass "controller process running (pid=$CONTROLLER_PID)"
else
  fail "controller process not running (pid=${CONTROLLER_PID:-none})"
fi

# Wait for port
if wait_for_port "$CONTROLLER_PORT" 20; then
  pass "controller port $CONTROLLER_PORT listening"
else
  fail "controller port $CONTROLLER_PORT not listening after 20s"
  # Show logs for debugging
  echo "  --- controller stdout ---"
  tail -20 "$LOG_DIR/controller-e2e.log" 2>/dev/null || echo "  (no log)"
  echo "  --- controller stderr ---"
  tail -20 "$LOG_DIR/controller-e2e.error.log" 2>/dev/null || echo "  (no log)"
fi

# HTTP connectivity check (any response = process is serving)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$CONTROLLER_PORT/api/auth/get-session" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" != "000" ]; then
  pass "controller HTTP responding (status=$HTTP_STATUS)"
else
  fail "controller HTTP not responding"
fi

# ---------------------------------------------------------------------------
# Phase 2: Teardown via bootout
# ---------------------------------------------------------------------------

echo ""
echo "--- Phase 2: Teardown (bootout + waitForExit) ---"

SAVED_PID="$CONTROLLER_PID"

# Bootout (unregister from launchd)
launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true

# Verify label unregistered
sleep 1
if ! is_label_registered "$CONTROLLER_LABEL"; then
  pass "controller label unregistered after bootout"
else
  fail "controller label still registered after bootout"
fi

# Verify process exits
if [ -n "$SAVED_PID" ]; then
  if wait_for_exit "$SAVED_PID" 10; then
    pass "controller process (pid=$SAVED_PID) exited after bootout"
  else
    fail "controller process (pid=$SAVED_PID) still alive 10s after bootout"
    # Force kill for cleanup
    kill -9 "$SAVED_PID" 2>/dev/null || true
  fi
fi

# Port should be free
sleep 1
if ! lsof -iTCP:"$CONTROLLER_PORT" -sTCP:LISTEN -P -n &>/dev/null; then
  pass "controller port $CONTROLLER_PORT released"
else
  fail "controller port $CONTROLLER_PORT still occupied"
fi

# ---------------------------------------------------------------------------
# Phase 3: SIGKILL fallback (simulate stuck process)
# ---------------------------------------------------------------------------

echo ""
echo "--- Phase 3: SIGKILL fallback ---"

# Re-bootstrap and start
launchctl bootstrap "$DOMAIN" "$PLIST_DIR/$CONTROLLER_LABEL.plist"
launchctl kickstart "$DOMAIN/$CONTROLLER_LABEL"
sleep 2

CONTROLLER_PID="$(get_service_pid "$CONTROLLER_LABEL")"

if [ -n "$CONTROLLER_PID" ] && is_pid_alive "$CONTROLLER_PID"; then
  pass "controller re-started for SIGKILL test (pid=$CONTROLLER_PID)"

  # Save PID before bootout (like our bootoutAndWaitForExit does)
  SAVED_PID3="$CONTROLLER_PID"

  # Bootout (process may or may not exit cleanly)
  launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true

  # Immediately SIGKILL using saved PID (simulate ensureNexuProcessesDead)
  sleep 0.5
  if is_pid_alive "$SAVED_PID3"; then
    kill -9 "$SAVED_PID3" 2>/dev/null || true
    sleep 1
    if ! is_pid_alive "$SAVED_PID3"; then
      pass "SIGKILL successfully terminated stubborn process (pid=$SAVED_PID3)"
    else
      fail "process (pid=$SAVED_PID3) survived SIGKILL"
    fi
  else
    pass "process exited before SIGKILL was needed"
  fi
else
  fail "controller did not restart for SIGKILL test"
fi

# ---------------------------------------------------------------------------
# Phase 4: Cold start with orphan cleanup
# ---------------------------------------------------------------------------

echo ""
echo "--- Phase 4: Orphan detection via pgrep ---"

# Start a detached node process that looks like a controller (orphan)
"$NODE_PATH" -e "
  const http = require('http');
  const s = http.createServer((_, r) => { r.writeHead(200); r.end('ok'); });
  s.listen($CONTROLLER_PORT, '127.0.0.1', () => {
    console.log('orphan controller listening on $CONTROLLER_PORT');
  });
  // Keep alive for 60s max
  setTimeout(() => process.exit(0), 60000);
" &
ORPHAN_PID=$!
sleep 1

if is_pid_alive "$ORPHAN_PID"; then
  pass "orphan process spawned (pid=$ORPHAN_PID)"
else
  fail "orphan process failed to start"
fi

# Verify pgrep can find it (match by port pattern in lsof)
if lsof -iTCP:"$CONTROLLER_PORT" -sTCP:LISTEN -t 2>/dev/null | grep -q "$ORPHAN_PID"; then
  pass "orphan detected on port $CONTROLLER_PORT"
else
  fail "orphan not detected on port $CONTROLLER_PORT"
fi

# Kill it (simulate killOrphanNexuProcesses)
kill -9 "$ORPHAN_PID" 2>/dev/null || true
sleep 0.5

if ! is_pid_alive "$ORPHAN_PID"; then
  pass "orphan killed successfully"
else
  fail "orphan (pid=$ORPHAN_PID) survived SIGKILL"
fi

# Port should be free for fresh bootstrap
if ! lsof -iTCP:"$CONTROLLER_PORT" -sTCP:LISTEN -P -n &>/dev/null; then
  pass "port $CONTROLLER_PORT free after orphan cleanup"
else
  fail "port $CONTROLLER_PORT still occupied after orphan cleanup"
fi

# ---------------------------------------------------------------------------
# Phase 5: Re-bootstrap after cleanup (simulates next app launch)
# ---------------------------------------------------------------------------

echo ""
echo "--- Phase 5: Re-bootstrap after cleanup ---"

launchctl bootstrap "$DOMAIN" "$PLIST_DIR/$CONTROLLER_LABEL.plist"
launchctl kickstart "$DOMAIN/$CONTROLLER_LABEL"
sleep 2

CONTROLLER_PID="$(get_service_pid "$CONTROLLER_LABEL")"
if [ -n "$CONTROLLER_PID" ] && is_pid_alive "$CONTROLLER_PID"; then
  pass "controller re-bootstrapped successfully after cleanup (pid=$CONTROLLER_PID)"
else
  fail "controller failed to re-bootstrap"
fi

if wait_for_port "$CONTROLLER_PORT" 20; then
  pass "controller port $CONTROLLER_PORT listening after re-bootstrap"
else
  fail "controller port $CONTROLLER_PORT not listening after re-bootstrap"
fi

# ---------------------------------------------------------------------------
# Phase 6: NEXU_HOME with spaces in path
# ---------------------------------------------------------------------------

echo ""
echo "--- Phase 6: NEXU_HOME with spaces ---"

# Bootout from Phase 5
launchctl bootout "$DOMAIN/$CONTROLLER_LABEL" 2>/dev/null || true
sleep 1

SPACE_LABEL="${CONTROLLER_LABEL}.spaces"
SPACE_HOME="$PLIST_DIR/nexu home dir"
mkdir -p "$SPACE_HOME"

# Script that writes probe file to NEXU_HOME
cat > "$PLIST_DIR/check-spaces.cjs" << 'CHECKEOF'
const fs = require("node:fs");
const home = process.env.NEXU_HOME;
try { fs.mkdirSync(home, { recursive: true }); } catch {}
fs.writeFileSync(home + "/probe.txt", "ok");
setTimeout(() => process.exit(0), 30000);
CHECKEOF

cat > "$PLIST_DIR/$SPACE_LABEL.plist" << SPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$SPACE_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$PLIST_DIR/check-spaces.cjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NEXU_HOME</key>
        <string>$SPACE_HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/spaces-out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/spaces-err.log</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
SPLIST

launchctl bootstrap "$DOMAIN" "$PLIST_DIR/$SPACE_LABEL.plist"
launchctl kickstart "$DOMAIN/$SPACE_LABEL"
sleep 3

if [ -f "$SPACE_HOME/probe.txt" ] && [ "$(cat "$SPACE_HOME/probe.txt")" = "ok" ]; then
  pass "NEXU_HOME with spaces: process wrote probe file correctly"
else
  fail "NEXU_HOME with spaces: probe file not found (home=$SPACE_HOME)"
  echo "  stderr: $(cat "$LOG_DIR/spaces-err.log" 2>/dev/null | head -3)"
  echo "  stdout: $(cat "$LOG_DIR/spaces-out.log" 2>/dev/null | head -3)"
  echo "  plist NEXU_HOME: $(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:NEXU_HOME' "$PLIST_DIR/$SPACE_LABEL.plist" 2>/dev/null)"
fi

launchctl bootout "$DOMAIN/$SPACE_LABEL" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Phase 7: NEXU_HOME with Chinese characters
# ---------------------------------------------------------------------------

echo ""
echo "--- Phase 7: NEXU_HOME with unicode ---"

UNICODE_LABEL="${CONTROLLER_LABEL}.unicode"
UNICODE_HOME="$PLIST_DIR/用户配置"
mkdir -p "$UNICODE_HOME"

cat > "$PLIST_DIR/check-unicode.cjs" << 'CHECKEOF'
const fs = require("node:fs");
const home = process.env.NEXU_HOME;
try { fs.mkdirSync(home, { recursive: true }); } catch {}
fs.writeFileSync(home + "/ok.txt", "good");
setTimeout(() => process.exit(0), 30000);
CHECKEOF

cat > "$PLIST_DIR/$UNICODE_LABEL.plist" << UPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$UNICODE_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$PLIST_DIR/check-unicode.cjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NEXU_HOME</key>
        <string>$UNICODE_HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/unicode-out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/unicode-err.log</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
UPLIST

launchctl bootstrap "$DOMAIN" "$PLIST_DIR/$UNICODE_LABEL.plist"
launchctl kickstart "$DOMAIN/$UNICODE_LABEL"
sleep 3

if [ -f "$UNICODE_HOME/ok.txt" ] && [ "$(cat "$UNICODE_HOME/ok.txt")" = "good" ]; then
  pass "NEXU_HOME with unicode: process wrote probe file correctly"
else
  fail "NEXU_HOME with unicode: probe file not found (home=$UNICODE_HOME)"
  echo "  stderr: $(cat "$LOG_DIR/unicode-err.log" 2>/dev/null | head -3)"
  echo "  stdout: $(cat "$LOG_DIR/unicode-out.log" 2>/dev/null | head -3)"
fi

launchctl bootout "$DOMAIN/$UNICODE_LABEL" 2>/dev/null || true

echo ""
echo "--- Done ---"
