#!/usr/bin/env bash
set -uo pipefail

# ============================================================================
# Static Deploy — Cloudflare Pages via Wrangler
# Usage:
#   deploy.sh <project-slug> <directory> <agent-id> [chat-id] [thread-id] \
#     [message-ref] [account-id] [channel] [chat-type] [sender-ref]
#
# Flow:
#   First deploy:  validate → create_project → wrangler deploy → add_domain → record → output
#   Redeploy:      validate → create_project(skip) → wrangler deploy → add_domain(skip) → record → output
# ============================================================================

DOMAIN_SUFFIX="nexu.space"
CF_API="https://api.cloudflare.com/client/v4"
ACCOUNT_PATH=""
IS_NEW_PROJECT=false

SLUG=""
DIR=""
DEPLOY_DIR=""
FILES_TOTAL=0
FILES_UPLOADED=0
FILES_CACHED=0
DEPLOY_URL=""
STAGE_DIR=""
AGENT_ID=""
CHAT_ID_INPUT=""
THREAD_ID_INPUT=""
MESSAGE_REF_INPUT=""
ACCOUNT_ID_INPUT=""
CHANNEL_INPUT=""
CHAT_TYPE_INPUT=""
SENDER_REF_INPUT=""

# ============================================================================
# HELPERS
# ============================================================================

json_error() {
  printf '{"status":"error","message":"%s"}\n' "$1" >&1
  exit "${2:-1}"
}

json_success() {
  printf '{"status":"success","url":"%s","deployment_url":"%s","files_total":%d,"files_uploaded":%d,"files_cached":%d,"is_new_project":%s}\n' \
    "$1" "$2" "$3" "$4" "$5" "$6" >&1
  exit 0
}

resolve_api_context() {
  local context_file api_url
  context_file="$(resolve_context_file)" || return 1
  api_url=$(json_val 'd.apiUrl' "$context_file") || true
  if [[ -z "$api_url" || -z "${SKILL_API_TOKEN:-}" ]]; then
    return 1
  fi

  printf '%s\n' "$api_url"
}

resolve_artifact_chat_id() {
  local chat_id="$1"
  local chat_type="${2,,}"
  if [[ -z "$chat_id" ]]; then
    return 0
  fi

  case "$chat_type" in
    direct|dm)
      printf 'user:%s\n' "$chat_id"
      ;;
    group|channel|thread)
      printf 'channel:%s\n' "$chat_id"
      ;;
    *)
      return 1
      ;;
  esac
}

cf_api() {
  local method="$1" path="$2"
  shift 2
  curl -s -X "$method" \
    "${CF_API}${path}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@" 2>/dev/null
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# Extract a value from JSON using Node.js (jq is not available in all runtimes).
# Usage: json_val <js-expression> [file]   — expression receives parsed object as `d`.
#        If file is omitted, reads from stdin.
json_val() {
  local expr="$1" file="${2:-}"
  if [[ -n "$file" ]]; then
    node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const v=(${expr});process.stdout.write(String(v==null?'':v))}catch(e){}" "$file"
  else
    node -e "let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{try{const d=JSON.parse(b);const v=(${expr});process.stdout.write(String(v==null?'':v))}catch(e){}})"
  fi
}

cleanup() {
  if [[ -n "${STAGE_DIR:-}" && -d "${STAGE_DIR:-}" ]]; then
    rm -rf "$STAGE_DIR"
  fi
}

resolve_context_file() {
  local script_dir state_dir cwd_state
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if [[ -n "${OPENCLAW_STATE_DIR:-}" && -f "${OPENCLAW_STATE_DIR}/nexu-context.json" ]]; then
    echo "${OPENCLAW_STATE_DIR}/nexu-context.json"
    return 0
  fi

  state_dir="$(dirname "$(dirname "$(dirname "$script_dir")")")"
  if [[ -f "${state_dir}/nexu-context.json" ]]; then
    echo "${state_dir}/nexu-context.json"
    return 0
  fi

  cwd_state="$(pwd)/.openclaw/nexu-context.json"
  if [[ -f "$cwd_state" ]]; then
    echo "$cwd_state"
    return 0
  fi

  return 1
}

# Locate npx binary even when PATH is minimal (e.g. cloud agent runtimes).
# Search order: PATH → nvm → homebrew → /usr/local → /usr/bin
find_npx() {
  if have_cmd npx; then
    echo "npx"
    return 0
  fi

  # nvm: pick the newest installed version
  local nvm_bin
  nvm_bin=$(ls -d "$HOME/.nvm/versions/node"/*/bin 2>/dev/null | sort -V | tail -1)
  if [[ -n "$nvm_bin" && -x "${nvm_bin}/npx" ]]; then
    echo "${nvm_bin}/npx"
    return 0
  fi

  # Common system locations
  local p
  for p in /opt/homebrew/bin/npx /usr/local/bin/npx /usr/bin/npx; do
    if [[ -x "$p" ]]; then
      echo "$p"
      return 0
    fi
  done

  return 1
}

append_cache_headers() {
  local headers_file="$1"
  local marker_begin="# openclaw-static-deploy cache-busting (begin)"
  local marker_end="# openclaw-static-deploy cache-busting (end)"

  if [[ -f "$headers_file" ]] && grep -Fq "$marker_begin" "$headers_file"; then
    return 0
  fi

  {
    [[ -f "$headers_file" ]] && [[ -s "$headers_file" ]] && printf '\n'
    cat <<EOF
${marker_begin}
/
  Cache-Control: public, max-age=0, must-revalidate

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/*.css
  Cache-Control: public, max-age=0, must-revalidate

/*.js
  Cache-Control: public, max-age=0, must-revalidate
${marker_end}
EOF
  } >>"$headers_file"
}

# ============================================================================
# STEP 1: VALIDATE
# ============================================================================

step_validate() {
  SLUG="${1:-}"
  DIR="${2:-}"
  AGENT_ID="${3:-}"
  # chat-id: raw inbound chat identifier (for example Slack user/channel id).
  # chat-type determines whether Nexu should resolve it as user:<id> or channel:<id>.
  CHAT_ID_INPUT="${4:-}"
  THREAD_ID_INPUT="${5:-}"
  MESSAGE_REF_INPUT="${6:-}"
  ACCOUNT_ID_INPUT="${7:-}"
  CHANNEL_INPUT="${8:-slack}"
  CHAT_TYPE_INPUT="${9:-}"
  SENDER_REF_INPUT="${10:-}"

  if [[ -z "$SLUG" || -z "$DIR" || -z "$AGENT_ID" ]]; then
    json_error "Usage: deploy.sh <project-slug> <directory> <agent-id> [chat-id] [thread-id]" 1
  fi

  if [[ ! "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    json_error "Invalid slug: must be lowercase alphanumeric + hyphens, max 63 chars" 1
  fi

  if [[ ! -d "$DIR" ]]; then
    json_error "Directory not found: ${DIR}" 1
  fi

  local html_count
  html_count=$(find "$DIR" -name '*.html' -type f | wc -l | tr -d ' ')
  if [[ "$html_count" -eq 0 ]]; then
    json_error "No HTML files found in ${DIR}" 1
  fi

  # Fetch credentials from Nexu at runtime using SKILL_API_TOKEN.
  local context_file="" api_url="" pool_id=""
  context_file="$(resolve_context_file)" || true
  if [[ -z "$context_file" || -z "${SKILL_API_TOKEN:-}" ]]; then
    json_error "Missing runtime secret context for deploy credentials (nexu-context.json or SKILL_API_TOKEN)" 1
  fi

  api_url=$(json_val 'd.apiUrl' "$context_file") || true
  pool_id=$(json_val 'd.poolId' "$context_file") || true
  if [[ -z "$api_url" || -z "$pool_id" ]]; then
    json_error "Missing apiUrl or poolId in nexu-context.json" 1
  fi

  local secrets_resp
  secrets_resp=$(curl -s -X GET \
    "${api_url}/api/internal/secrets/static-deploy?poolId=${pool_id}" \
    -H "x-internal-token: ${SKILL_API_TOKEN}" 2>/dev/null) || true
  if [[ -n "$secrets_resp" ]]; then
    CLOUDFLARE_API_TOKEN="$(echo "$secrets_resp" | json_val 'd.CLOUDFLARE_API_TOKEN')"
    CLOUDFLARE_ACCOUNT_ID="$(echo "$secrets_resp" | json_val 'd.CLOUDFLARE_ACCOUNT_ID')"
    export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  fi

  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    json_error "CLOUDFLARE_API_TOKEN not set" 1
  fi

  if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    json_error "CLOUDFLARE_ACCOUNT_ID not set" 1
  fi

  ACCOUNT_PATH="/accounts/${CLOUDFLARE_ACCOUNT_ID}"
}

# ============================================================================
# STEP 2: CREATE PROJECT (idempotent)
#   First deploy: creates the Cloudflare Pages project
#   Redeploy:     skips (project already exists)
# ============================================================================

step_create_project() {
  local resp
  resp=$(cf_api POST "${ACCOUNT_PATH}/pages/projects" \
    -d "{\"name\":\"${SLUG}\",\"production_branch\":\"main\"}")

  local success err_msg
  success=$(echo "$resp" | json_val 'd.success') || true
  err_msg=$(echo "$resp" | json_val 'd.errors?.[0]?.message') || true

  if [[ "$success" == "true" ]]; then
    IS_NEW_PROJECT=true
    return 0
  fi

  if [[ "$err_msg" == *"already exists"* ]]; then
    IS_NEW_PROJECT=false
    return 0
  fi

  json_error "Failed to create project: ${err_msg:-unknown error}" 2
}

# ============================================================================
# STEP 3: PREPARE DEPLOY DIRECTORY
#   Copies source to a temp dir and injects cache-control headers to reduce
#   stale CSS/JS/HTML after redeploys. Source files are never modified.
# ============================================================================

step_prepare_deploy_dir() {
  STAGE_DIR="$(mktemp -d)"
  DEPLOY_DIR="$STAGE_DIR/site"
  mkdir -p "$DEPLOY_DIR"

  # Preserve dotfiles and nested structure.
  cp -R "$DIR"/. "$DEPLOY_DIR"/

  append_cache_headers "$DEPLOY_DIR/_headers"

  FILES_TOTAL=$(find "$DEPLOY_DIR" -type f | wc -l | tr -d ' ')
  # Wrangler does not expose precise uploaded-vs-cached counts in a stable
  # machine-readable way here, so we report a conservative "all uploaded".
  FILES_UPLOADED=$FILES_TOTAL
  FILES_CACHED=0
}

# ============================================================================
# STEP 4: DEPLOY VIA WRANGLER
# ============================================================================

step_deploy_wrangler() {
  local -a wrangler_cmd=()
  if have_cmd wrangler; then
    wrangler_cmd=("wrangler")
  else
    local npx_path
    npx_path=$(find_npx) || true
    if [[ -n "$npx_path" ]]; then
      # Ensure the directory containing npx (and node) is in PATH
      local npx_dir
      npx_dir="$(dirname "$npx_path")"
      export PATH="${npx_dir}:${PATH}"
      wrangler_cmd=("$npx_path" "wrangler")
    else
      json_error "Cannot find wrangler or npx. Ensure Node.js is installed." 2
    fi
  fi

  local tmpfile status wrangler_out
  tmpfile="$(mktemp)"

  "${wrangler_cmd[@]}" pages deploy "$DEPLOY_DIR" --project-name "$SLUG" >"$tmpfile" 2>&1
  status=$?
  wrangler_out="$(cat "$tmpfile")"
  rm -f "$tmpfile"

  if [[ $status -ne 0 ]]; then
    local err_line
    err_line=$(printf '%s\n' "$wrangler_out" | tail -n 10 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')
    json_error "wrangler deploy failed: ${err_line:-unknown error}" 2
  fi

  DEPLOY_URL=$(printf '%s\n' "$wrangler_out" | grep -Eo 'https://[^ ]+\.pages\.dev' | head -n 1 || true)
}

# ============================================================================
# STEP 5: ADD CUSTOM DOMAIN (idempotent)
# ============================================================================

step_add_domain() {
  local custom_domain="${SLUG}.${DOMAIN_SUFFIX}"

  # Add custom domain to Pages project (idempotent)
  cf_api POST "${ACCOUNT_PATH}/pages/projects/${SLUG}/domains" \
    -d "{\"name\":\"${custom_domain}\"}" >/dev/null 2>/dev/null || true

  # Look up zone ID for the domain suffix
  local zone_resp zone_id
  zone_resp=$(cf_api GET "/zones?name=${DOMAIN_SUFFIX}") || true
  zone_id=$(echo "$zone_resp" | json_val 'd.result?.[0]?.id') || true

  if [[ -z "$zone_id" ]]; then
    return 0  # Can't create DNS record without zone access, skip silently
  fi

  # Get the pages.dev subdomain for CNAME target
  local project_resp pages_subdomain
  project_resp=$(cf_api GET "${ACCOUNT_PATH}/pages/projects/${SLUG}") || true
  pages_subdomain=$(echo "$project_resp" | json_val 'd.result?.subdomain') || true

  if [[ -z "$pages_subdomain" ]]; then
    return 0
  fi

  # Create CNAME record (idempotent — Cloudflare returns error if exists)
  cf_api POST "/zones/${zone_id}/dns_records" \
    -d "{\"type\":\"CNAME\",\"name\":\"${SLUG}\",\"content\":\"${pages_subdomain}\",\"proxied\":true}" \
    >/dev/null 2>/dev/null || true
}

# ============================================================================
# STEP 6: CHECK DOMAIN OWNERSHIP IN NEXU
# ============================================================================

step_check_domain_available() {
  local nexu_api_url nexu_token
  nexu_api_url="$(resolve_api_context)" || {
    json_error "Missing runtime context for domain check (apiUrl/token). Check nexu-context.json and SKILL_API_TOKEN." 3
  }
  nexu_token="${SKILL_API_TOKEN:-}"

  local resolved_chat_id=""
  if [[ -n "$CHAT_ID_INPUT" ]]; then
    resolved_chat_id="$(resolve_artifact_chat_id "$CHAT_ID_INPUT" "$CHAT_TYPE_INPUT")" || {
      json_error "Missing or invalid chat_type for domain check; expected direct/dm/group/channel/thread" 3
    }
  fi

  local custom_url="https://${SLUG}.${DOMAIN_SUFFIX}"
  local chat_id_field=""
  [[ -n "$resolved_chat_id" ]] && chat_id_field="\"chatId\": \"${resolved_chat_id}\","
  local thread_id_field=""
  [[ -n "$THREAD_ID_INPUT" ]] && thread_id_field="\"threadId\": \"${THREAD_ID_INPUT}\","
  local channel_field=""
  [[ -n "$CHANNEL_INPUT" ]] && channel_field="\"channelType\": \"${CHANNEL_INPUT}\","

  local payload
  payload=$(cat <<EOJSON
{
  "botId": "${AGENT_ID}",
  ${chat_id_field}
  ${thread_id_field}
  ${channel_field}
  "previewUrl": "${custom_url}"
}
EOJSON
  )

  local resp_file http_code
  resp_file="$(mktemp)"
  http_code=$(curl -s -o "$resp_file" -w "%{http_code}" -X POST "${nexu_api_url}/api/internal/artifacts/check-domain" \
    -H "x-internal-token: ${nexu_token}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || true)

  if [[ "$http_code" == "409" ]]; then
    local err_msg
    err_msg="$(cat "$resp_file" | json_val 'd.message || d.error || ""')"
    rm -f "$resp_file"
    json_error "Domain already in use: ${err_msg:-${custom_url}}" 3
  fi

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    local err_msg
    err_msg="$(cat "$resp_file" | json_val 'd.message || d.error || ""')"
    rm -f "$resp_file"
    json_error "Failed to validate domain ownership (HTTP ${http_code:-000}) ${err_msg}" 3
  fi

  rm -f "$resp_file"
}

# ============================================================================
# STEP 7: RECORD ARTIFACT IN NEXU
# ============================================================================

step_record_artifact() {
  # Agent ID = Bot ID (1:1 mapping in Nexu)
  local nexu_bot_id="$AGENT_ID"
  local nexu_api_url nexu_token
  nexu_api_url="$(resolve_api_context)" || {
    json_error "Missing runtime context for artifact record (apiUrl/token). Check nexu-context.json and SKILL_API_TOKEN." 3
  }
  nexu_token="${SKILL_API_TOKEN:-}"

  local resolved_chat_id=""
  if [[ -n "$CHAT_ID_INPUT" ]]; then
    resolved_chat_id="$(resolve_artifact_chat_id "$CHAT_ID_INPUT" "$CHAT_TYPE_INPUT")" || {
      json_error "Missing or invalid chat_type for artifact record; expected direct/dm/group/channel/thread" 3
    }
  fi

  local custom_url="https://${SLUG}.${DOMAIN_SUFFIX}"

  # Build JSON payload — API resolves canonical session key from chatId/threadId server-side.
  local chat_id_field=""
  [[ -n "$resolved_chat_id" ]] && chat_id_field="\"chatId\": \"${resolved_chat_id}\","
  local thread_id_field=""
  [[ -n "$THREAD_ID_INPUT" ]] && thread_id_field="\"threadId\": \"${THREAD_ID_INPUT}\","
  local channel_field=""
  [[ -n "$CHANNEL_INPUT" ]] && channel_field="\"channelType\": \"${CHANNEL_INPUT}\","

  local payload
  payload=$(cat <<EOJSON
{
  "botId": "${nexu_bot_id}",
  ${chat_id_field}
  ${thread_id_field}
  ${channel_field}
  "title": "Deploy: ${SLUG}",
  "artifactType": "deployment",
  "source": "coding",
  "contentType": "text/html",
  "status": "live",
  "previewUrl": "${custom_url}",
  "deployTarget": "cloudflare-pages",
  "fileCount": ${FILES_TOTAL},
  "metadata": { "slug": "${SLUG}", "isNewProject": ${IS_NEW_PROJECT}, "deploymentUrl": "${DEPLOY_URL:-}" }
}
EOJSON
  )

  local resp_file http_code
  resp_file="$(mktemp)"
  http_code=$(curl -s -o "$resp_file" -w "%{http_code}" -X POST "${nexu_api_url}/api/internal/artifacts" \
    -H "x-internal-token: ${nexu_token}" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null || true)

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    local err_msg
    err_msg="$(cat "$resp_file" | json_val 'd.message || d.error || ""')"
    rm -f "$resp_file"
    json_error "Deploy succeeded but artifact record failed (HTTP ${http_code:-000}) ${err_msg}" 3
  fi
  rm -f "$resp_file"
}

# ============================================================================
# STEP 8: OUTPUT
# ============================================================================

step_output() {
  json_success \
    "https://${SLUG}.${DOMAIN_SUFFIX}" \
    "${DEPLOY_URL:-unknown}" \
    "$FILES_TOTAL" \
    "$FILES_UPLOADED" \
    "$FILES_CACHED" \
    "$IS_NEW_PROJECT"
}

# ============================================================================
# MAIN
# ============================================================================

main() {
  trap cleanup EXIT
  step_validate "$@"
  step_check_domain_available
  step_create_project
  step_prepare_deploy_dir
  step_deploy_wrangler
  step_add_domain
  step_record_artifact
  step_output
}

main "$@"
