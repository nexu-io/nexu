#!/usr/bin/env bash

set -u
set -o pipefail

capture_dir="${NEXU_DESKTOP_CHECK_CAPTURE_DIR:-.tmp/desktop-ci-test}"
exit_code=0

for command in \
  "pnpm dev start openclaw" \
  "pnpm dev start controller" \
  "pnpm dev start web" \
  "pnpm dev start desktop"
do
  sh -lc "$command"
  exit_code=$?

  if [ "$exit_code" -ne 0 ]; then
    break
  fi
done

if [ "$exit_code" -eq 0 ]; then
  node scripts/desktop-ci-check.mjs dev --capture-dir "$capture_dir"
  exit_code=$?
fi

stop_code=0
for command in \
  "pnpm dev stop desktop" \
  "pnpm dev stop web" \
  "pnpm dev stop controller" \
  "pnpm dev stop openclaw"
do
  sh -lc "$command"
  current_stop_code=$?
  if [ "$stop_code" -eq 0 ] && [ "$current_stop_code" -ne 0 ]; then
    stop_code=$current_stop_code
  fi
done

if [ "$exit_code" -eq 0 ] && [ "$stop_code" -ne 0 ]; then
  exit_code=$stop_code
fi

exit "$exit_code"
