#!/usr/bin/env bash

set -u
set -o pipefail

release_dir="${PACKAGED_RELEASE_DIR:-${NEXU_DESKTOP_RELEASE_DIR:-apps/desktop/release}}"
capture_dir="${NEXU_DESKTOP_CHECK_CAPTURE_DIR:-.tmp/desktop-ci-test}"
tmp_dir="${NEXU_DESKTOP_CHECK_TMPDIR:-${TMPDIR:-/tmp}/desktop-tmp}"
packaged_home="${PACKAGED_HOME:-.tmp/desktop-dist-home}"
packaged_logs_dir="${PACKAGED_LOGS_DIR:-$packaged_home/Library/Logs/Nexu Desktop}"
packaged_user_data_dir="${PACKAGED_USER_DATA_DIR:-$packaged_home/Library/Application Support/Nexu Desktop}"
packaged_runtime_logs_dir="${PACKAGED_RUNTIME_LOGS_DIR:-$packaged_home/Library/Application Support/logs/runtime-units}"
default_logs_dir="${DEFAULT_LOGS_DIR:-$HOME/Library/Logs/Nexu Desktop}"
default_user_data_dir="${DEFAULT_USER_DATA_DIR:-$HOME/Library/Application Support/@nexu/desktop}"
default_runtime_logs_dir="${DEFAULT_RUNTIME_LOGS_DIR:-$HOME/Library/Application Support/logs/runtime-units}"

if [ -n "${PACKAGED_APP:-}" ]; then
  packaged_app="$PACKAGED_APP"
elif [ -d "$release_dir/Nexu.app" ]; then
  packaged_app="$release_dir/Nexu.app"
else
  shopt -s nullglob
  app_candidates=("$release_dir"/*/Nexu.app)
  shopt -u nullglob

  if [ "${#app_candidates[@]}" -eq 0 ]; then
    echo "Unable to locate packaged app under $release_dir" >&2
    exit 1
  fi

  packaged_app="${app_candidates[0]}"
fi

packaged_executable="${PACKAGED_EXECUTABLE:-$packaged_app/Contents/MacOS/Nexu}"

packaged_log_path="$capture_dir/packaged-app.log"
pid_path="$capture_dir/packaged-app.pid"
app_pid=""
exit_code=0

if [ ! -x "$packaged_executable" ]; then
  echo "Packaged executable is missing or not executable: $packaged_executable" >&2
  exit 1
fi

cleanup() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
    return
  fi

  if [ -f "$pid_path" ]; then
    local recorded_pid
    recorded_pid="$(cat "$pid_path")"
    if [ -n "$recorded_pid" ] && kill -0 "$recorded_pid" 2>/dev/null; then
      kill "$recorded_pid" 2>/dev/null || true
      wait "$recorded_pid" 2>/dev/null || true
    fi
  fi
}

trap 'cleanup' EXIT

mkdir -p "$capture_dir" "$packaged_home" "$tmp_dir"

export PACKAGED_HOME="$packaged_home"
export PACKAGED_APP="$packaged_app"
export PACKAGED_EXECUTABLE="$packaged_executable"
export PACKAGED_LOGS_DIR="$packaged_logs_dir"
export PACKAGED_USER_DATA_DIR="$packaged_user_data_dir"
export PACKAGED_RUNTIME_LOGS_DIR="$packaged_runtime_logs_dir"
export DEFAULT_LOGS_DIR="$default_logs_dir"
export DEFAULT_USER_DATA_DIR="$default_user_data_dir"
export DEFAULT_RUNTIME_LOGS_DIR="$default_runtime_logs_dir"
export NEXU_DESKTOP_PACKAGED_PID_PATH="$pid_path"

HOME="$packaged_home" TMPDIR="$tmp_dir" "$packaged_executable" \
  > "$packaged_log_path" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" > "$pid_path"
echo "Launched packaged app pid=$app_pid"

node scripts/desktop-ci-check.mjs dist --capture-dir "$capture_dir"
exit_code=$?

exit "$exit_code"
