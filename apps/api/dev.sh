#!/usr/bin/env bash
set -euo pipefail

parent_pid="$PPID"

node_args=(--watch --import tsx dist/index.js)

if [[ -n "${DD_ENV:-}" ]]; then
  node_args=(--watch --import dd-trace/initialize.mjs --import tsx dist/index.js)
fi

pnpm exec tsc -p tsconfig.build.json -w &
tsc_pid=$!

DD_TRACE_PRELOADED="${DD_TRACE_PRELOADED:-false}"
if [[ -n "${DD_ENV:-}" ]]; then
  DD_TRACE_PRELOADED="true"
fi

NODE_OPTIONS=--conditions=development DD_TRACE_PRELOADED="$DD_TRACE_PRELOADED" node "${node_args[@]}" &
node_pid=$!

# Kill a process and its entire process group
kill_tree() {
  local pid=$1
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
}

cleanup() {
  kill_tree "$node_pid"
  kill_tree "$tsc_pid"
  lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
}

trap cleanup EXIT INT TERM

(
  while kill -0 "$parent_pid" 2>/dev/null && kill -0 "$node_pid" 2>/dev/null; do
    sleep 1
  done

  kill_tree "$node_pid"
  kill_tree "$tsc_pid"
) &
watchdog_pid=$!

wait "$node_pid"
kill "$watchdog_pid" 2>/dev/null || true
