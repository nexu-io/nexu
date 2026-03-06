#!/usr/bin/env bash
set -euo pipefail

MAX_BYTES=$((100 * 1024))

AGENT_ID=""
SESSION_KEY=""
RUNTIME_SESSION_ID=""
MESSAGE_REF=""
THREAD_REF=""
ACCOUNT_ID=""
CHANNEL_ID=""
CHANNEL_TYPE=""
SENDER_REF=""
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"

usage() {
  cat <<'EOF'
Usage:
  record-session-binding.sh --agent-id <id> --session-key <key> [options]

Options:
  --runtime-session-id <id>
  --message-ref <ref>
  --thread-ref <ref>
  --account-id <id>
  --channel-id <id>
  --channel-type <type>
  --sender-ref <id>
  --state-dir <path>
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-id)
      AGENT_ID="${2:-}"
      shift 2
      ;;
    --session-key)
      SESSION_KEY="${2:-}"
      shift 2
      ;;
    --runtime-session-id)
      RUNTIME_SESSION_ID="${2:-}"
      shift 2
      ;;
    --message-ref)
      MESSAGE_REF="${2:-}"
      shift 2
      ;;
    --thread-ref)
      THREAD_REF="${2:-}"
      shift 2
      ;;
    --account-id)
      ACCOUNT_ID="${2:-}"
      shift 2
      ;;
    --channel-id)
      CHANNEL_ID="${2:-}"
      shift 2
      ;;
    --channel-type)
      CHANNEL_TYPE="${2:-}"
      shift 2
      ;;
    --sender-ref)
      SENDER_REF="${2:-}"
      shift 2
      ;;
    --state-dir)
      STATE_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "{\"status\":\"error\",\"message\":\"Unknown arg: $1\"}"
      exit 2
      ;;
  esac
done

if [[ -z "$AGENT_ID" || -z "$SESSION_KEY" ]]; then
  echo '{"status":"error","message":"--agent-id and --session-key are required"}'
  exit 2
fi

if [[ -z "$RUNTIME_SESSION_ID" ]]; then
  RUNTIME_SESSION_ID="${OPENCLAW_SESSION_KEY:-$SESSION_KEY}"
fi

if [[ -z "$RUNTIME_SESSION_ID" ]]; then
  echo '{"status":"error","message":"runtime session id unavailable"}'
  exit 2
fi

SESSIONS_DIR="$STATE_DIR/agents/$AGENT_ID/sessions"
LOCK_DIR="$SESSIONS_DIR/.nexu-binding.lock"
mkdir -p "$SESSIONS_DIR"

for _ in $(seq 1 40); do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    break
  fi
  sleep 0.05
done

if [[ ! -d "$LOCK_DIR" ]]; then
  echo '{"status":"error","message":"failed to acquire binding lock"}'
  exit 1
fi

cleanup() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
  echo '{"status":"error","message":"node is required"}'
  exit 1
fi

export AGENT_ID SESSION_KEY RUNTIME_SESSION_ID MESSAGE_REF THREAD_REF ACCOUNT_ID CHANNEL_ID CHANNEL_TYPE SENDER_REF SESSIONS_DIR MAX_BYTES

node <<'EOF'
const fs = require("fs");
const path = require("path");

const sessionsDir = process.env.SESSIONS_DIR;
const runtimeSessionId = process.env.RUNTIME_SESSION_ID;
const now = new Date().toISOString();
const maxBytes = Number(process.env.MAX_BYTES || "102400");

const sessionsJsonPath = path.join(sessionsDir, "sessions.json");
const tempPath = `${sessionsJsonPath}.tmp`;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function sanitizeRuntimeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
}

const root = readJson(sessionsJsonPath);
if (!root.nexuBindings || typeof root.nexuBindings !== "object") {
  root.nexuBindings = {};
}

const existing = root.nexuBindings[runtimeSessionId] || {};
let seq = Number(existing.bindingSeq || 1);
const safeId = sanitizeRuntimeId(runtimeSessionId);
let activeFile = existing.activeBindingFile || `binding-${safeId}-${seq}.jsonl`;
let activePath = path.join(sessionsDir, activeFile);

const bindingData = {
  runtimeSessionId,
  nexuSessionKey: process.env.SESSION_KEY || existing.nexuSessionKey || "",
  channelType: process.env.CHANNEL_TYPE || existing.channelType || "",
  accountId: process.env.ACCOUNT_ID || existing.accountId || "",
  channelId: process.env.CHANNEL_ID || existing.channelId || "",
  threadRef: process.env.THREAD_REF || existing.threadRef || "",
  messageRef: process.env.MESSAGE_REF || existing.messageRef || "",
  senderRef: process.env.SENDER_REF || existing.senderRef || "",
  updatedAt: now,
};

const line = JSON.stringify({
  type: "custom",
  customType: "nexu-session-binding",
  timestamp: now,
  data: bindingData,
}) + "\n";

let size = 0;
try {
  size = fs.statSync(activePath).size;
} catch {
  size = 0;
}

if (size + Buffer.byteLength(line) > maxBytes) {
  seq += 1;
  activeFile = `binding-${safeId}-${seq}.jsonl`;
  activePath = path.join(sessionsDir, activeFile);
  size = 0;
  existing.lastRotatedAt = now;
}

fs.appendFileSync(activePath, line, "utf8");
size += Buffer.byteLength(line);

root.nexuBindings[runtimeSessionId] = {
  ...existing,
  ...bindingData,
  activeBindingFile: activeFile,
  activeBindingFileSize: size,
  bindingSeq: seq,
  updatedAt: now,
};

fs.writeFileSync(tempPath, JSON.stringify(root, null, 2) + "\n", "utf8");
fs.renameSync(tempPath, sessionsJsonPath);

console.log(
  JSON.stringify({
    status: "ok",
    runtimeSessionId,
    activeBindingFile: activeFile,
    activeBindingFileSize: size,
    bindingSeq: seq,
  }),
);
EOF
