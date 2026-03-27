#!/usr/bin/env bash

set -euo pipefail

release_dir="${PACKAGED_RELEASE_DIR:-${NEXU_DESKTOP_RELEASE_DIR:-apps/desktop/release}}"
packaged_home="${PACKAGED_HOME:-.tmp/desktop-dist-home}"
tmp_dir="${NEXU_DESKTOP_CHECK_TMPDIR:-${TMPDIR:-/tmp}/desktop-tmp}"
require_spctl="${NEXU_DESKTOP_REQUIRE_SPCTL:-0}"
require_codesign="${NEXU_DESKTOP_REQUIRE_CODESIGN:-$require_spctl}"

absolutize_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$PWD/$1" ;;
  esac
}

packaged_home="$(absolutize_path "$packaged_home")"
tmp_dir="$(absolutize_path "$tmp_dir")"

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

packaged_app="$(absolutize_path "$packaged_app")"
packaged_executable="${PACKAGED_EXECUTABLE:-$packaged_app/Contents/MacOS/Nexu}"
runner_app="${NEXU_DESKTOP_EXTRACTED_RUNNER_APP:-$packaged_home/.nexu/runtime/nexu-runner.app}"
runner_executable="${NEXU_DESKTOP_EXTRACTED_RUNNER_EXECUTABLE:-$runner_app/Contents/MacOS/Nexu}"

runner_app="$(absolutize_path "$runner_app")"
runner_executable="$(absolutize_path "$runner_executable")"

verify_structure() {
  local label="$1"
  local app_path="$2"
  local executable_path="$3"
  local require_signature_artifacts="${4:-1}"

  echo "[runner-check] verifying $label structure: $app_path"
  test -d "$app_path"
  test -f "$app_path/Contents/Info.plist"
  test -d "$app_path/Contents/Frameworks"
  test -d "$app_path/Contents/Resources"
  if [ "$require_signature_artifacts" = "1" ]; then
    test -f "$app_path/Contents/_CodeSignature/CodeResources"
  fi
  test -x "$executable_path"
}

verify_codesign() {
  local label="$1"
  local target_path="$2"

  echo "[runner-check] codesign verify: $label"
  /usr/bin/codesign --verify --deep --strict --verbose=4 "$target_path"
}

verify_spctl() {
  local label="$1"
  local target_path="$2"

  if [ "$require_spctl" != "1" ]; then
    echo "[runner-check] skipping spctl assess for $label"
    return 0
  fi

  echo "[runner-check] spctl assess: $label"
  /usr/sbin/spctl --assess --type execute -vv "$target_path"
}

verify_structure "packaged app" "$packaged_app" "$packaged_executable" "$require_codesign"

# The runner is normally extracted during launchd bootstrap, which does not
# run in CI (check:dist uses orchestrator mode).  Extract it explicitly so
# we can verify the bundle integrity.
if [ ! -d "$runner_app" ]; then
  echo "[runner-check] extracted runner not found, triggering extraction"
  app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$packaged_app/Contents/Info.plist" 2>/dev/null || echo "unknown")"
  nexu_home="$packaged_home/.nexu"
  mkdir -p "$nexu_home/runtime"
  echo "[runner-check] cloning $packaged_app → $runner_app (version=$app_version)"
  cp -Rc "$packaged_app" "$runner_app"
  echo "$app_version" > "$nexu_home/runtime/.nexu-runner-version"
  echo "[runner-check] extraction complete"
fi

verify_structure "extracted runner" "$runner_app" "$runner_executable" "$require_codesign"

if [ "$require_codesign" = "1" ]; then
  verify_codesign "packaged app" "$packaged_app"
  verify_codesign "extracted runner" "$runner_app"
else
  echo "[runner-check] skipping codesign verify for unsigned build artifacts"
fi

verify_spctl "packaged app" "$packaged_app"
verify_spctl "extracted runner" "$runner_app"

echo "[runner-check] smoke running extracted runner"
# Use a temp script file instead of -e to avoid Electron's internal
# ../package.json lookup that fires in eval mode and fails when cwd
# is inside the .app bundle.
smoke_script="$tmp_dir/nexu-runner-smoke.js"
mkdir -p "$tmp_dir"
printf 'process.stdout.write("nexu-runner-smoke-ok\\n");\n' > "$smoke_script"
output="$({
  HOME="$packaged_home" TMPDIR="$tmp_dir" ELECTRON_RUN_AS_NODE=1 "$runner_executable" "$smoke_script"
} 2>&1)"
rm -f "$smoke_script"
printf '%s\n' "$output"

if [[ "$output" != *"nexu-runner-smoke-ok"* ]]; then
  echo "[runner-check] extracted runner smoke output missing success marker" >&2
  exit 1
fi

echo "[runner-check] extracted runner verification passed"
