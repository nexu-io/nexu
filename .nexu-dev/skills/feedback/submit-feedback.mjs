#!/usr/bin/env node
// submit-feedback.mjs — Read session JSONL, extract messages + images, POST to feedback API.
// Called by the bot via exec: node <this_file> --content "..." --sender "..." --channel "..." --agent-id "..."

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const content = getArg("content");
const sender = getArg("sender") || "unknown";
const channel = getArg("channel") || "unknown";
const agentId = getArg("agent-id");

if (!content) {
  console.log(JSON.stringify({ ok: false, error: "missing --content" }));
  process.exit(1);
}

const apiBase = process.env.RUNTIME_API_BASE_URL || "http://localhost:3000";
const token =
  process.env.SKILL_API_TOKEN ||
  process.env.INTERNAL_API_TOKEN ||
  "gw-secret-token";

const MAX_MESSAGES = 30;
const MAX_IMAGES = 5;
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_BYTES = 30 * 1024 * 1024; // 30 MB

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

// ---------------------------------------------------------------------------
// Find session JSONL
// ---------------------------------------------------------------------------
function findSessionFile() {
  if (!agentId) return null;

  // Derive state dir from script location: .openclaw/skills/feedback/submit-feedback.mjs → .openclaw/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const resolved = resolve(__dirname, "..", "..");
  const indexPath = join(
    resolved,
    "agents",
    agentId,
    "sessions",
    "sessions.json",
  );

  if (!existsSync(indexPath)) return null;

  try {
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    let best = null;
    let bestTime = 0;
    for (const session of Object.values(index)) {
      if (session.updatedAt > bestTime) {
        bestTime = session.updatedAt;
        best = session;
      }
    }
    return best?.sessionFile ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parse JSONL → messages + image paths
// ---------------------------------------------------------------------------

const MAX_ASSISTANT_MSG_LEN = 300;

/**
 * Clean assistant text: strip code blocks, long paths, JSON blobs, etc.
 * Keep only the conversational substance.
 */
function cleanAssistantText(input) {
  let text = input;
  // Replace fenced code blocks with a short placeholder
  text = text.replace(/```[\s\S]*?```/g, "[代码片段]");

  // Replace inline code that looks like long paths (>40 chars)
  text = text.replace(/`[^`]{40,}`/g, "[...]");

  // Strip lines that are mostly a file path (e.g. /data/openclaw/..., /Users/..., ./src/...)
  text = text.replace(/^.*(?:\/[\w._-]+){4,}.*$/gm, "");

  // Strip lines that look like JSON objects/arrays (starts with { or [, >60 chars)
  text = text.replace(/^\s*[{[][\s\S]{60,}$/gm, "");

  // Strip tool-use markers that OpenClaw sometimes injects
  text = text.replace(
    /\[(?:tool_use|tool_result|function_call|exec)[^\]]*\]\n?/gi,
    "",
  );

  // Collapse multiple blank lines into one
  text = text.replace(/\n{3,}/g, "\n\n");

  text = text.trim();

  // Truncate if still too long
  if (text.length > MAX_ASSISTANT_MSG_LEN) {
    text = `${text.slice(0, MAX_ASSISTANT_MSG_LEN)}…`;
  }

  return text;
}

function parseSession(filePath) {
  const messages = [];
  const imagePaths = [];
  const filePaths = [];

  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg?.content) continue;

    if (msg.role === "user" || msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type !== "text") continue;

        let text = block.text;

        // Strip system envelope: "System: [timestamp] Feishu/Slack[...] DM/Channel from ...: actual message"
        text = text.replace(
          /^System:\s*\[.*?\]\s*(?:Feishu|Slack|Discord)\[.*?\]\s*(?:DM|Channel)\s+from\s+\S+:\s*/,
          "",
        );

        // Extract media paths from user messages — classify as image or file
        if (msg.role === "user") {
          // Format: [media attached: /path (mime)]
          text = text.replace(
            /\[media attached: ([^\s]+) \(([^)]+)\)[^\]]*\]\n?/g,
            (_match, path, mime) => {
              const ext = path.split(".").pop()?.toLowerCase() || "";
              if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith("image/")) {
                if (imagePaths.length < MAX_IMAGES) imagePaths.push(path);
              } else {
                if (filePaths.length < MAX_FILES) filePaths.push(path);
              }
              return "";
            },
          );
          // Format: [media attached N/M: /path (mime) | /path]
          text = text.replace(
            /\[media attached \d+\/\d+: ([^\s]+) \(([^)]+)\)[^\]]*\]\n?/g,
            (_match, path, mime) => {
              const ext = path.split(".").pop()?.toLowerCase() || "";
              if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith("image/")) {
                if (imagePaths.length < MAX_IMAGES) imagePaths.push(path);
              } else {
                if (filePaths.length < MAX_FILES) filePaths.push(path);
              }
              return "";
            },
          );
          // Strip "[media attached: N files]" header
          text = text.replace(/\[media attached: \d+ files?\]\n?/g, "");

          // Extract Slack/Discord image URLs: [image: https://...]
          text = text.replace(
            /\[image: (https?:\/\/[^\s\]]+)\]\n?/g,
            (_match, url) => {
              if (imagePaths.length < MAX_IMAGES) imagePaths.push(url);
              return "";
            },
          );

          // Strip system-injected metadata blocks
          text = text.replace(
            /,?\s*prefer the message tool[^\n]*(?:\n(?!Conversation info|Sender \(|<@|\[message_id)[^\n]*)*/i,
            "",
          );
          text = text.replace(
            /Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\n?/g,
            "",
          );
          text = text.replace(
            /Sender \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\n?/g,
            "",
          );
          text = text.replace(/\[message_id: [^\]]+\]\n?/g, "");

          // Strip Slack-specific noise
          text = text.replace(/\[Slack file: [^\]]*\]\n?/g, "");
          text = text.replace(
            /Untrusted context \(metadata[^)]*\):[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\n?/g,
            "",
          );
          // Strip Slack user mentions: <@U0AJB581Q2D> → ""
          text = text.replace(/<@[A-Z0-9]+>/g, "");
        }

        text = text.replace(/To send an image back.*?\n?/g, "");

        // Clean assistant messages to remove technical noise
        if (msg.role === "assistant") {
          text = cleanAssistantText(text);
        } else {
          text = text.trim();
        }

        if (!text) continue;

        const prefix = msg.role === "user" ? "👤" : "🤖";
        messages.push(`${prefix} ${text}`);
      }
    }
  }

  return {
    conversationContext: messages.slice(-MAX_MESSAGES).join("\n"),
    imagePaths,
    filePaths,
  };
}

// ---------------------------------------------------------------------------
// Read images → base64
// ---------------------------------------------------------------------------
function readImages(paths) {
  const imageData = [];
  const seen = new Set();

  for (const p of paths) {
    if (seen.has(p) || imageData.length >= MAX_IMAGES) break;
    seen.add(p);

    if (!existsSync(p)) continue;

    try {
      const buf = readFileSync(p);
      if (buf.length > MAX_IMAGE_BYTES) continue;

      // Guess mimeType from extension
      const ext = p.split(".").pop()?.toLowerCase() || "png";
      const mimeMap = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
      };
      const mimeType = mimeMap[ext] || "image/png";

      imageData.push({ data: buf.toString("base64"), mimeType });
    } catch {
      // skip unreadable
    }
  }

  return imageData;
}

// ---------------------------------------------------------------------------
// Read files → base64
// ---------------------------------------------------------------------------
function readFiles(paths) {
  const fileData = [];
  const seen = new Set();

  for (const p of paths) {
    if (seen.has(p) || fileData.length >= MAX_FILES) break;
    seen.add(p);

    if (!existsSync(p)) continue;

    try {
      const buf = readFileSync(p);
      if (buf.length > MAX_FILE_BYTES) continue;

      // Extract filename: OpenClaw uses "originalName---uuid.ext" format
      const basename = p.split("/").pop() || "file";
      // Remove the UUID suffix if present (e.g. "doc---uuid.pdf" → "doc.pdf")
      const fileName = basename.replace(/---[a-f0-9-]+(?=\.\w+$)/, "");

      fileData.push({ data: buf.toString("base64"), fileName });
    } catch {
      // skip unreadable
    }
  }

  return fileData;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let conversationContext = "";
let imageData = [];
let fileData = [];
const imageUrls = [];

const sessionFile = findSessionFile();
if (sessionFile && existsSync(sessionFile)) {
  const parsed = parseSession(sessionFile);
  conversationContext = parsed.conversationContext;

  // Split image paths into local files and remote URLs
  const localPaths = [];
  for (const p of parsed.imagePaths) {
    if (p.startsWith("http://") || p.startsWith("https://")) {
      imageUrls.push(p);
    } else {
      localPaths.push(p);
    }
  }

  imageData = readImages(localPaths);
  fileData = readFiles(parsed.filePaths);
}

const payload = {
  content,
  sender,
  channel,
  agentId,
  conversationContext: conversationContext.slice(0, 10000),
};

if (imageData.length > 0) {
  payload.imageData = imageData;
}

if (imageUrls.length > 0) {
  payload.imageUrls = imageUrls;
}

if (fileData.length > 0) {
  payload.fileData = fileData;
}

try {
  const resp = await fetch(`${apiBase}/api/internal/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  console.log(JSON.stringify(data));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
