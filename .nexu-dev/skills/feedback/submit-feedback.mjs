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

const MAX_MESSAGES = 10;
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

const MAX_ASSISTANT_MSG_LEN = 200;
const MAX_USER_MSG_LEN = 300;

// Whitelist regex: only System messages with "from <sender>:" are real user messages
const ENVELOPE_RE = /^System:\s*\[[^\]]*\]\s+.*?\bfrom\s+[^:]+:\s*([\s\S]+)$/;

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

  // Strip inline JSON fragments
  text = text.replace(/\{"[^"]*":\s*"[^"]*"(?:,\s*"[^"]*":\s*"[^"]*")*\}/g, "");

  // Strip numbered/bulleted list noise (long instructional lists)
  text = text.replace(/^\d+\.\s+.{0,20}(联系|通过|直接|建议|或者).*$/gm, "");

  // Strip lines that look like internal skill/path references (require path-like patterns)
  text = text.replace(/^.*(?:\/[\w._-]+){2,}.*(?:skill|snapshot).*$/gim, "");

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

        // --- Whitelist mode for user messages ---
        if (msg.role === "user") {
          // Strip MEDIA instruction prefix (OpenClaw injects this before the real content)
          text = text.replace(
            /^,?\s*prefer the message tool[\s\S]*?Keep caption in the text body\.\n?/i,
            "",
          );
          text = text.trim();

          if (text.startsWith("System:")) {
            const envelopeMatch = text.match(ENVELOPE_RE);
            if (envelopeMatch) {
              text = envelopeMatch[1]; // extract the actual message content
            } else {
              // Fallback: strip known system-noise prefixes but keep the rest
              // Skip exec output, tool results, and pure system notifications
              if (
                /^System:\s*\[.*?\]\s*(?:exec|tool_result|notification)\b/i.test(
                  text,
                )
              )
                continue;
              // Strip the "System: [timestamp] ..." prefix and keep remaining content
              text = text.replace(/^System:\s*\[[^\]]*\]\s*/, "");
            }
          }

          // Skip /feedback command invocations (not real conversation)
          if (/^\/feedback\b/i.test(text)) continue;

          // Skip small pure JSON payloads (Feishu media keys, file keys, etc.)
          // Keep longer JSON that might be user-sent config/data
          if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text) && text.length < 200)
            continue;

          // Strip platform echo lines: [Feishu ...] sender: ... or [Slack ...] ...
          text = text.replace(
            /^\[(?:Feishu|Slack|Discord)\s[^\]]*\][^\n]*\n?/gm,
            "",
          );

          // Extract media paths before cleaning — classify as image or file
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

          // Strip injected metadata blocks from message body
          text = text.replace(
            /Conversation info \(untrusted metadata\):[\s\S]*?```\n?/g,
            "",
          );
          text = text.replace(
            /Sender \(untrusted metadata\):[\s\S]*?```\n?/g,
            "",
          );
          text = text.replace(
            /Untrusted context[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\n?/g,
            "",
          );
          text = text.replace(/\[message_id: [^\]]+\]\n?/g, "");
          text = text.replace(/<@[A-Z0-9]+>/g, "");
          text = text.replace(/,?\s*prefer the message tool[^\n]*/i, "");

          // Extract useful content from "Replied message" JSON blocks
          text = text.replace(
            /Replied message \(untrusted, for context\):\s*```json\s*([\s\S]*?)```\n?/g,
            (_match, json) => {
              try {
                const obj = JSON.parse(json);
                const body = obj.body?.trim();
                return body ? `↩️ ${body}\n` : "";
              } catch {
                return "";
              }
            },
          );

          // Extract useful content from "Chat history" JSON blocks
          text = text.replace(
            /Chat history since last reply \(untrusted, for context\):\s*```json\s*([\s\S]*?)```\n?/g,
            (_match, json) => {
              try {
                const arr = JSON.parse(json);
                if (!Array.isArray(arr) || arr.length === 0) return "";
                const lines = arr
                  .slice(-3) // keep last 3 messages max
                  .map((m) => m.body?.trim())
                  .filter(Boolean);
                return lines.length > 0 ? `💬 ${lines.join(" → ")}\n` : "";
              } catch {
                return "";
              }
            },
          );

          // Strip [System: ...] lines (Feishu mention hints etc.)
          text = text.replace(/\[System: [^\]]*\]\n?/g, "");

          // Strip MEDIA instruction block injected by OpenClaw
          text = text.replace(
            /MEDIA:https?:\/\/\S+[\s\S]*?Keep caption in the text body\.\n?/g,
            "",
          );

          // Strip Slack-specific noise
          text = text.replace(/\[Slack file: [^\]]*\]\n?/g, "");

          // Strip Feishu at-mention tags: <at user_id="...">name</at> → name
          text = text.replace(/<at user_id="[^"]*">([^<]*)<\/at>/g, "$1");

          text = text.replace(/To send an image back.*?\n?/g, "");

          // Truncate very long text (e.g. extracted documents, PDFs) instead of dropping
          const lineCount = text.split("\n").filter(Boolean).length;
          if (lineCount > 15 && text.length > 500) {
            const truncatedLines = text.split("\n").filter(Boolean).slice(0, 5);
            text = `${truncatedLines.join("\n")}…[长文本已截断]`;
          }

          // Strip remaining JSON-like fragments inline
          text = text.replace(
            /\{"[^"]*":\s*"[^"]*"(?:,\s*"[^"]*":\s*"[^"]*")*\}/g,
            "",
          );

          text = text.trim();

          // Skip empty or trivially short after cleaning
          if (text.length < 2) continue;

          // Truncate user messages
          if (text.length > MAX_USER_MSG_LEN) {
            text = `${text.slice(0, MAX_USER_MSG_LEN)}…`;
          }
        }

        // Clean assistant messages to remove technical noise
        if (msg.role === "assistant") {
          text = text.replace(/To send an image back.*?\n?/g, "");
          text = cleanAssistantText(text);
        }

        if (!text) continue;

        // Skip bot messages about feedback skill itself (narrow match)
        if (
          msg.role === "assistant" &&
          /(?:feedback.*skill|skill.*feedback|授权问题|已经.*反馈.*发送)/i.test(
            text,
          )
        ) {
          continue;
        }

        const prefix = msg.role === "user" ? "👤" : "🤖";
        const entry = `${prefix} ${text}`;

        // Deduplicate: skip if identical to last message
        if (messages.length > 0 && messages[messages.length - 1] === entry)
          continue;

        messages.push(entry);
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
