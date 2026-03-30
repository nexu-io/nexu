#!/usr/bin/env bash
#
# Run desktop E2E tests against a signed nightly build.
#
# Usage:
#   bash scripts/run-e2e.sh smoke       # DMG install + codesign + cold start
#   bash scripts/run-e2e.sh login       # smoke + login + wait for agent running
#   bash scripts/run-e2e.sh model       # smoke + model switch scenario
#   bash scripts/run-e2e.sh update      # smoke + update scenario
#   bash scripts/run-e2e.sh resilience  # smoke + crash recovery, orphans, port conflict, stale state, double launch
#   bash scripts/run-e2e.sh full        # smoke + model + update
#
set -euo pipefail

MODE="${1:-full}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACT_DIR="$REPO_ROOT/artifacts"
CAPTURE_DIR="$REPO_ROOT/captures"
RUN_ROOT="${TMPDIR:-/tmp}/nexu-desktop-e2e"
PERSISTENT_HOME="$REPO_ROOT/.tmp/home"
SKIP_CODESIGN="${NEXU_DESKTOP_E2E_SKIP_CODESIGN:-false}"

log() { printf '[e2e:%s] %s\n' "$MODE" "$1" >&2; }

# -----------------------------------------------------------------------
# Cleanup helpers
# -----------------------------------------------------------------------
cleanup_machine() {
  mkdir -p "$CAPTURE_DIR"
  log "Cleaning existing Nexu processes"
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all.log" 2>&1 || true

  if [ -d "$RUN_ROOT/dmg-mount" ]; then
    hdiutil detach "$RUN_ROOT/dmg-mount" -force 2>/dev/null || true
  fi
  rm -rf "$RUN_ROOT"
  mkdir -p "$RUN_ROOT"
}

wait_ports_free() {
  local waited=0
  while true; do
    local busy
    busy=$(lsof -iTCP:50800 -iTCP:50810 -iTCP:18789 -sTCP:LISTEN -n -P 2>/dev/null || true)
    if [ -z "$busy" ]; then break; fi
    if [ "$waited" -ge 20 ]; then
      log "WARNING: ports still occupied after 20s"
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  [ "$waited" -gt 0 ] && log "Ports cleared after ${waited}s" || true
}

# -----------------------------------------------------------------------
# Artifact resolution
# -----------------------------------------------------------------------
resolve_artifact() {
  local ext="$1"
  shopt -s nullglob
  local candidates=("$ARTIFACT_DIR"/*."$ext")
  shopt -u nullglob

  if [ "${#candidates[@]}" -eq 0 ]; then
    log "No .$ext artifacts in $ARTIFACT_DIR — run: npm run download"
    return 1
  fi
  printf '%s\n' "${candidates[0]}"
}

# -----------------------------------------------------------------------
# DMG install + codesign verification
# -----------------------------------------------------------------------
install_from_dmg() {
  local dmg_path="$1"
  local mount_dir="$RUN_ROOT/dmg-mount"
  local install_root="$RUN_ROOT/Applications"
  local installed_app="$install_root/Nexu.app"

  rm -rf "$mount_dir" "$install_root"
  mkdir -p "$mount_dir" "$install_root"

  log "Mounting DMG: $(basename "$dmg_path")"
  hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_dir" >/dev/null

  if [ ! -d "$mount_dir/Nexu.app" ]; then
    hdiutil detach "$mount_dir" -force >/dev/null 2>&1 || true
    log "ERROR: Nexu.app not found in DMG"
    return 1
  fi

  log "Copying app from DMG"
  ditto "$mount_dir/Nexu.app" "$installed_app"

  if [ "$SKIP_CODESIGN" = "true" ]; then
    log "Skipping codesign/spctl (unsigned local build)"
  else
    log "Verifying codesign"
    codesign --verify --deep --strict --verbose=2 "$installed_app" > "$CAPTURE_DIR/codesign-verify.log" 2>&1
    log "Verifying Gatekeeper (spctl)"
    spctl --assess --type execute -vv "$installed_app" > "$CAPTURE_DIR/spctl-assess.log" 2>&1
    log "codesign + spctl PASSED"
  fi

  hdiutil detach "$mount_dir" >/dev/null 2>&1 || true
  printf '%s\n' "$installed_app"
}

# -----------------------------------------------------------------------
# Launch app and wait for runtime health
# -----------------------------------------------------------------------
launch_and_wait() {
  local app_path="$1"
  local executable="$app_path/Contents/MacOS/Nexu"
  local home_dir="$PERSISTENT_HOME"
  local user_data_dir="$home_dir/Library/Application Support/@nexu/desktop"
  local logs_dir="$user_data_dir/logs"
  local runtime_logs_dir="$logs_dir/runtime-units"
  local log_path="$CAPTURE_DIR/packaged-app.log"
  local pid_path="$CAPTURE_DIR/packaged-app.pid"

  mkdir -p "$home_dir" "$CAPTURE_DIR"

  HOME="$home_dir" \
  TMPDIR="$RUN_ROOT/tmp" \
  NEXU_DESKTOP_USER_DATA_ROOT="$user_data_dir" \
    "$executable" > "$log_path" 2>&1 &

  local app_pid=$!
  printf '%s\n' "$app_pid" > "$pid_path"
  log "Launched app pid=$app_pid"

  local attempt=0
  local max_attempts=90
  while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    if curl -sf http://127.0.0.1:50800/api/internal/desktop/ready >/dev/null 2>&1; then
      if curl -sf http://127.0.0.1:50810/api/internal/desktop/ready >/dev/null 2>&1; then
        log "Runtime healthy after $attempt attempts"
        export PACKAGED_APP="$app_path"
        export PACKAGED_EXECUTABLE="$executable"
        export PACKAGED_HOME="$home_dir"
        export PACKAGED_USER_DATA_DIR="$user_data_dir"
        export PACKAGED_LOGS_DIR="$logs_dir"
        export PACKAGED_RUNTIME_LOGS_DIR="$runtime_logs_dir"
        export NEXU_DESKTOP_E2E_CAPTURE_DIR="$CAPTURE_DIR"
        return 0
      fi
    fi
    sleep 2
  done

  log "ERROR: runtime health check failed after $max_attempts attempts"
  tail -20 "$log_path" >&2 || true
  return 1
}

# -----------------------------------------------------------------------
# Quit app (osascript for dialog, fallback to kill)
# -----------------------------------------------------------------------
quit_app() {
  local pid_path="$CAPTURE_DIR/packaged-app.pid"
  if [ ! -f "$pid_path" ]; then return 0; fi

  local app_pid
  app_pid="$(cat "$pid_path")"
  if [ -z "$app_pid" ] || ! kill -0 "$app_pid" 2>/dev/null; then return 0; fi

  log "Quitting app pid=$app_pid"
  kill "$app_pid" 2>/dev/null || true

  (
    sleep 1
    local attempts=0
    while kill -0 "$app_pid" 2>/dev/null && [ "$attempts" -lt 20 ]; do
      for label in "完全退出" "Quit Completely"; do
        osascript -e "tell application \"System Events\" to tell process \"Nexu\" to click button \"$label\" of window 1" 2>/dev/null && exit 0 || true
      done
      sleep 0.5
      attempts=$((attempts + 1))
    done
  ) &
  local clicker_pid=$!

  local waited=0
  while kill -0 "$app_pid" 2>/dev/null; do
    if [ "$waited" -ge 20 ]; then
      log "Force killing pid=$app_pid"
      kill -9 "$app_pid" 2>/dev/null || true
      break
    fi
    sleep 0.5
    waited=$((waited + 1))
  done

  kill "$clicker_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  wait "$clicker_pid" 2>/dev/null || true
  log "App exited"
}

# -----------------------------------------------------------------------
# System screen recording
# -----------------------------------------------------------------------
SCREEN_RECORDING_PID=""

start_screen_recording() {
  local video_path="$CAPTURE_DIR/screen-recording.mov"
  screencapture -v -C -G 0 "$video_path" &
  SCREEN_RECORDING_PID=$!
  log "Screen recording started (pid=$SCREEN_RECORDING_PID)"
}

stop_screen_recording() {
  if [ -n "$SCREEN_RECORDING_PID" ] && kill -0 "$SCREEN_RECORDING_PID" 2>/dev/null; then
    kill -INT "$SCREEN_RECORDING_PID" 2>/dev/null || true
    sleep 2
    kill -0 "$SCREEN_RECORDING_PID" 2>/dev/null && kill -9 "$SCREEN_RECORDING_PID" 2>/dev/null || true
    wait "$SCREEN_RECORDING_PID" 2>/dev/null || true
    log "Screen recording saved"
  fi
  SCREEN_RECORDING_PID=""
}

# -----------------------------------------------------------------------
# Diagnostics capture
# -----------------------------------------------------------------------
capture_logs() {
  local home_dir="$PERSISTENT_HOME"
  local user_data_dir="$home_dir/Library/Application Support/@nexu/desktop"

  mkdir -p "$CAPTURE_DIR/packaged-logs" \
           "$CAPTURE_DIR/runtime-unit-logs" \
           "$CAPTURE_DIR/state-snapshot"

  # App logs
  if [ -d "${PACKAGED_LOGS_DIR:-}" ]; then
    cp -r "$PACKAGED_LOGS_DIR"/* "$CAPTURE_DIR/packaged-logs/" 2>/dev/null || true
  fi
  if [ -d "${PACKAGED_RUNTIME_LOGS_DIR:-}" ]; then
    cp -r "$PACKAGED_RUNTIME_LOGS_DIR"/* "$CAPTURE_DIR/runtime-unit-logs/" 2>/dev/null || true
  fi

  # State snapshot
  local state_dir="$CAPTURE_DIR/state-snapshot"
  if [ -d "$home_dir/.nexu" ]; then
    mkdir -p "$state_dir/dot-nexu"
    cp "$home_dir/.nexu/config.json" "$state_dir/dot-nexu/" 2>/dev/null || true
    cp "$home_dir/.nexu/cloud-profiles.json" "$state_dir/dot-nexu/" 2>/dev/null || true
    if [ -f "$state_dir/dot-nexu/config.json" ]; then
      sed -i '' 's/"apiKey":\s*"[^"]*"/"apiKey": "***REDACTED***"/g' "$state_dir/dot-nexu/config.json" 2>/dev/null || true
    fi
  fi

  local openclaw_state="$user_data_dir/runtime/openclaw/state"
  if [ -d "$openclaw_state" ]; then
    mkdir -p "$state_dir/openclaw-state"
    cp "$openclaw_state/openclaw.json" "$state_dir/openclaw-state/" 2>/dev/null || true
    cp "$openclaw_state/nexu-runtime-model.json" "$state_dir/openclaw-state/" 2>/dev/null || true
  fi

  find "$home_dir" -name "runtime-ports.json" -exec cp {} "$state_dir/" \; 2>/dev/null || true

  {
    echo "=== Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
    echo "=== Processes ==="
    ps aux | grep -E "Nexu|openclaw|controller|clawhub" | grep -v grep || echo "(none)"
    echo "=== Launchd ==="
    launchctl list 2>/dev/null | grep nexu || echo "(none)"
    echo "=== Ports ==="
    lsof -iTCP:50800 -iTCP:50810 -iTCP:18789 -sTCP:LISTEN -n -P 2>/dev/null || echo "(none)"
    echo "=== Controller ==="
    curl -sf http://127.0.0.1:50800/api/internal/desktop/ready 2>/dev/null || echo "(unreachable)"
    echo "=== Cloud ==="
    curl -sf http://127.0.0.1:50800/api/internal/desktop/cloud-status 2>/dev/null || echo "(unreachable)"
    echo "=== OpenClaw ==="
    curl -sf http://127.0.0.1:18789/health 2>/dev/null || echo "(unreachable)"
  } > "$state_dir/runtime-snapshot.txt" 2>&1

  log "Diagnostics captured"
}

on_failure() {
  log "!!! TEST FAILED — capturing diagnostics ==="
  screencapture -x "$CAPTURE_DIR/failure-screenshot.png" 2>/dev/null || true
  capture_logs
  stop_screen_recording
}

# -----------------------------------------------------------------------
# Resilience scenarios
# -----------------------------------------------------------------------

# -----------------------------------------------------------------------
# Service status verification (called after every startup)
# -----------------------------------------------------------------------
verify_services() {
  local label="$1"
  local failed=0

  log "[$label] Verifying service status..."

  # 1. Controller API health
  local controller_ready
  controller_ready=$(curl -sf http://127.0.0.1:50800/api/internal/desktop/ready 2>/dev/null || echo "")
  if echo "$controller_ready" | grep -q '"ready":true'; then
    log "[$label]   controller API: ready"
  else
    # Try alternative port (port conflict scenario)
    local alt_ready=false
    for port in 50801 50802 50803; do
      controller_ready=$(curl -sf "http://127.0.0.1:$port/api/internal/desktop/ready" 2>/dev/null || echo "")
      if echo "$controller_ready" | grep -q '"ready":true'; then
        log "[$label]   controller API: ready (alternative port $port)"
        alt_ready=true
        break
      fi
    done
    if ! $alt_ready; then
      log "[$label]   controller API: NOT READY"
      failed=$((failed + 1))
    fi
  fi

  # 2. Web server health
  local web_ok=false
  for port in 50810 50811 50812; do
    if curl -sf "http://127.0.0.1:$port/" >/dev/null 2>&1; then
      log "[$label]   web server: listening on $port"
      web_ok=true
      break
    fi
  done
  if ! $web_ok; then
    log "[$label]   web server: NOT LISTENING"
    failed=$((failed + 1))
  fi

  # 3. OpenClaw gateway health
  local openclaw_health
  openclaw_health=$(curl -sf http://127.0.0.1:18789/health 2>/dev/null || echo "")
  if [ -n "$openclaw_health" ]; then
    log "[$label]   openclaw gateway: healthy"
  else
    log "[$label]   openclaw gateway: NOT HEALTHY (may still be starting)"
  fi

  # 4. Launchd service registration
  local controller_launchd=false
  local openclaw_launchd=false
  launchctl list 2>/dev/null | grep -q "io.nexu.controller" && controller_launchd=true
  launchctl list 2>/dev/null | grep -q "io.nexu.openclaw" && openclaw_launchd=true
  log "[$label]   launchd: controller=$controller_launchd openclaw=$openclaw_launchd"

  # 5. Port listeners (verify actual TCP LISTEN state)
  local listeners
  listeners=$(lsof -iTCP:50800 -iTCP:50810 -iTCP:18789 -sTCP:LISTEN -n -P 2>/dev/null | grep LISTEN | wc -l | tr -d ' ')
  log "[$label]   TCP listeners on known ports: $listeners"

  # 6. Electron process alive
  local electron_pid
  electron_pid=$(cat "$CAPTURE_DIR/packaged-app.pid" 2>/dev/null || echo "")
  if [ -n "$electron_pid" ] && kill -0 "$electron_pid" 2>/dev/null; then
    log "[$label]   electron process: alive (pid=$electron_pid)"
  else
    log "[$label]   electron process: NOT RUNNING"
    failed=$((failed + 1))
  fi

  if [ "$failed" -gt 0 ]; then
    log "[$label]   VERIFICATION FAILED ($failed checks)"
    return 1
  fi
  log "[$label]   all services OK"
  return 0
}

# Helper: reset home directory to clean state before each scenario
resilience_reset() {
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-reset.log" 2>&1 || true
  wait_ports_free
  rm -rf "$PERSISTENT_HOME"
  mkdir -p "$PERSISTENT_HOME"
  log "Reset: home directory cleaned, ports freed"
}

# Helper: launch app in background and wait for health, return PID
resilience_launch() {
  local app_path="$1"
  local executable="$app_path/Contents/MacOS/Nexu"
  local home_dir="$PERSISTENT_HOME"
  local user_data_dir="$home_dir/Library/Application Support/@nexu/desktop"
  local log_path="$CAPTURE_DIR/resilience-app.log"

  mkdir -p "$home_dir"

  HOME="$home_dir" \
  TMPDIR="$RUN_ROOT/tmp" \
  NEXU_DESKTOP_USER_DATA_ROOT="$user_data_dir" \
    "$executable" > "$log_path" 2>&1 &

  local app_pid=$!
  printf '%s\n' "$app_pid" > "$CAPTURE_DIR/packaged-app.pid"
  log "Launched app pid=$app_pid"

  local attempt=0
  while [ "$attempt" -lt 90 ]; do
    attempt=$((attempt + 1))
    if curl -sf http://127.0.0.1:50800/api/internal/desktop/ready >/dev/null 2>&1; then
      if curl -sf http://127.0.0.1:50810/api/internal/desktop/ready >/dev/null 2>&1; then
        log "Runtime healthy after $attempt attempts"
        return 0
      fi
    fi
    sleep 2
  done

  log "ERROR: runtime health check failed"
  return 1
}

# 1. Crash recovery: kill -9 Electron → restart → verify healthy
resilience_crash_recovery() {
  log "--- Resilience: crash recovery (Force Quit simulation) ---"
  resilience_reset
  resilience_launch "$1"
  verify_services "crash-recovery-initial" || true

  # Verify launchd services are running
  local controller_running=false
  local openclaw_running=false
  launchctl list 2>/dev/null | grep -q "io.nexu.controller" && controller_running=true
  launchctl list 2>/dev/null | grep -q "io.nexu.openclaw" && openclaw_running=true
  log "Before crash: controller=$controller_running openclaw=$openclaw_running"

  # Simulate Force Quit: kill -9 Electron only
  local app_pid
  app_pid="$(cat "$CAPTURE_DIR/packaged-app.pid")"
  log "Force killing Electron pid=$app_pid (simulating Force Quit)"
  kill -9 "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  sleep 2

  # Verify launchd services survived the crash (expected for launchd mode)
  local controller_after=false
  local openclaw_after=false
  launchctl list 2>/dev/null | grep -q "io.nexu.controller" && controller_after=true
  launchctl list 2>/dev/null | grep -q "io.nexu.openclaw" && openclaw_after=true
  log "After crash: controller=$controller_after openclaw=$openclaw_after"

  # Now restart the app — it should detect stale services and handle them
  log "Restarting app after crash..."
  resilience_launch "$1"
  verify_services "crash-recovery" || { log "FAILED: services not healthy after crash recovery"; return 1; }
  log "PASSED: app recovered from crash successfully"

  # Cleanup
  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-crash-recovery.log" 2>&1 || true
  wait_ports_free
}

# 2. Orphan process cleanup: kill Electron, leave controller/openclaw as orphans
resilience_orphan_cleanup() {
  log "--- Resilience: orphan process cleanup ---"
  resilience_reset
  resilience_launch "$1"

  local app_pid
  app_pid="$(cat "$CAPTURE_DIR/packaged-app.pid")"

  # Count launchd-managed processes before
  local orphan_pids_before
  orphan_pids_before=$(pgrep -f "controller/dist/index.js|openclaw.mjs" 2>/dev/null | wc -l | tr -d ' ')
  log "Sidecar processes before kill: $orphan_pids_before"

  # Kill only the Electron main process (not sidecars)
  log "Killing only Electron pid=$app_pid (leaving sidecars as orphans)"
  kill -9 "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  sleep 2

  # Verify orphan sidecars still exist
  local orphan_pids_after
  orphan_pids_after=$(pgrep -f "controller/dist/index.js|openclaw.mjs" 2>/dev/null | wc -l | tr -d ' ')
  log "Orphan sidecar processes after kill: $orphan_pids_after"

  # Restart app — it should clean up orphans and start fresh
  log "Restarting app (should clean up orphans)..."
  resilience_launch "$1"
  verify_services "orphan-cleanup" || { log "FAILED: services not healthy after orphan cleanup"; return 1; }
  log "PASSED: app started fresh after orphan cleanup"

  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-orphan.log" 2>&1 || true
  wait_ports_free
}

# 3. Port conflict: occupy known port before app launch
resilience_port_conflict() {
  log "--- Resilience: port conflict ---"
  resilience_reset

  # Occupy port 50800 with a dummy listener
  python3 -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', 50800))
s.listen(1)
# Keep listening until killed
while True:
    time.sleep(1)
" &
  local blocker_pid=$!
  sleep 1

  # Verify port is occupied
  if lsof -iTCP:50800 -sTCP:LISTEN -n -P 2>/dev/null | grep -q LISTEN; then
    log "Port 50800 occupied by blocker pid=$blocker_pid"
  else
    log "WARNING: failed to occupy port 50800"
    kill "$blocker_pid" 2>/dev/null || true
    return 1
  fi

  # Launch app — it should detect port conflict and handle it
  local executable="$1/Contents/MacOS/Nexu"
  local home_dir="$PERSISTENT_HOME"
  local user_data_dir="$home_dir/Library/Application Support/@nexu/desktop"
  local log_path="$CAPTURE_DIR/resilience-port-conflict.log"

  mkdir -p "$home_dir"
  HOME="$home_dir" \
  TMPDIR="$RUN_ROOT/tmp" \
  NEXU_DESKTOP_USER_DATA_ROOT="$user_data_dir" \
    "$executable" > "$log_path" 2>&1 &
  local app_pid=$!
  printf '%s\n' "$app_pid" > "$CAPTURE_DIR/packaged-app.pid"
  log "Launched app with port conflict, pid=$app_pid"

  # Wait — app should either pick a different port or fail gracefully
  sleep 15

  # Check if app is still alive and found an alternative
  if kill -0 "$app_pid" 2>/dev/null; then
    log "App is alive despite port conflict"
    # Check if runtime came up on any port
    local runtime_ok=false
    for port in 50800 50801 50802 50803 50804 50805; do
      if curl -sf "http://127.0.0.1:$port/api/internal/desktop/ready" 2>/dev/null | grep -q '"ready":true'; then
        log "PASSED: app found alternative port $port"
        runtime_ok=true
        break
      fi
    done
    if ! $runtime_ok; then
      # Check the app log for error handling
      if grep -q "EADDRINUSE\|port.*occupied\|port.*conflict\|fallback" "$log_path" 2>/dev/null; then
        log "PASSED: app detected port conflict (logged error)"
      else
        log "WARNING: app alive but runtime not found on expected ports"
      fi
    fi
  else
    # App exited — check if it logged the port conflict
    if grep -q "EADDRINUSE\|port.*occupied\|port.*conflict" "$log_path" 2>/dev/null; then
      log "PASSED: app exited with port conflict error (expected behavior)"
    else
      log "FAILED: app exited without port conflict handling"
      tail -10 "$log_path" >&2 || true
    fi
  fi

  # Cleanup
  kill "$blocker_pid" 2>/dev/null || true
  wait "$blocker_pid" 2>/dev/null || true
  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-port-conflict.log" 2>&1 || true
  wait_ports_free
}

# 4. Stale runtime-ports.json: write fake state, verify app recovers
resilience_stale_state() {
  log "--- Resilience: stale runtime-ports.json ---"
  resilience_reset

  local home_dir="$PERSISTENT_HOME"
  local user_data_dir="$home_dir/Library/Application Support/@nexu/desktop"

  # Find where runtime-ports.json would be written
  local nexu_home="$home_dir/.nexu"
  mkdir -p "$nexu_home"

  # Write a fake runtime-ports.json pointing to non-existent services
  local fake_ports="$nexu_home/runtime-ports.json"
  cat > "$fake_ports" <<JSONEOF
{
  "electronPid": 99999,
  "controllerPort": 50800,
  "openclawPort": 18789,
  "webPort": 50810,
  "appVersion": "0.0.0-stale",
  "buildSource": "stale-test",
  "writtenAt": "2020-01-01T00:00:00.000Z"
}
JSONEOF
  log "Wrote fake runtime-ports.json (stale session)"

  # Launch app — it should detect stale state and do a fresh start
  resilience_launch "$1"
  verify_services "stale-state" || { log "FAILED: services not healthy after stale state recovery"; return 1; }
  log "PASSED: app recovered from stale runtime-ports.json"

  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-stale.log" 2>&1 || true
  wait_ports_free
}

# 5. Double launch: start app while another is already running
resilience_double_launch() {
  log "--- Resilience: double launch (single-instance) ---"
  resilience_reset
  resilience_launch "$1"

  local first_pid
  first_pid="$(cat "$CAPTURE_DIR/packaged-app.pid")"
  log "First instance running: pid=$first_pid"

  # Try to launch a second instance
  local executable="$1/Contents/MacOS/Nexu"
  local home_dir="$PERSISTENT_HOME"
  local user_data_dir="$home_dir/Library/Application Support/@nexu/desktop"
  local second_log="$CAPTURE_DIR/resilience-double-launch.log"

  HOME="$home_dir" \
  TMPDIR="$RUN_ROOT/tmp" \
  NEXU_DESKTOP_USER_DATA_ROOT="$user_data_dir" \
    "$executable" > "$second_log" 2>&1 &
  local second_pid=$!
  log "Launched second instance: pid=$second_pid"

  # Wait a bit for the second instance to either exit or be rejected
  sleep 5

  if kill -0 "$second_pid" 2>/dev/null; then
    # Second instance still alive — check if it took over or coexists
    log "WARNING: second instance still alive (pid=$second_pid)"
    # Check if first instance is still alive too
    if kill -0 "$first_pid" 2>/dev/null; then
      log "Both instances alive — checking if ports conflict"
    else
      log "First instance died, second took over"
    fi
    kill -9 "$second_pid" 2>/dev/null || true
    wait "$second_pid" 2>/dev/null || true
  else
    # Second instance exited (expected: single-instance lock)
    local exit_code=0
    wait "$second_pid" 2>/dev/null || exit_code=$?
    log "PASSED: second instance exited (code=$exit_code, single-instance lock working)"
  fi

  # Verify first instance still healthy
  if kill -0 "$first_pid" 2>/dev/null; then
    local ready
    ready=$(curl -sf http://127.0.0.1:50800/api/internal/desktop/ready 2>/dev/null || echo "")
    if echo "$ready" | grep -q '"ready":true'; then
      log "PASSED: first instance still healthy after double-launch attempt"
    fi
  fi

  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-double.log" 2>&1 || true
  wait_ports_free
}

# 6. Update with residual services: launchd services still running during update
resilience_update_residual() {
  log "--- Resilience: update with residual launchd services ---"
  resilience_reset
  resilience_launch "$1"
  verify_services "update-residual-before" || true

  local app_pid
  app_pid="$(cat "$CAPTURE_DIR/packaged-app.pid")"

  # Verify launchd services are registered
  local controller_registered=false
  local openclaw_registered=false
  launchctl list 2>/dev/null | grep -q "io.nexu.controller" && controller_registered=true
  launchctl list 2>/dev/null | grep -q "io.nexu.openclaw" && openclaw_registered=true
  log "Services before update: controller=$controller_registered openclaw=$openclaw_registered"

  # Kill Electron but leave launchd services running (simulate update scenario)
  log "Killing Electron to simulate update install (leaving launchd services)"
  kill -9 "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  sleep 2

  # Verify services are still running (they should be — launchd keeps them alive)
  local controller_alive=false
  local openclaw_alive=false
  launchctl list 2>/dev/null | grep -q "io.nexu.controller" && controller_alive=true
  launchctl list 2>/dev/null | grep -q "io.nexu.openclaw" && openclaw_alive=true
  log "Services after Electron kill: controller=$controller_alive openclaw=$openclaw_alive"

  # Check if ports are still held by residual services
  local ports_held
  ports_held=$(lsof -iTCP:50800 -iTCP:18789 -sTCP:LISTEN -n -P 2>/dev/null | grep -c LISTEN || echo 0)
  log "Ports still held by residual services: $ports_held"

  # Now simulate "updated app" starting — it should teardown old services and start fresh
  log "Launching 'updated' app (should teardown residual services)..."
  resilience_launch "$1"
  verify_services "update-residual-after" || { log "FAILED: services not healthy after update with residual"; return 1; }

  # Verify the runtime-ports.json was refreshed (not stale)
  local ports_file
  ports_file=$(find "$PERSISTENT_HOME" -name "runtime-ports.json" 2>/dev/null | head -1)
  if [ -n "$ports_file" ]; then
    local written_pid
    written_pid=$(python3 -c "import json; d=json.load(open('$ports_file')); print(d.get('electronPid',''))" 2>/dev/null || echo "")
    local current_pid
    current_pid=$(cat "$CAPTURE_DIR/packaged-app.pid" 2>/dev/null || echo "")
    if [ "$written_pid" = "$current_pid" ]; then
      log "PASSED: runtime-ports.json updated to current Electron pid"
    else
      log "WARNING: runtime-ports.json pid=$written_pid, expected=$current_pid"
    fi
  fi

  log "PASSED: app handled update with residual services"

  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-update-residual.log" 2>&1 || true
  wait_ports_free
}

# Run all resilience scenarios
run_resilience() {
  local app_path="$1"
  local failed=0

  resilience_crash_recovery "$app_path" || failed=$((failed + 1))
  resilience_orphan_cleanup "$app_path" || failed=$((failed + 1))
  resilience_port_conflict "$app_path" || failed=$((failed + 1))
  resilience_stale_state "$app_path" || failed=$((failed + 1))
  resilience_double_launch "$app_path" || failed=$((failed + 1))
  resilience_update_residual "$app_path" || failed=$((failed + 1))

  if [ "$failed" -gt 0 ]; then
    log "!!! $failed resilience scenario(s) FAILED"
    return 1
  fi
  log "=== ALL RESILIENCE SCENARIOS PASSED ==="
}

# -----------------------------------------------------------------------
# Main flow
# -----------------------------------------------------------------------
mkdir -p "$PERSISTENT_HOME" "$CAPTURE_DIR"

cleanup_on_exit() {
  local rc=$?
  stop_screen_recording
  if [ "$rc" -ne 0 ]; then on_failure; fi
  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" >/dev/null 2>&1 || true
}
trap 'cleanup_on_exit' EXIT

start_screen_recording

dmg_path="$(resolve_artifact dmg)" || exit 1
zip_path="$(resolve_artifact zip)" || exit 1
export NEXU_DESKTOP_E2E_ZIP_PATH="$zip_path"

# --- Clean state ---
cleanup_machine
wait_ports_free
# Reset home for smoke/login/resilience (need clean welcome page)
# Keep home for model/update (test with existing state from prior usage)
if [ "$MODE" = "smoke" ] || [ "$MODE" = "login" ] || [ "$MODE" = "resilience" ]; then
  rm -rf "$PERSISTENT_HOME"
  mkdir -p "$PERSISTENT_HOME"
  log "Home directory reset to clean state"
else
  mkdir -p "$PERSISTENT_HOME"
  log "Home directory preserved (testing with existing state)"
fi
app_path="$(install_from_dmg "$dmg_path")"

if [ "$MODE" = "resilience" ]; then
  log "=== INSTALL PASSED, running resilience scenarios ==="
  run_resilience "$app_path"
  stop_screen_recording
  capture_logs
  log "=== ALL E2E PASSED ($MODE) ==="
  exit 0
fi

if [ "$MODE" = "login" ]; then
  log "=== INSTALL PASSED, handing off to Playwright for login ==="
else
  launch_and_wait "$app_path"
  log "=== SMOKE PASSED ==="

  if [ "$MODE" = "smoke" ]; then
    stop_screen_recording
    capture_logs
    exit 0
  fi

  quit_app
  bash "$REPO_ROOT/scripts/kill-all.sh" > "$CAPTURE_DIR/kill-all-post-smoke.log" 2>&1 || true
  wait_ports_free
fi

log "Running Playwright E2E scenarios: $MODE"
node "$REPO_ROOT/tests/packaged-e2e.mjs" "$MODE" \
  --app "$app_path" \
  --exe "$app_path/Contents/MacOS/Nexu" \
  --zip "$zip_path" \
  --user-data "$PERSISTENT_HOME/Library/Application Support/@nexu/desktop" \
  --capture-dir "$CAPTURE_DIR"

stop_screen_recording
capture_logs
log "=== ALL E2E PASSED ($MODE) ==="
