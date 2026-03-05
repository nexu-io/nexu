#!/usr/bin/env bash
set -euo pipefail

# Resolve session binding parameters from OpenClaw state files.
# Lookup order:
# 1) sessions.json nexuBindings (fast path)
# 2) binding-*.jsonl
# 3) fallback *.jsonl custom binding scan

MESSAGE_REF=""
THREAD_REF=""
SESSION_KEY=""
RUNTIME_SESSION_ID=""
AGENT_ID=""
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"

usage() {
  cat <<'USAGE'
Usage:
  session-search.sh [options]

Options:
  --message-ref <ref>
  --thread-ref <ref>
  --session-key <key>
  --runtime-session-id <id>
  --agent-id <agent-id>
  --state-dir <path>
  -h, --help

Examples:
  session-search.sh --message-ref 1772590256.478579
  session-search.sh --thread-ref 1772590256.478579 --agent-id my-bot
  session-search.sh --session-key slack_T09CNAG1BP0_D0AJFLDFB8S
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message-ref)
      MESSAGE_REF="${2:-}"
      shift 2
      ;;
    --thread-ref)
      THREAD_REF="${2:-}"
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
    --agent-id)
      AGENT_ID="${2:-}"
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
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$MESSAGE_REF" && -z "$THREAD_REF" && -z "$SESSION_KEY" && -z "$RUNTIME_SESSION_ID" ]]; then
  echo '{"status":"error","message":"At least one query option is required"}'
  exit 2
fi

if [[ ! -d "$STATE_DIR/agents" ]]; then
  echo '{"status":"error","message":"State directory not found or has no agents folder"}'
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo '{"status":"error","message":"node is required"}'
  exit 1
fi

TMP_JSONL="$(mktemp)"
TMP_SESSIONS="$(mktemp)"
trap 'rm -f "$TMP_JSONL" "$TMP_SESSIONS"' EXIT

if [[ -n "$AGENT_ID" ]]; then
  find "$STATE_DIR/agents/$AGENT_ID/sessions" -type f -name "*.jsonl" 2>/dev/null | sort >"$TMP_JSONL" || true
  find "$STATE_DIR/agents/$AGENT_ID/sessions" -type f -name "sessions.json" 2>/dev/null | sort >"$TMP_SESSIONS" || true
else
  find "$STATE_DIR/agents" -type f -path "*/sessions/*.jsonl" 2>/dev/null | sort >"$TMP_JSONL" || true
  find "$STATE_DIR/agents" -type f -path "*/sessions/sessions.json" 2>/dev/null | sort >"$TMP_SESSIONS" || true
fi

if [[ ! -s "$TMP_JSONL" && ! -s "$TMP_SESSIONS" ]]; then
  echo '{"status":"error","message":"No session files found"}'
  exit 1
fi

export MESSAGE_REF THREAD_REF SESSION_KEY RUNTIME_SESSION_ID

node - "$TMP_JSONL" "$TMP_SESSIONS" <<'NODE'
const fs = require("fs");
const path = require("path");

const jsonlListPath = process.argv[2];
const sessionsListPath = process.argv[3];

const jsonlFiles = fs.existsSync(jsonlListPath)
  ? fs.readFileSync(jsonlListPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  : [];
const sessionsFiles = fs.existsSync(sessionsListPath)
  ? fs.readFileSync(sessionsListPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  : [];

const query = {
  messageRef: process.env.MESSAGE_REF || "",
  threadRef: process.env.THREAD_REF || "",
  sessionKey: process.env.SESSION_KEY || "",
  runtimeSessionId: process.env.RUNTIME_SESSION_ID || "",
};

function parseAgentId(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/agents/";
  const idx = normalized.indexOf(marker);
  if (idx < 0) return "";
  const rest = normalized.slice(idx + marker.length);
  return rest.split("/")[0] || "";
}

function parseRuntimeSessionId(filePath) {
  return path.basename(filePath, ".jsonl");
}

function matchesQuery(data, runtimeSessionId) {
  if (query.runtimeSessionId && runtimeSessionId !== query.runtimeSessionId) return false;
  if (query.sessionKey && data.nexuSessionKey !== query.sessionKey) return false;
  if (query.threadRef && data.threadRef !== query.threadRef) return false;
  if (
    query.messageRef &&
    data.messageRef !== query.messageRef &&
    data.lastMessageRef !== query.messageRef
  ) {
    return false;
  }
  return true;
}

function toResult({ file, agentId, runtimeSessionId, timestamp, data }) {
  return {
    file,
    agentId,
    runtimeSessionId,
    timestamp: timestamp || data.updatedAt || "",
    nexuSessionKey: data.nexuSessionKey || "",
    channelType: data.channelType || "",
    accountId: data.accountId || "",
    channelId: data.channelId || "",
    threadRef: data.threadRef || "",
    messageRef: data.messageRef || data.lastMessageRef || "",
    senderRef: data.senderRef || data.lastSenderRef || "",
  };
}

let best = null;

// Fast path: sessions.json nexuBindings
for (const file of sessionsFiles) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const bindings = parsed?.nexuBindings;
  if (!bindings || typeof bindings !== "object") continue;

  for (const [runtimeSessionId, data] of Object.entries(bindings)) {
    if (!data || typeof data !== "object") continue;
    if (!matchesQuery(data, runtimeSessionId)) continue;

    const candidate = toResult({
      file,
      agentId: parseAgentId(file),
      runtimeSessionId,
      timestamp: data.updatedAt || "",
      data,
    });

    if (!best || String(candidate.timestamp) > String(best.timestamp)) {
      best = candidate;
    }
  }
}

// Fallback: scan binding jsonl files first, then all jsonl files
const prioritized = [
  ...jsonlFiles.filter((f) => path.basename(f).startsWith("binding-")),
  ...jsonlFiles.filter((f) => !path.basename(f).startsWith("binding-")),
];

function isBindingRecord(obj) {
  return (
    obj &&
    obj.type === "custom" &&
    obj.customType === "nexu-session-binding" &&
    obj.data &&
    typeof obj.data === "object"
  );
}

for (const file of prioritized) {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const runtimeSessionId = parseRuntimeSessionId(file);
  const lines = raw.split("\n").filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let obj;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!isBindingRecord(obj)) continue;
    if (!matchesQuery(obj.data, runtimeSessionId)) continue;

    const candidate = toResult({
      file,
      agentId: parseAgentId(file),
      runtimeSessionId,
      timestamp: obj.timestamp || "",
      data: obj.data,
    });

    if (!best || String(candidate.timestamp) > String(best.timestamp)) {
      best = candidate;
    }
    break;
  }
}

if (!best) {
  console.log(
    JSON.stringify({
      status: "not_found",
      message: "No matching nexu-session-binding record found in session files",
      query,
    }),
  );
  process.exit(3);
}

console.log(
  JSON.stringify({
    status: "ok",
    result: best,
    deployParams: {
      agentId: best.agentId,
      nexuSessionKey: best.nexuSessionKey,
      channelType: best.channelType,
      accountId: best.accountId,
      channelId: best.channelId,
      messageRef: best.messageRef,
      threadRef: best.threadRef,
    },
  }),
);
NODE
