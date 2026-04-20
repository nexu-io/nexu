import { ChatMarkdown } from "@/components/ui/chat-markdown";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  File,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiV1Bots,
  getApiV1BotsDefault,
  getApiV1ChatHistory,
  getApiV1ChatSession,
  postApiV1ChatLocal,
} from "../../lib/api/sdk.gen";

const BOT_AVATAR = "/brand/ip-nexu.svg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BotItem {
  id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "deleted";
  modelId: string;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
}

/** An attachment staged in the input box, waiting to be sent */
interface PendingAttachment {
  id: string;
  type: "image" | "file";
  /** data: URL — used only for rendering thumbnails / previews in the tray */
  previewUrl: string;
  /**
   * Pure base64-encoded content (NO data: URL prefix).  Sent as-is to the
   * controller, which splits images (forwarded to OpenClaw's chat.send
   * attachment pipeline) from files (extracted server-side into `<file>`
   * blocks folded into the message body).
   */
  content: string;
  mimeType: string;
  filename?: string;
  size?: number;
}

/** Typed content blocks used for rendering chat bubbles */
type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string; mimeType?: string }
  | { kind: "file"; filename: string; mimeType: string; size?: number };

// Every local chat message targets the agent's main webchat session —
// `chat.send` never routes to Feishu / WeChat ingress paths, so there is no
// reason to expose a channel picker to the user.  Keep the main-session key
// derivation in one place.
function buildMainSessionKey(botId: string): string {
  return `agent:${botId}:main`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum raw file size accepted for upload.
 * OpenClaw's parseMessageWithAttachments uses a 5 MB decoded-bytes limit for
 * images; the controller's attachment-extractor also caps files at 5 MB.
 * 7.5 MB raw base64 comfortably sits under both hard caps while accepting
 * slightly larger images.
 */
const MAX_FILE_BYTES = 7_500_000;

// Polling / session-discovery timing constants
/** How often to poll for new messages while an agent turn is in flight (ms). */
const POLL_INTERVAL_MS = 750;
/**
 * Maximum polling attempts before giving up even if the agent keeps
 * producing messages — safety net against runaway tool loops.
 * 240 × 750 ms = 180 s.
 */
const POLL_MAX_ATTEMPTS = 240;
/** Interval between session-discovery retries after send (ms) */
const SESSION_DISCOVERY_INTERVAL_MS = 500;
/** Maximum number of session-discovery attempts after send */
const SESSION_DISCOVERY_MAX_ATTEMPTS = 6;

/** Patterns that identify the "missing API key" error from OpenClaw */
const MISSING_API_KEY_PATTERNS = [
  "⚠️ Agent failed before reply: No API key found for provider",
  "No API key found for provider",
  "missing_api_key",
];

function isMissingApiKeyError(text: string): boolean {
  return MISSING_API_KEY_PATTERNS.some((p) =>
    text.toLowerCase().includes(p.toLowerCase()),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Matches a `<file name="…" mime="…" [size="…"] [path="…"]>…</file>`
 * envelope.  The controller's attachment-extractor (and OpenClaw's own
 * extractFileBlocks) emit this shape; attributes appear in any order so we
 * parse the opening tag as an attribute bag rather than positional groups.
 * In the chat bubble we render a file card — the `{extracted text}` body
 * and the `path` attribute are for the model only, never displayed.
 */
const FILE_BLOCK_PATTERN = /<file\s+([^>]*?)>([\s\S]*?)<\/file>/giu;
const FILE_ATTR_PATTERN = /(\w+)="([^"]*)"/gu;

function parseFileBlockAttrs(attrText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of attrText.matchAll(FILE_ATTR_PATTERN)) {
    const key = m[1];
    const value = m[2];
    if (key && value != null) out[key] = value;
  }
  return out;
}

/**
 * Legacy `[附件: <filename> (<size>，二进制文件，内容无法直接传递)]` marker
 * that earlier webchat builds folded into fullText.  Kept for backward
 * compatibility so existing session history still renders as file cards.
 */
const LEGACY_BINARY_MARKER =
  /\[附件: (.+?) \(([^，]+)，二进制文件，内容无法直接传递\)\]/gu;

/**
 * Neutral marker `[附件: <filename> (<size>)]` used by the controller as a
 * fallback when extraction is skipped (unsupported MIME, empty content, …).
 */
const NEUTRAL_ATTACHMENT_MARKER = /\[附件: (.+?)(?: \(([^)]+)\))?\]/gu;

/**
 * Tool-use hint the controller appends after persisting file attachments
 * ("[Tool hint: the <file> blocks above include a `path` attribute ...]").
 * It's for the model's benefit; rendering it in the chat bubble is noise.
 */
const TOOL_HINT_PATTERN = /\[Tool hint: the <file> blocks above[^\]]*?\]/gu;

/** Convert a human-readable size label (e.g. "143.8 KB") back to bytes. */
function parseSizeLabel(label: string): number | undefined {
  const m = label.trim().match(/^([\d.]+)\s*(B|KB|MB)$/iu);
  if (!m?.[1]) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = (m[2] ?? "").toUpperCase();
  if (unit === "B") return Math.round(value);
  if (unit === "KB") return Math.round(value * 1024);
  if (unit === "MB") return Math.round(value * 1024 * 1024);
  return undefined;
}

function decodeXmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Infer a MIME type from a filename extension.  Used when rendering legacy
 * `[附件: filename (size)]` markers that don't carry a MIME attribute —
 * without this, every historical file attachment would fall back to
 * `application/octet-stream` and render with the generic blue file icon,
 * while the optimistic bubble (which knew the real MIME) rendered the
 * PDF-red / spreadsheet-green variants.  Keep the table small and focused
 * on formats `fileIconProps` actually distinguishes.
 */
function inferMimeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = filename.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "csv":
      return "text/csv";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

interface Replacement {
  start: number;
  end: number;
  block: ContentBlock;
}

function collectFileBlockReplacements(text: string): Replacement[] {
  const out: Replacement[] = [];
  for (const m of text.matchAll(FILE_BLOCK_PATTERN)) {
    const start = m.index ?? 0;
    const attrs = parseFileBlockAttrs(m[1] ?? "");
    const sizeRaw = attrs.size;
    const sizeNum =
      sizeRaw && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : undefined;
    out.push({
      start,
      end: start + m[0].length,
      block: {
        kind: "file",
        filename: decodeXmlAttr(attrs.name ?? "file"),
        mimeType: decodeXmlAttr(attrs.mime ?? "application/octet-stream"),
        size: sizeNum,
      },
    });
  }
  return out;
}

function collectMarkerReplacements(
  text: string,
  pattern: RegExp,
  filenameGroup = 1,
  sizeGroup = 2,
  coveredRanges: Array<[number, number]> = [],
): Replacement[] {
  const out: Replacement[] = [];
  const isCovered = (start: number, end: number) =>
    coveredRanges.some(([a, b]) => start >= a && end <= b);
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isCovered(start, end)) continue;
    const filename = (m[filenameGroup] ?? "file").trim();
    out.push({
      start,
      end,
      block: {
        kind: "file",
        filename,
        mimeType: inferMimeFromFilename(filename),
        size: parseSizeLabel(m[sizeGroup] ?? ""),
      },
    });
  }
  return out;
}

/**
 * Return true when `msg` looks like a terminal assistant reply — an
 * assistant-role message that carries at least one non-empty text block
 * and *no* pending tool call.  OpenClaw's agent loop closes every
 * successful turn with exactly this shape; intermediate steps (thinking-
 * only, toolCall-only, or text+toolCall mid-turn narration) do not
 * qualify.  Used as the authoritative "turn finished" signal for polling
 * teardown — a gap-based heuristic can't distinguish a long tool call
 * from a finished turn.
 */
function isAssistantTextReply(msg: ChatMsg): boolean {
  if (msg.role !== "assistant") return false;
  const c = msg.content;
  if (typeof c === "string") return c.trim().length > 0;
  if (!Array.isArray(c)) return false;
  let hasText = false;
  for (const entry of c) {
    if (typeof entry !== "object" || entry === null) continue;
    const block = entry as Record<string, unknown>;
    const tag = typeof block.type === "string" ? block.type : block.kind;
    // Any pending tool invocation means more messages are coming —
    // not a terminal reply.
    if (tag === "toolCall" || tag === "tool_use") return false;
    if (tag === "text") {
      const text = block.text;
      if (typeof text === "string" && text.trim().length > 0) hasText = true;
    }
  }
  return hasText;
}

/**
 * Convert a raw message text into ContentBlocks, substituting `<file>` /
 * legacy `[附件: …]` markers with file cards.  Surrounding prose becomes
 * text blocks; if nothing matched, the whole string comes back as a single
 * text block.  Overlapping matches are deduped (file-block > legacy marker
 * > neutral marker).  Tool-use hints are stripped entirely — they are not
 * user-facing content.
 */
function splitTextOnAttachmentMarkers(text: string): ContentBlock[] {
  const normalized = text.replace(TOOL_HINT_PATTERN, "");
  return splitNormalizedText(normalized);
}

function splitNormalizedText(text: string): ContentBlock[] {
  const fileBlockReplacements = collectFileBlockReplacements(text);
  const fileBlockRanges = fileBlockReplacements.map(
    (r) => [r.start, r.end] as [number, number],
  );
  const legacyReplacements = collectMarkerReplacements(
    text,
    LEGACY_BINARY_MARKER,
    1,
    2,
    fileBlockRanges,
  );
  const coveredSoFar = [
    ...fileBlockRanges,
    ...legacyReplacements.map((r) => [r.start, r.end] as [number, number]),
  ];
  const neutralReplacements = collectMarkerReplacements(
    text,
    NEUTRAL_ATTACHMENT_MARKER,
    1,
    2,
    coveredSoFar,
  );

  const replacements = [
    ...fileBlockReplacements,
    ...legacyReplacements,
    ...neutralReplacements,
  ].sort((a, b) => a.start - b.start);

  if (replacements.length === 0) {
    return text ? [{ kind: "text", text }] : [];
  }

  const out: ContentBlock[] = [];
  let cursor = 0;
  for (const r of replacements) {
    if (r.start > cursor) {
      const leading = text.slice(cursor, r.start).replace(/\s+$/u, "");
      if (leading) out.push({ kind: "text", text: leading });
    }
    out.push(r.block);
    cursor = r.end;
  }
  if (cursor < text.length) {
    const trailing = text.slice(cursor).replace(/^\s+/u, "");
    if (trailing) out.push({ kind: "text", text: trailing });
  }
  return out;
}

/** Parse any message content shape into typed ContentBlock[] for rendering */
function extractContent(msg: ChatMsg): ContentBlock[] {
  const c = msg.content;

  // Plain string — could be text or a raw base64 image DataURL
  if (typeof c === "string") {
    if (c.startsWith("data:image/")) return [{ kind: "image", src: c }];
    return splitTextOnAttachmentMarkers(c);
  }

  // Anthropic-style content block array (from JSONL history)
  if (Array.isArray(c)) {
    // Already-processed ContentBlocks (e.g. optimistic messages) carry a
    // `kind` discriminator rather than Anthropic's `type` field — pass through.
    if (
      c.length > 0 &&
      typeof (c[0] as Record<string, unknown>).kind === "string"
    ) {
      return c as ContentBlock[];
    }
    return (c as Array<Record<string, unknown>>).flatMap(
      (b): ContentBlock[] => {
        if (b.type === "text") {
          return splitTextOnAttachmentMarkers(String(b.text ?? ""));
        }
        if (b.type === "image") {
          // Two persisted shapes appear in OpenClaw session JSONLs:
          //   1. Anthropic nested: `{type:"image", source:{type:"base64",
          //      data, media_type}}` — what reaches the model / provider.
          //   2. OpenClaw flat: `{type:"image", data, mimeType}` — the
          //      shape `parseMessageWithAttachments` emits at chat.send
          //      time and what the gateway writes back to disk for inbound
          //      webchat images.
          // Support both so legacy and current messages render identically.
          const src = b.source as Record<string, unknown> | undefined;
          const data = String(src?.data ?? b.data ?? "");
          const mediaType = String(
            src?.media_type ?? b.mimeType ?? "image/jpeg",
          );
          if (!data) return [];
          return [
            { kind: "image" as const, src: `data:${mediaType};base64,${data}` },
          ];
        }
        if (b.type === "file") {
          return [
            {
              kind: "file" as const,
              filename: String(b.filename ?? "file"),
              mimeType: String(b.mimeType ?? "application/octet-stream"),
              size: typeof b.size === "number" ? b.size : undefined,
            },
          ];
        }
        return [];
      },
    );
  }

  // Object with a text field
  if (typeof c === "object" && c !== null && "text" in c) {
    return splitTextOnAttachmentMarkers(
      String((c as Record<string, unknown>).text ?? ""),
    );
  }

  return [];
}

/** Strip assistant [[reply_to_current]] prefix and <final>…</final> wrapper tags */
function cleanText(raw: string): string {
  return raw
    .replace(/^\s*\[\[reply_to_current\]\]\s*/u, "")
    .replace(/<final>\s*/giu, "")
    .replace(/\s*<\/final>/giu, "")
    .trim();
}

/** Format HH:mm from ms timestamp */
function formatTs(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Human-readable file size */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strip the `data:<mime>;base64,` header from a DataURL and return pure
 * base64.  If the string is already bare base64 it is returned unchanged.
 * This mirrors the channel-adapter pattern where attachments always carry
 * raw base64 — never a DataURL — in the `content` field.
 */
function extractBase64FromDataUrl(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx !== -1 && dataUrl.startsWith("data:")) {
    return dataUrl.slice(commaIdx + 1);
  }
  return dataUrl;
}

/** Pick a lucide icon and colour based on MIME type */
function fileIconProps(mimeType: string): { Icon: typeof File; color: string } {
  // Use exact / prefix matches to avoid false positives from substring collisions
  if (mimeType === "application/pdf")
    return { Icon: FileText, color: "text-red-500" };
  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/csv"
  ) {
    return { Icon: FileSpreadsheet, color: "text-green-600" };
  }
  return { Icon: File, color: "text-blue-500" };
}

// ---------------------------------------------------------------------------
// Small display components
// ---------------------------------------------------------------------------

/** Inline image with click-to-expand lightbox */
function ImageBubble({ src }: { src: string }) {
  const [expanded, setExpanded] = useState(false);
  const backdropRef = useRef<HTMLDialogElement>(null);

  // Close on Escape key; trap focus inside the dialog while open
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the backdrop so Escape is captured consistently
    backdropRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <>
      <button
        type="button"
        className="cursor-zoom-in rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => setExpanded(true)}
        aria-label="Expand image"
      >
        <img
          src={src}
          alt=""
          className="max-w-[240px] max-h-[240px] rounded-2xl object-cover"
        />
      </button>
      {expanded && (
        // Native <dialog> satisfies useSemanticElements; we manage open state
        // ourselves (no showModal()) so the backdrop is a sibling fixed div.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        <dialog
          ref={backdropRef}
          aria-label="Image preview"
          open
          className="fixed inset-0 z-50 m-0 flex max-h-none max-w-none items-center justify-center border-0 bg-black/70 p-0 outline-none backdrop:hidden"
          onClick={() => setExpanded(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setExpanded(false);
          }}
        >
          {/* Clicking the image itself should not close the lightbox; wrap in a
              button so keyboard users can also interact with it without closing. */}
          <button
            type="button"
            className="cursor-default outline-none"
            onClick={(e) => e.stopPropagation()}
            aria-label="Image (press Escape to close)"
          >
            <img
              src={src}
              alt=""
              className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl"
            />
          </button>
        </dialog>
      )}
    </>
  );
}

/** File card: icon + filename + optional size */
function FileBubble({
  filename,
  mimeType,
  size,
}: {
  filename: string;
  mimeType: string;
  size?: number;
}) {
  const { Icon, color } = fileIconProps(mimeType);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 min-w-[180px] max-w-[260px]">
      <Icon className={cn("h-8 w-8 shrink-0", color)} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-text-primary">
          {filename}
        </p>
        {size !== undefined && (
          <p className="text-[11px] text-text-muted">{formatBytes(size)}</p>
        )}
      </div>
    </div>
  );
}

/** Pending attachment tray shown above the textarea */
function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1">
      {attachments.map((att) => (
        <div key={att.id} className="relative group">
          {att.type === "image" ? (
            <img
              src={att.previewUrl}
              alt=""
              className="h-16 w-16 rounded-xl object-cover border border-border"
            />
          ) : (
            <FileBubble
              filename={att.filename ?? "file"}
              mimeType={att.mimeType}
              size={att.size}
            />
          )}
          <button
            type="button"
            onClick={() => onRemove(att.id)}
            title={t("localChat.removeAttachment")}
            aria-label={t("localChat.removeAttachment")}
            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-text-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <img
        src={BOT_AVATAR}
        alt=""
        className="h-9 w-9 shrink-0 object-contain -ml-1"
      />
      <div className="flex items-center gap-1.5 rounded-[20px] rounded-tl-sm border border-border bg-surface-1 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Renders a friendly "No API Key" warning card instead of a raw error */
function ApiKeyWarningCard({
  t,
}: { t: ReturnType<typeof useTranslation>["t"] }) {
  return (
    <div className="flex items-start gap-3">
      <img
        src={BOT_AVATAR}
        alt=""
        className="h-9 w-9 shrink-0 object-contain -ml-1"
      />
      <div className="flex max-w-[44rem] flex-col gap-2">
        <div
          style={{
            background: "#FFF7E6",
            border: "1px solid #FFD591",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <svg
              style={{ color: "#FA8C16", width: 18, height: 18, flexShrink: 0 }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: "#431907",
              }}
            >
              {t("localChat.missingApiKey.title")}
            </span>
          </div>
          <p
            style={{
              color: "#7A4A0E",
              fontSize: 13,
              margin: "0 0 10px 26px",
              lineHeight: 1.5,
            }}
          >
            {t("localChat.missingApiKey.description")}
          </p>
          <a
            href="/workspace/settings?tab=providers"
            style={{
              display: "inline-block",
              marginLeft: 26,
              background: "#FA8C16",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: 12,
              fontWeight: 500,
              padding: "4px 12px",
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            {t("localChat.missingApiKey.goToSettings")}
          </a>
        </div>
      </div>
    </div>
  );
}

/** Renders a single chat message — supports text, images, and file cards */
function ChatBubble({
  msg,
  t,
}: { msg: ChatMsg; t: ReturnType<typeof useTranslation>["t"] }) {
  const isBot = msg.role === "assistant";
  const time = formatTs(msg.timestamp);

  // Parse content into typed blocks; apply assistant cleanup to text blocks
  const blocks = extractContent(msg).map((b) =>
    isBot && b.kind === "text" ? { ...b, text: cleanText(b.text) } : b,
  );

  const hasContent = blocks.some(
    (b) => b.kind !== "text" || b.text.trim().length > 0,
  );
  if (!hasContent) return null;

  // Detect and render the missing-API-key error as a friendly warning card
  const firstTextBlock = blocks.find((b) => b.kind === "text");
  const rawText =
    typeof firstTextBlock?.text === "string" ? firstTextBlock.text : "";
  if (isMissingApiKeyError(rawText)) {
    return <ApiKeyWarningCard t={t} />;
  }

  return (
    <div
      className={cn(
        "flex gap-3",
        isBot ? "items-start" : "flex-row-reverse items-start",
      )}
    >
      {/* Avatar */}
      {isBot ? (
        <img
          src={BOT_AVATAR}
          alt=""
          className="h-9 w-9 shrink-0 object-contain -ml-1"
        />
      ) : (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 ring-1 ring-border/50">
          <span className="text-[11px] font-semibold leading-none text-white">
            Me
          </span>
        </div>
      )}

      {/* Content column */}
      <div
        className={cn(
          "flex max-w-[44rem] flex-col gap-2",
          isBot ? "items-start" : "items-end",
        )}
      >
        {blocks.map((block, i) => {
          // Composite key: kind + index — blocks within a single message bubble
          // have no stable ids; position is the correct reconciliation boundary.
          const key = `${block.kind}-${i}`;
          if (block.kind === "image") {
            return <ImageBubble key={key} src={block.src} />;
          }
          if (block.kind === "file") {
            return (
              <FileBubble
                key={key}
                filename={block.filename}
                mimeType={block.mimeType}
                size={block.size}
              />
            );
          }
          if (!block.text.trim()) return null;
          return (
            <div
              key={key}
              className={cn(
                "inline-block max-w-full break-words rounded-[20px] px-4 py-3 text-[13px] shadow-[0_10px_24px_rgba(15,23,42,0.04)]",
                isBot
                  ? "border border-border bg-surface-1 text-text-primary rounded-tl-sm"
                  : "bg-surface-3 text-text-primary rounded-tr-sm",
              )}
            >
              <ChatMarkdown content={block.text} />
            </div>
          );
        })}
        {time && (
          <div
            className={cn(
              "text-[10px] text-text-muted",
              isBot ? "pl-1" : "pr-1 text-right",
            )}
          >
            {time}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot selector dropdown
// ---------------------------------------------------------------------------

function BotSelector({
  bots,
  selected,
  onSelect,
}: {
  bots: BotItem[];
  selected: BotItem | null;
  onSelect: (bot: BotItem) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeBots = bots.filter((b: BotItem) => b.status === "active");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors",
          "border-border bg-surface-1 text-text-primary hover:bg-surface-2",
          open && "bg-surface-2",
        )}
      >
        <Bot size={14} className="text-text-muted" />
        <span>{selected?.name ?? t("localChat.selectBot")}</span>
        <ChevronDown
          size={13}
          className={cn(
            "text-text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[180px] rounded-xl border border-border bg-surface-1 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          {activeBots.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-text-muted">
              {t("localChat.noBots")}
            </div>
          ) : (
            activeBots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => {
                  onSelect(bot);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2",
                  selected?.id === bot.id && "font-medium text-accent",
                )}
              >
                <Sparkles size={13} className="shrink-0 text-text-muted" />
                <span className="truncate">{bot.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/** Compose ContentBlock[] for an optimistic user bubble from pending state */
function buildOptimisticBlocks(
  text: string,
  atts: PendingAttachment[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (text.trim()) blocks.push({ kind: "text", text });
  for (const a of atts) {
    if (a.type === "image") {
      blocks.push({ kind: "image", src: a.previewUrl, mimeType: a.mimeType });
    } else {
      blocks.push({
        kind: "file",
        filename: a.filename ?? "file",
        mimeType: a.mimeType,
        size: a.size,
      });
    }
  }
  return blocks;
}

export function LocalChatPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [selectedBot, setSelectedBot] = useState<BotItem | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // null = history not yet loaded, [] = loaded but empty, [...] = loaded with history
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [sending, setSending] = useState(false);
  const [waitingReply, setWaitingReply] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const assistantCountRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Tracks the currently-selected bot so async effects can bail if stale.
  const contextKeyRef = useRef<string>("");
  // True while a sendMessage call is in flight — prevents the history-load
  // effect from overwriting the optimistic bubble with stale history.
  const activeSendRef = useRef(false);
  // When loading history for the first time (or after switching bot/channel),
  // snap to the bottom instantly so the user sees the latest message without
  // watching the page scroll through the whole history.  Reset to true on
  // every bot/channel switch; set to false after the first scroll fires.
  const scrollInstantRef = useRef(true);

  // Fetch bots
  const { data: botsData, isLoading: botsLoading } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data } = await getApiV1Bots();
      return data;
    },
  });
  const bots = (botsData?.bots ?? []) as BotItem[];
  const activeBots = bots.filter((b) => b.status === "active");

  // Auto-create a default bot when none exist
  const createDefaultBot = useMutation({
    mutationFn: async () => {
      const { data } = await getApiV1BotsDefault();
      return data;
    },
    onSuccess: (newBot) => {
      void queryClient.invalidateQueries({ queryKey: ["bots"] });
      setSelectedBot(newBot as BotItem);
    },
  });

  const noActiveBots = activeBots.length === 0;
  const isCreatingBot = botsLoading || createDefaultBot.isPending;
  // Only show "creating" copy when we are genuinely creating a new bot (not just loading)
  const isCreatingNewBot = createDefaultBot.isPending;
  const createError = createDefaultBot.error;
  // True when still initializing — no bot selected yet (loading bots or creating new bot)
  // OR bot selected but history not yet loaded.
  // Used to avoid flashing the empty state before messages are ready.
  const isInitializing =
    (isCreatingBot && !selectedBot) ||
    (selectedBot !== null && messages === null);

  // Automatically create a default bot when none exist
  useEffect(() => {
    if (
      noActiveBots &&
      !botsLoading &&
      !createDefaultBot.isPending &&
      !createError
    ) {
      createDefaultBot.mutate();
    }
  }, [noActiveBots, botsLoading, createDefaultBot, createError]);

  // Auto-select when there's exactly one active bot
  useEffect(() => {
    if (activeBots.length === 1 && !selectedBot && activeBots[0]) {
      setSelectedBot(activeBots[0]);
    }
  }, [activeBots, selectedBot]);

  // Auto-scroll on new messages.
  // Uses "instant" on initial history load so the page snaps to the bottom
  // without animating through the full history; subsequent scrolls (new
  // messages, typing indicator) use "smooth" for a natural feel.
  //
  // IMPORTANT: do NOT consume the instant-scroll token when the message list
  // is still empty (the effect fires once on mount before history arrives).
  // Consuming it early would cause the history load scroll to use "smooth"
  // and scroll from top to bottom visibly.
  useEffect(() => {
    if (messages === null || (messages.length === 0 && !waitingReply)) return;
    const behavior = scrollInstantRef.current ? "instant" : "smooth";
    scrollInstantRef.current = false;
    endRef.current?.scrollIntoView({ behavior });
  }, [messages, waitingReply]);

  // ── Polling for AI reply ──────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setWaitingReply(false);
  }, []);

  const startPolling = useCallback(
    (botId: string, baselineAssistantCount: number) => {
      stopPolling();
      assistantCountRef.current = baselineAssistantCount;
      setWaitingReply(true);
      let attempts = 0;
      // Tracks the latest message-array length so we can flush UI updates on
      // every change — an agent turn typically writes many messages
      // (thinking → toolCall → … → final text) and the user must see ALL
      // of them, especially the terminal text.
      let lastSeenTotal = -1;
      // Terminal detection is only valid AFTER we've observed a new
      // assistant message in this turn.  Without this guard, any follow-up
      // message to a conversation that already ended on an assistant text
      // reply would match `isAssistantTextReply(lastMsg)` on the very first
      // poll (before OpenClaw has even written the user's new entry) and
      // kill polling immediately — the user's new turn would never get
      // picked up.  `firstNewAssistantSeen` ensures we only bail out on
      // text replies *produced during this turn*.
      let firstNewAssistantSeen = false;
      pollingRef.current = setInterval(async () => {
        attempts++;
        try {
          const { data } = await getApiV1ChatHistory({
            query: { botId, limit: 500 },
          });
          const latest = ((data as Record<string, unknown>)?.messages ??
            []) as ChatMsg[];

          if (latest.length !== lastSeenTotal) {
            lastSeenTotal = latest.length;
            const newAssistantCount = latest.filter(
              (m) => m.role === "assistant",
            ).length;
            if (newAssistantCount > assistantCountRef.current) {
              assistantCountRef.current = newAssistantCount;
              firstNewAssistantSeen = true;
              setMessages(latest);
              void queryClient.invalidateQueries({
                queryKey: ["sidebar-sessions"],
              });
            }
          }

          // Terminal signal: after at least one new assistant message has
          // shown up this turn, the very last entry in history is an
          // `assistant` message with actual text content and no pending
          // tool call.  OpenClaw always closes a successful turn with
          // exactly this shape; stopping immediately keeps the typing
          // indicator from lingering after the reply is rendered.
          if (firstNewAssistantSeen) {
            const lastMsg = latest[latest.length - 1];
            if (lastMsg && isAssistantTextReply(lastMsg)) {
              stopPolling();
              return;
            }
          }
        } catch {
          // swallow polling errors
        }
        if (attempts >= POLL_MAX_ATTEMPTS) stopPolling();
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, queryClient],
  );

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Session discovery: load full history when the bot changes ───────────
  // Calls the aggregated history endpoint which transparently spans all
  // compacted sessions — the user always sees one continuous conversation.

  useEffect(() => {
    if (!selectedBot) return;

    const botId = selectedBot.id;
    const ctxKey = botId;
    contextKeyRef.current = ctxKey;

    void (async () => {
      try {
        const { data: histData } = await getApiV1ChatHistory({
          query: { botId, limit: 500 },
        });
        if (contextKeyRef.current !== ctxKey) return;
        if (activeSendRef.current) return;

        const msgs = ((histData as Record<string, unknown>)?.messages ??
          []) as ChatMsg[];
        setMessages(msgs);
        assistantCountRef.current = msgs.filter(
          (m) => m.role === "assistant",
        ).length;

        const { data: sessionData } = await getApiV1ChatSession({
          query: { botId, sessionKey: buildMainSessionKey(botId) },
        });
        if (contextKeyRef.current !== ctxKey) return;
        const sid = sessionData?.session?.id;
        if (sid) setSessionId(sid);
      } catch {
        // silently ignore — session simply doesn't exist yet
      }
    })();
  }, [selectedBot]);

  // ── Bot selection ─────────────────────────────────────────────────────────

  const handleSelectBot = useCallback(
    (bot: BotItem) => {
      scrollInstantRef.current = true;
      setSelectedBot(bot);
      setSessionId(null);
      setMessages(null);
      setPendingAttachments([]);
      stopPolling();
    },
    [stopPolling],
  );

  // ── Attachment helpers ────────────────────────────────────────────────────

  const addAttachment = useCallback((att: Omit<PendingAttachment, "id">) => {
    setPendingAttachments((prev) => [
      ...prev,
      { ...att, id: crypto.randomUUID() },
    ]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (
      msgContent: {
        type: "text" | "image" | "file";
        content: string;
        metadata?: { mimeType?: string; filename?: string; size?: number };
        /**
         * Images AND files share this array.  The controller splits them:
         * images → OpenClaw chat.send attachments pipeline, files → server-
         * side extraction + `<file>…</file>` fold-in.
         */
        attachments?: Array<{
          type: "image" | "file";
          content: string;
          metadata?: { mimeType?: string; filename?: string; size?: number };
        }>;
      },
      optimisticBlocks: ContentBlock[],
    ) => {
      if (!selectedBot) return;

      const botId = selectedBot.id;
      const ctxKey = botId;
      const mainSessionKey = buildMainSessionKey(botId);

      // Mark send as active BEFORE the optimistic update so the history-load
      // effect cannot overwrite the optimistic bubble if it fires concurrently.
      activeSendRef.current = true;

      // 1. Optimistic user bubble — shows immediately in the chat
      const optimisticMsg: ChatMsg = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        // Store the pre-built ContentBlock[] as content so ChatBubble can render
        // images and files correctly before the real message arrives from history.
        content: optimisticBlocks,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...(prev ?? []), optimisticMsg]);
      setSending(true);
      // Show typing indicator straight away so the user knows the AI is working
      setWaitingReply(true);

      try {
        // 2. Fire the chat.send — this may return quickly (OpenClaw queues the
        //    message) or after the full AI round-trip, depending on version.
        await postApiV1ChatLocal({
          body: {
            botId,
            sessionKey: mainSessionKey,
            message: {
              type: msgContent.type,
              content: msgContent.content,
              metadata: msgContent.metadata,
              attachments: msgContent.attachments,
            },
          },
        });

        setSending(false);

        if (contextKeyRef.current !== ctxKey) return;

        // 3. Discover the session with retries — OpenClaw writes sessions.json
        //    asynchronously, so we poll until it appears (≤ 3 s).
        //    Always look up the main session key: local chat.send always targets
        //    agent:{botId}:main regardless of which channel the selector shows.
        let sid = sessionId;
        if (!sid) {
          for (
            let attempt = 0;
            attempt < SESSION_DISCOVERY_MAX_ATTEMPTS;
            attempt++
          ) {
            if (attempt > 0) {
              await new Promise((r) =>
                setTimeout(r, SESSION_DISCOVERY_INTERVAL_MS),
              );
            }
            if (contextKeyRef.current !== ctxKey) return;
            try {
              const { data: sessionData } = await getApiV1ChatSession({
                query: { botId, sessionKey: mainSessionKey },
              });
              const found = sessionData?.session?.id;
              if (found) {
                sid = found;
                setSessionId(found);
                break;
              }
            } catch {
              // retry
            }
          }
        }

        if (!sid) {
          // Could not discover session — keep optimistic, drop waitingReply
          setWaitingReply(false);
          return;
        }

        // 4. Kick off polling so the optimistic bubble stays visible until the
        //    AI reply arrives.  Do NOT fetch and replace messages here — that
        //    would overwrite the optimistic with stale history because OpenClaw
        //    may not have written the new user message to disk yet.
        //    assistantCountRef.current is already up-to-date from the last
        //    history load or polling cycle, so polling will correctly detect
        //    the first new assistant message.
        startPolling(botId, assistantCountRef.current);
      } catch {
        setSending(false);
        setWaitingReply(false);
        setMessages((prev) =>
          (prev ?? []).filter((m) => m.id !== optimisticMsg.id),
        );
      } finally {
        activeSendRef.current = false;
      }
    },
    [selectedBot, sessionId, startPolling],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    const atts = pendingAttachments;
    if ((!text && atts.length === 0) || sending || waitingReply || !selectedBot)
      return;

    setInput("");
    setPendingAttachments([]);

    const optimisticBlocks = buildOptimisticBlocks(text, atts);

    // Transport model: hand the attachments to the controller verbatim.
    // The controller then:
    //   - Forwards images through OpenClaw's chat.send attachments pipeline.
    //   - Extracts file content (PDF / text-readable) and folds it into the
    //     message body as <file>…</file> blocks; unsupported / binary files
    //     degrade to a `[附件: filename]` marker.
    // Legacy single-image fast path: one image with no text, no other files.
    const onlyImage = atts[0];
    if (atts.length === 1 && onlyImage?.type === "image" && !text) {
      await sendMessage(
        {
          type: "image",
          content: onlyImage.content,
          metadata: { mimeType: onlyImage.mimeType },
        },
        optimisticBlocks,
      );
      return;
    }

    await sendMessage(
      {
        type: "text",
        content: text,
        attachments:
          atts.length > 0
            ? atts.map((a) => ({
                type: a.type,
                content: a.content,
                metadata: {
                  mimeType: a.mimeType,
                  filename: a.filename,
                  size: a.size,
                },
              }))
            : undefined,
      },
      optimisticBlocks,
    );
  }, [
    input,
    pendingAttachments,
    sending,
    waitingReply,
    selectedBot,
    sendMessage,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // ── File / paste handling ─────────────────────────────────────────────────

  /**
   * Read a Blob/File and push it into pendingAttachments.
   *
   * All files (images, PDFs, text-readable) travel as pure base64 in
   * `content`.  The controller decides how to handle each type:
   *   - Images      → forwarded to OpenClaw's chat.send attachment pipeline.
   *   - PDF / text  → text extracted server-side and folded into the prompt
   *                   as a `<file>…</file>` block.
   *   - Unsupported → falls back to a neutral `[附件: filename]` marker so
   *                   the user still sees the card.
   */
  const readFileBlob = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(
          `File "${file.name}" is too large (${formatBytes(file.size)}). Maximum allowed size is ${formatBytes(MAX_FILE_BYTES)}.`,
        );
        return;
      }
      const isImage = file.type.startsWith("image/");

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = extractBase64FromDataUrl(dataUrl);
        addAttachment({
          type: isImage ? "image" : "file",
          previewUrl: dataUrl,
          content: base64,
          mimeType: file.type || "application/octet-stream",
          filename: file.name,
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    },
    [addAttachment],
  );

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileBlob(file);
      e.target.value = "";
    },
    [readFileBlob],
  );

  /** Capture clipboard image paste anywhere inside the input container */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      // Don't queue attachments while waiting for a reply or when no bot is selected
      if (!selectedBot || waitingReply) return;
      const imageItem = Array.from(e.clipboardData.items).find((i) =>
        i.type.startsWith("image/"),
      );
      if (!imageItem) return;
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      if (blob.size > MAX_FILE_BYTES) {
        toast.error(
          `Pasted image is too large (${formatBytes(blob.size)}). Maximum allowed size is ${formatBytes(MAX_FILE_BYTES)}.`,
        );
        return;
      }
      // Read the blob directly — no need to wrap in File constructor
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        addAttachment({
          type: "image",
          previewUrl: dataUrl,
          content: extractBase64FromDataUrl(dataUrl), // pure base64
          mimeType: blob.type || "image/png",
          filename: `pasted-image-${Date.now()}.png`,
          size: blob.size,
        });
      };
      reader.readAsDataURL(blob);
    },
    [addAttachment, selectedBot, waitingReply],
  );

  const canSend =
    !!selectedBot &&
    !sending &&
    !waitingReply &&
    !isCreatingBot &&
    (input.trim().length > 0 || pendingAttachments.length > 0);

  const placeholder = createError
    ? t("localChat.createDefaultBotError")
    : isCreatingBot
      ? t("localChat.creatingDefaultBot")
      : !selectedBot
        ? t("localChat.selectBotFirst")
        : waitingReply
          ? t("localChat.waiting")
          : t("localChat.inputPlaceholder");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4 md:pt-12">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-text-heading">
              {t("localChat.title")}
            </h1>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {t("localChat.subtitle")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {createError ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-red-500">
                  {t("localChat.createDefaultBotError")}
                </span>
                <button
                  type="button"
                  onClick={() => createDefaultBot.mutate()}
                  className="text-[12px] text-accent underline"
                >
                  {t("localChat.retryCreateBot")}
                </button>
              </div>
            ) : isCreatingBot ? (
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-text-muted" />
                {isCreatingNewBot && (
                  <span className="text-[12px] text-text-muted">
                    {t("localChat.creatingDefaultBot")}
                  </span>
                )}
              </div>
            ) : (
              <BotSelector
                bots={bots}
                selected={selectedBot}
                onSelect={handleSelectBot}
              />
            )}
          </div>
        </div>
      </div>

      {/* Message list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isInitializing ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        ) : (messages === null || messages.length === 0) && !waitingReply ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
                <Sparkles className="h-7 w-7 text-text-muted" />
              </div>
              <div>
                {createError ? (
                  <>
                    <p className="text-[14px] font-medium text-red-500">
                      {t("localChat.createDefaultBotError")}
                    </p>
                    <p className="mt-1 text-[12px] text-text-muted">
                      {t("localChat.retryCreateBot")}
                    </p>
                  </>
                ) : isCreatingNewBot ? (
                  <>
                    <p className="text-[14px] font-medium text-text-primary">
                      {t("localChat.creatingDefaultBot")}
                    </p>
                    <p className="mt-1 text-[12px] text-text-muted">
                      {t("localChat.emptyHint")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[14px] font-medium text-text-primary">
                      {selectedBot
                        ? t("localChat.startChat", { name: selectedBot.name })
                        : t("localChat.pickBot")}
                    </p>
                    <p className="mt-1 text-[12px] text-text-muted">
                      {t("localChat.emptyHint")}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-8 sm:px-6">
            <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">
              {/* biome-ignore lint/style/noNonNullAssertion: messages is guaranteed non-null in this branch */}
              {messages!.map((msg) => (
                <ChatBubble key={msg.id} msg={msg} t={t} />
              ))}
              {waitingReply && <TypingIndicator />}
              <div ref={endRef} />
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border bg-surface-1 px-4 py-4">
        <div className="mx-auto flex w-full max-w-[920px] items-center gap-2">
          {/* Input container: attachment tray + textarea row */}
          <div
            className="flex min-h-[44px] flex-1 flex-col rounded-2xl border border-border bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)] focus-within:border-accent/60 focus-within:shadow-[0_2px_12px_rgba(15,23,42,0.08)]"
            onPaste={handlePaste}
          >
            {pendingAttachments.length > 0 && (
              <AttachmentTray
                attachments={pendingAttachments}
                onRemove={removeAttachment}
              />
            )}
            <div className="flex items-center px-3 py-2.5">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={!selectedBot || waitingReply || isCreatingBot}
                rows={1}
                className="flex-1 resize-none bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none disabled:cursor-not-allowed"
                style={{ maxHeight: "120px", overflowY: "auto" }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={
                  !selectedBot || sending || waitingReply || isCreatingBot
                }
                className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                title={t("localChat.attachFile")}
              >
                <Paperclip size={15} />
              </button>
            </div>
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
              canSend
                ? "bg-accent text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-accent/90"
                : "bg-surface-3 text-text-muted cursor-not-allowed",
            )}
          >
            <Send size={16} />
          </button>
        </div>

        {/* Hidden file input — accepts images and common documents */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}
