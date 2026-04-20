/**
 * attachment-store.ts
 *
 * Persists webchat-uploaded attachments to a filesystem path that OpenClaw's
 * on-demand media tools (pdf, image, web-fetch, …) can resolve via their
 * built-in local-roots policy.
 *
 * Why disk-backed, not just inline base64?
 * -----------------------------------------
 * OpenClaw's chat.send RPC drops non-image attachments at the gateway, so
 * base64 file content can't ride the request.  Meanwhile OpenClaw's `pdf`
 * tool is a *sub-agent* style helper: give it a path + a prompt, it runs its
 * own model call in isolation and returns only a short text answer — the
 * full PDF content never enters the main conversation context.  That is
 * exactly the behaviour we want for large documents.
 *
 * OpenClaw's media-tool path policy (`getDefaultMediaLocalRoots` in
 * `dist/local-roots-*.js`) allows anything under
 *   <state-dir>/media/, <state-dir>/agents/, <state-dir>/workspace/,
 *   <state-dir>/sandboxes/, or the preferred tmp dir.
 * We pick `<state-dir>/agents/<botId>/attachments/<sessionKey>/…` so every
 * attachment is scoped to the owning bot+session and stays inside an
 * already-trusted root.
 *
 * Lifecycle
 * ---------
 * A startup sweep (`cleanupExpired`) deletes attachments older than the
 * configured TTL.  We deliberately do not tie lifetime to "session ended"
 * because webchat sessions have no clean end signal and the agent may still
 * reference the file via tool calls for follow-up questions.
 */

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../lib/logger.js";

/**
 * Seven days.  Long enough for a user to ask follow-up questions about an
 * uploaded doc across a lunch break, short enough to keep disk usage sane.
 * If you need longer, move to per-attachment TTL stored alongside the file.
 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard cap on raw file size, matching the extractor. */
const MAX_ATTACHMENT_BYTES = 5_000_000;

export interface SaveAttachmentInput {
  botId: string;
  sessionKey: string;
  /** Pure base64 (no `data:` prefix). */
  base64: string;
  filename?: string;
  mimeType: string;
}

export interface SaveAttachmentResult {
  /** Absolute path to the stored file.  Safe to hand to OpenClaw tools. */
  absolutePath: string;
  /** Sanitized filename actually used on disk (may differ from input). */
  storedFilename: string;
  /** Size in bytes of the decoded, saved file. */
  sizeBytes: number;
}

export interface AttachmentStoreOptions {
  /** Root where all attachments live; typically `env.openclawStateDir`. */
  openclawStateDir: string;
  /** Override the default 7-day expiry for testing. */
  ttlMs?: number;
}

/**
 * Normalize a bot-supplied filename into something safe to drop on disk.
 * - Strips directory separators (`/`, `\`) and null bytes.
 * - Collapses control characters and whitespace.
 * - Caps length at 128 chars so paths stay portable.
 */
function sanitizeFilename(raw: string | undefined): string {
  if (!raw) return "file";
  let stripped = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop C0 controls (0x00-0x1F) and DEL (0x7F).  Inlined as a loop so
    // biome's noControlCharactersInRegex doesn't fire on a char-class regex.
    if (code < 0x20 || code === 0x7f) continue;
    stripped += ch === "/" || ch === "\\" ? "_" : ch;
  }
  const normalized = stripped.replace(/\s+/g, " ").trim();
  if (!normalized) return "file";
  return normalized.length > 128 ? normalized.slice(0, 128) : normalized;
}

/**
 * Normalize a sessionKey (`agent:<botId>:main`) into a filesystem-safe
 * directory name: colons → underscores, lowercased.
 */
function sanitizeSessionDir(sessionKey: string): string {
  const cleaned = sessionKey.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned || "session";
}

function sanitizeBotId(botId: string): string {
  const cleaned = botId.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!cleaned) throw new Error("AttachmentStore: botId is empty");
  return cleaned;
}

function decodeBase64(data: string): Buffer | null {
  // Defensive strip of any `data:<mime>;base64,` prefix; frontend should
  // send pure base64 but the runtime check is cheap.
  const cleaned = data.includes(",") ? (data.split(",").pop() ?? data) : data;
  try {
    const buf = Buffer.from(cleaned, "base64");
    return buf.byteLength === 0 ? null : buf;
  } catch {
    return null;
  }
}

export class AttachmentStore {
  private readonly stateDir: string;
  private readonly ttlMs: number;

  constructor(options: AttachmentStoreOptions) {
    if (!options.openclawStateDir.trim()) {
      throw new Error("AttachmentStore: openclawStateDir is required");
    }
    this.stateDir = path.resolve(options.openclawStateDir);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Resolve the directory that holds attachments for a given bot+session.
   * Sits under `<stateDir>/agents/<botId>/attachments/<sessionKey>/` —
   * inside OpenClaw's trusted `agents/` root so the `pdf` / `image` tools
   * can open files without extra sandbox dance.
   */
  private attachmentsDirFor(botId: string, sessionKey: string): string {
    return path.join(
      this.stateDir,
      "agents",
      sanitizeBotId(botId),
      "attachments",
      sanitizeSessionDir(sessionKey),
    );
  }

  /** Root directory used by {@link cleanupExpired}. */
  private attachmentsRoot(): string {
    return path.join(this.stateDir, "agents");
  }

  async saveAttachment(
    input: SaveAttachmentInput,
  ): Promise<SaveAttachmentResult> {
    const buffer = decodeBase64(input.base64);
    if (!buffer) {
      throw new Error("AttachmentStore: invalid base64 payload");
    }
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `AttachmentStore: attachment exceeds ${MAX_ATTACHMENT_BYTES}B limit (${buffer.byteLength}B)`,
      );
    }

    const dir = this.attachmentsDirFor(input.botId, input.sessionKey);
    await mkdir(dir, { recursive: true });

    const safeName = sanitizeFilename(input.filename);
    // UUID prefix avoids collisions when two users upload `report.pdf`.
    const storedFilename = `${randomUUID().slice(0, 8)}-${safeName}`;
    const absolutePath = path.join(dir, storedFilename);

    await writeFile(absolutePath, buffer);

    return {
      absolutePath,
      storedFilename,
      sizeBytes: buffer.byteLength,
    };
  }

  /**
   * Walk `<stateDir>/agents/*\/attachments/` and delete any file older than
   * the configured TTL.  Runs on controller startup and is safe to call
   * concurrently with new saves — each `rm` is independent.
   *
   * Returns `{deleted, skipped}` counts for observability.
   */
  async cleanupExpired(): Promise<{ deleted: number; skipped: number }> {
    const cutoff = Date.now() - this.ttlMs;
    let deleted = 0;
    let skipped = 0;

    const root = this.attachmentsRoot();
    try {
      await access(root, fsConstants.R_OK);
    } catch {
      return { deleted: 0, skipped: 0 };
    }

    const botDirs = await readdir(root, { withFileTypes: true }).catch(
      () => [] as never[],
    );
    for (const botDirent of botDirs) {
      if (!botDirent.isDirectory()) continue;
      const attachmentsDir = path.join(root, botDirent.name, "attachments");
      const sessionDirs = await readdir(attachmentsDir, {
        withFileTypes: true,
      }).catch(() => [] as never[]);
      for (const sessionDirent of sessionDirs) {
        if (!sessionDirent.isDirectory()) continue;
        const sessionDir = path.join(attachmentsDir, sessionDirent.name);
        const entries = await readdir(sessionDir, {
          withFileTypes: true,
        }).catch(() => [] as never[]);
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const filePath = path.join(sessionDir, entry.name);
          let mtimeMs: number;
          try {
            mtimeMs = (await stat(filePath)).mtimeMs;
          } catch {
            continue;
          }
          if (mtimeMs < cutoff) {
            try {
              await rm(filePath);
              deleted += 1;
            } catch (err) {
              logger.warn(
                {
                  filePath,
                  error: err instanceof Error ? err.message : String(err),
                },
                "attachment-store: cleanup delete failed",
              );
              skipped += 1;
            }
          }
        }
      }
    }

    if (deleted > 0 || skipped > 0) {
      logger.info(
        { deleted, skipped, ttlMs: this.ttlMs, root },
        "attachment-store: cleanup complete",
      );
    }
    return { deleted, skipped };
  }
}
