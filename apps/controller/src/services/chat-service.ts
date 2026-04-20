import { logger } from "../lib/logger.js";
import {
  type AttachmentExtractResult,
  extractAttachmentText,
} from "./attachment-extractor.js";
import type { AttachmentStore } from "./attachment-store.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";

export interface LocalChatMessageMetadata {
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
  filename?: string;
  size?: number;
}

export interface LocalChatAttachment {
  /**
   * Images travel through OpenClaw's chat.send attachment pipeline unchanged.
   * Files are saved to disk + folded into the message body as `<file path="…"
   * name="…" …>preview</file>` blocks; the agent can then reach for the
   * OpenClaw `pdf` tool (sub-agent) if it needs content beyond the preview.
   */
  type: "image" | "file";
  content: string;
  metadata?: {
    mimeType?: string;
    filename?: string;
    size?: number;
  };
}

export interface LocalChatMessageInput {
  type: "text" | "image" | "video" | "audio" | "file";
  content: string;
  metadata?: LocalChatMessageMetadata;
  attachments?: LocalChatAttachment[];
}

export interface LocalChatMessageOutput {
  id: string;
  role: "user" | "assistant";
  type: "text" | "image" | "video" | "audio" | "file";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
}

export interface SendToMainSessionInput {
  botId: string;
  sessionKey: string;
  message: string;
  messageType: string;
  metadata?: LocalChatMessageMetadata;
  /** Images only — file attachments have already been folded into `message`. */
  attachments?: Array<{
    type: "image";
    content: string;
    metadata?: {
      mimeType?: string;
      filename?: string;
      size?: number;
    };
  }>;
}

export interface SendToMainSessionResult {
  messageId?: string;
  content?: unknown;
}

/**
 * ChatService
 *
 * Handles local chat messages sent directly to an agent's main session,
 * bypassing channel configurations.
 *
 * Attachment routing:
 *   - Images → forwarded verbatim via OpenClaw's chat.send attachments
 *   - Files  → persisted to `<stateDir>/agents/<botId>/attachments/<sessionKey>/`
 *             (a root OpenClaw's media tools already trust), previewed into
 *             the prompt as `<file path="…" name="…" …>snippet</file>` so the
 *             agent can invoke the `pdf` sub-agent tool against the path for
 *             follow-up queries without re-ingesting the full doc.
 *
 * This is the only place the webchat→OpenClaw attachment split lives; the
 * route handler stays purely transport-level.
 */
export class ChatService {
  constructor(
    private readonly gatewayService: OpenClawGatewayService,
    private readonly attachmentStore: AttachmentStore,
  ) {}

  /**
   * Send a local chat message to agent main session
   *
   * Message format: { type: "text" | "image" | "video" | "audio", content: string, metadata?: {...} }
   *
   * Uses OpenClaw Gateway's main session mechanism,
   * bypassing any channel configuration.
   */
  async sendLocalMessage(
    botId: string,
    message: LocalChatMessageInput,
  ): Promise<LocalChatMessageOutput> {
    // Build main session key: agent:{botId}:main
    const sessionKey = `agent:${botId}:main`;

    const incomingAttachments = message.attachments ?? [];
    const imageAttachments: LocalChatAttachment[] = [];
    const fileAttachments: LocalChatAttachment[] = [];
    for (const att of incomingAttachments) {
      if (att.type === "image") imageAttachments.push(att);
      else fileAttachments.push(att);
    }

    const fileResults: AttachmentExtractResult[] = [];
    let anyFilePersisted = false;
    if (fileAttachments.length > 0) {
      // Persist first so we have a `path` to embed in the `<file>` block.
      // Extraction runs concurrently once each file is on disk.
      const perFile = await Promise.all(
        fileAttachments.map(async (att) => {
          let storedPath: string | undefined;
          try {
            const saved = await this.attachmentStore.saveAttachment({
              botId,
              sessionKey,
              base64: att.content,
              filename: att.metadata?.filename,
              mimeType: att.metadata?.mimeType ?? "application/octet-stream",
            });
            storedPath = saved.absolutePath;
            anyFilePersisted = true;
          } catch (err) {
            logger.warn(
              {
                filename: att.metadata?.filename,
                error: err instanceof Error ? err.message : String(err),
              },
              "chat.local: attachment persistence failed; falling back to preview-only",
            );
          }
          return extractAttachmentText({
            content: att.content,
            mimeType: att.metadata?.mimeType ?? "application/octet-stream",
            filename: att.metadata?.filename,
            size: att.metadata?.size,
            mode: "preview",
            storedPath,
          });
        }),
      );
      fileResults.push(...perFile);
    }

    const appendedBlocks: string[] = [];
    for (const result of fileResults) {
      if (result.ok) {
        appendedBlocks.push(result.block);
      } else {
        appendedBlocks.push(result.fallbackMarker);
        logger.warn(
          {
            filename: result.filename,
            mimeType: result.mimeType,
            size: result.size,
            reason: result.reason,
            detail: result.message,
          },
          "chat.local: file attachment extraction skipped",
        );
      }
    }

    // Tool-use hint: tell the agent it can dispatch the `pdf` sub-agent
    // against the embedded `path` attributes instead of staying confined
    // to the inline preview text.  Only added when we actually persisted
    // at least one file — otherwise the hint would point at nothing.
    if (anyFilePersisted) {
      appendedBlocks.push(
        "[Tool hint: the <file> blocks above include a `path` attribute. " +
          "Use the `pdf` tool (pdf, pdfs, pages, prompt) with that path to " +
          "read specific pages or analyze the full document when the preview " +
          "is insufficient.]",
      );
    }

    const messageContent =
      appendedBlocks.length === 0
        ? message.content
        : [message.content, ...appendedBlocks].filter(Boolean).join("\n\n");

    logger.info(
      {
        route: "chat.sendLocalMessage",
        botId,
        sessionKey,
        messageType: message.type,
        imageAttachments: imageAttachments.length,
        fileAttachments: fileAttachments.length,
        filePersisted: fileResults.filter((r) => r.ok).length,
      },
      "sending local chat via main session",
    );

    // Send via Gateway using chat.send — queues message to agent main session.
    // Throws on failure; the route handler will propagate a 500 to the client.
    const result = await this.sendToMainSession({
      botId,
      sessionKey,
      message: messageContent,
      messageType: message.type,
      metadata: message.metadata,
      attachments: imageAttachments.map((att) => ({
        type: "image" as const,
        content: att.content,
        metadata: att.metadata,
      })),
    });

    return {
      id: result.messageId ?? `local_${Date.now()}`,
      role: "assistant",
      type: message.type,
      content: result.content ?? null,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };
  }

  private async sendToMainSession(
    input: SendToMainSessionInput,
  ): Promise<SendToMainSessionResult> {
    return this.gatewayService.sendToMainSession({
      botId: input.botId,
      sessionKey: input.sessionKey,
      message: input.message,
      messageType: input.messageType as
        | "text"
        | "image"
        | "video"
        | "audio"
        | "file",
      metadata: input.metadata as Record<string, unknown> | undefined,
      attachments: input.attachments?.map((a) => ({
        type: a.type,
        data: a.content,
        mimeType: a.metadata?.mimeType,
        filename: a.metadata?.filename,
      })),
    });
  }
}
