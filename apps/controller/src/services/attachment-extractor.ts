/**
 * attachment-extractor.ts
 *
 * Turns user-uploaded file attachments (base64 from webchat) into plain text
 * suitable for injecting into the LLM prompt as `<file>…</file>` blocks.
 *
 * Why it exists
 * --------------
 * OpenClaw's `chat.send` gateway RPC is hardcoded to drop non-image
 * attachments at `parseMessageWithAttachments` — only images ever reach the
 * agent as structured attachments.  OpenClaw *does* have first-class file
 * ingestion (`extractFileContentFromSource`, `extractFileBlocks`) but it is
 * reached only through channel-native ingress (WeChat/Feishu MsgContext
 * with `MediaPath`).  There is no public OpenClaw export we can call from
 * the controller without reaching into bundled internals.
 *
 * So webchat gets file-content support at the controller layer: we extract
 * the text ourselves, fold it into the message body using the same
 * `<file name="…" mime="…" size="…">…</file>` envelope OpenClaw uses
 * internally, and hand the message to `chat.send` as text-only.  The
 * model sees the extracted content inline; images still travel via the
 * structured attachments array as before.
 */

import { logger } from "../lib/logger.js";

// Mirror of OpenClaw's `extractFileContentFromSource` size cap (5 MB raw).
const MAX_FILE_BYTES = 5_000_000;

/**
 * Character caps on extracted text.  Two budgets because the same code
 * serves two uses:
 *   - "full" (legacy) — inline the whole document; caller must understand
 *     it can eat a lot of main-conversation context.
 *   - "preview" (new) — snippet for the chat history only; the model is
 *     expected to call the OpenClaw `pdf` tool against the stored path
 *     for deeper queries.
 */
const MAX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_PREVIEW_TEXT_CHARS = 6_000;
const DEFAULT_PREVIEW_PDF_PAGES = 3;

/** MIME types we can safely decode as UTF-8 text without a parser. */
const TEXT_MIMES = new Set<string>([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/csv",
  "application/x-sh",
  "application/x-shellscript",
]);

function isTextMime(mime: string): boolean {
  if (!mime) return false;
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("text/")) return true;
  return TEXT_MIMES.has(normalized);
}

/**
 * PDF text streams frequently contain U+0000 (NUL) bytes and other C0
 * controls that OpenClaw's `chat.send` RPC validator rejects with
 * `INVALID_REQUEST: message must not contain null bytes`.  Strip every C0
 * control except the three whitespace forms (TAB, LF, CR) that normal text
 * legitimately uses — otherwise extracted PDF content gets the entire
 * chat.send silently dropped at the gateway.
 *
 * Inlined as a char-code loop so biome's noControlCharactersInRegex rule
 * does not need to police a character-class regex.
 */
function sanitizeForRpc(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // C0 control block 0x00-0x1F, keeping 0x09 (TAB), 0x0A (LF), 0x0D (CR).
    // Also drop DEL (0x7F).
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }
    if (code === 0x7f) continue;
    out += ch;
  }
  return out;
}

function clampText(text: string, maxChars: number): string {
  const sanitized = sanitizeForRpc(text);
  if (sanitized.length <= maxChars) return sanitized;
  return `${sanitized.slice(0, maxChars)}\n…(truncated, original length: ${sanitized.length} chars)`;
}

/**
 * Escape XML attribute values (double-quoted). Defensive escaping is cheap
 * and matches what OpenClaw's own `<file>` emitter does.
 */
function xmlEscapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n|\r|\t/g, " ");
}

/**
 * Defend against a (malicious or accidental) `</file>` substring in the
 * extracted content breaking out of our envelope.  The zero-width space
 * is invisible to the model and keeps subsequent `</file>` scanning safe.
 */
function escapeFileBlockContent(text: string): string {
  return text.replace(/<\/file>/giu, "</file\u200b>");
}

export interface AttachmentExtractInput {
  /** Pure base64 content (no `data:` prefix). */
  content: string;
  mimeType: string;
  filename?: string;
  size?: number;
  /**
   * - `full`: inline every extractable character up to 200k chars.
   * - `preview`: short snippet (first 3 PDF pages, 6k chars) — intended
   *   for route B where the caller also embeds a `path` attribute so the
   *   model can `pdf({pdf: path, pages: "..."})` into the full doc.
   *
   * Defaults to `preview` because that is the lower-risk default in terms
   * of main-conversation context consumption.
   */
  mode?: "full" | "preview";
  /**
   * Optional filesystem path where this attachment has been stored.  When
   * provided, the emitted `<file>` block includes a `path="…"` attribute
   * that OpenClaw's `pdf` / media tools can resolve.
   */
  storedPath?: string;
}

export interface AttachmentExtractSuccess {
  ok: true;
  filename: string;
  mimeType: string;
  size?: number;
  text: string;
  /** Fully-formatted `<file>…</file>` block, ready to append to the prompt. */
  block: string;
}

export interface AttachmentExtractSkip {
  ok: false;
  filename: string;
  mimeType: string;
  size?: number;
  reason:
    | "too-large"
    | "unsupported-mime"
    | "extract-failed"
    | "invalid-base64";
  message?: string;
  /** Minimal `[附件: …]` marker so the bubble still shows a file card. */
  fallbackMarker: string;
}

export type AttachmentExtractResult =
  | AttachmentExtractSuccess
  | AttachmentExtractSkip;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildFallbackMarker(
  filename: string,
  size: number | undefined,
): string {
  const sizeLabel = size != null ? ` (${formatBytes(size)})` : "";
  return `[附件: ${filename}${sizeLabel}]`;
}

function buildFileBlock(input: {
  filename: string;
  mimeType: string;
  size?: number;
  text: string;
  storedPath?: string;
  truncated?: boolean;
}): string {
  const sizeAttr = input.size != null ? ` size="${input.size}"` : "";
  const pathAttr = input.storedPath
    ? ` path="${xmlEscapeAttr(input.storedPath)}"`
    : "";
  const truncatedSuffix = input.truncated
    ? "\n\n…(preview only — use the `pdf` tool with the `path` above to read other pages)"
    : "";
  return `<file name="${xmlEscapeAttr(input.filename)}" mime="${xmlEscapeAttr(input.mimeType)}"${sizeAttr}${pathAttr}>\n${escapeFileBlockContent(input.text + truncatedSuffix)}\n</file>`;
}

async function decodeBase64(content: string): Promise<Buffer | null> {
  try {
    // Strip any leading `data:...;base64,` prefix defensively; the frontend
    // is supposed to send pure base64 but the Buffer API is lenient anyway.
    const cleaned = content.includes(",")
      ? (content.split(",").pop() ?? content)
      : content;
    const buf = Buffer.from(cleaned, "base64");
    if (buf.byteLength === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

async function extractPdfText(
  buffer: Buffer,
  opts: { maxPages?: number },
): Promise<string> {
  // Import lazily so controller boot isn't paying the pdfjs-dist init cost
  // when no PDF has ever been uploaded.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
  });
  try {
    const result = await parser.getText(
      opts.maxPages != null ? { first: opts.maxPages } : undefined,
    );
    return result.text ?? "";
  } finally {
    // Release pdfjs-dist worker/resources for this document.
    await parser.destroy().catch(() => {
      /* best-effort cleanup */
    });
  }
}

/**
 * Extract text content from a single uploaded attachment.
 *
 * Returns a success shape with a pre-formatted `<file>` block when the file
 * is a supported type (PDF, text-readable MIME) and extraction yields text.
 * Otherwise returns a skip shape with a fallback `[附件: filename]` marker so
 * the caller can still present *something* to the user and the model.
 */
export async function extractAttachmentText(
  input: AttachmentExtractInput,
): Promise<AttachmentExtractResult> {
  const filename = input.filename?.trim() || "file";
  const mimeType = input.mimeType || "application/octet-stream";
  const size = input.size;
  const fallbackMarker = buildFallbackMarker(filename, size);
  const mode = input.mode ?? "preview";
  const textBudget =
    mode === "preview" ? MAX_PREVIEW_TEXT_CHARS : MAX_EXTRACTED_TEXT_CHARS;

  if (size != null && size > MAX_FILE_BYTES) {
    return {
      ok: false,
      filename,
      mimeType,
      size,
      reason: "too-large",
      message: `file exceeds ${formatBytes(MAX_FILE_BYTES)} limit`,
      fallbackMarker,
    };
  }

  const buffer = await decodeBase64(input.content);
  if (!buffer) {
    return {
      ok: false,
      filename,
      mimeType,
      size,
      reason: "invalid-base64",
      fallbackMarker,
    };
  }
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      filename,
      mimeType,
      size: buffer.byteLength,
      reason: "too-large",
      message: `file exceeds ${formatBytes(MAX_FILE_BYTES)} limit after decode`,
      fallbackMarker,
    };
  }

  const normalizedMime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  try {
    if (normalizedMime === "application/pdf") {
      const raw = await extractPdfText(buffer, {
        maxPages: mode === "preview" ? DEFAULT_PREVIEW_PDF_PAGES : undefined,
      });
      const fullLen = raw.length;
      const text = clampText(raw.trim(), textBudget);
      if (!text) {
        return {
          ok: false,
          filename,
          mimeType,
          size,
          reason: "extract-failed",
          message: "PDF contains no extractable text (likely scanned image)",
          fallbackMarker,
        };
      }
      // In preview mode we always annotate truncation when we have a path
      // to fall back to — lets the model know it should reach for the
      // pdf tool instead of inventing content from the snippet.
      const truncated =
        mode === "preview" &&
        Boolean(input.storedPath) &&
        (fullLen > textBudget || raw.length > text.length);
      return {
        ok: true,
        filename,
        mimeType,
        size,
        text,
        block: buildFileBlock({
          filename,
          mimeType,
          size,
          text,
          storedPath: input.storedPath,
          truncated,
        }),
      };
    }

    if (isTextMime(normalizedMime)) {
      const decoded = buffer.toString("utf8");
      const fullLen = decoded.length;
      const text = clampText(decoded.trim(), textBudget);
      if (!text) {
        return {
          ok: false,
          filename,
          mimeType,
          size,
          reason: "extract-failed",
          message: "file body is empty after UTF-8 decode",
          fallbackMarker,
        };
      }
      const truncated =
        mode === "preview" && Boolean(input.storedPath) && fullLen > textBudget;
      return {
        ok: true,
        filename,
        mimeType,
        size,
        text,
        block: buildFileBlock({
          filename,
          mimeType,
          size,
          text,
          storedPath: input.storedPath,
          truncated,
        }),
      };
    }

    return {
      ok: false,
      filename,
      mimeType,
      size,
      reason: "unsupported-mime",
      message: `no extractor registered for ${normalizedMime || "unknown MIME"}`,
      fallbackMarker,
    };
  } catch (err) {
    logger.warn(
      {
        filename,
        mimeType,
        size,
        error: err instanceof Error ? err.message : String(err),
      },
      "attachment-extractor: extraction threw",
    );
    return {
      ok: false,
      filename,
      mimeType,
      size,
      reason: "extract-failed",
      message: err instanceof Error ? err.message : String(err),
      fallbackMarker,
    };
  }
}
