import type { Dirent } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  CreateSessionInput,
  SessionResponse,
  UpdateSessionInput,
} from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
};

type SessionMetadata = {
  title?: string;
  channelType?: string | null;
  channelId?: string | null;
  status?: string;
  messageCount?: number;
  lastMessageAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

type SessionMetadataRecord = Record<string, unknown>;
type NormalizedTextPart = {
  type: "text" | "replyContext";
  text: string;
};
type SanitizedUserMessageText = {
  text: string;
  replyContext: string | null;
};
type SessionHints = {
  senderName?: string;
  channelType?: string;
  metadata?: SessionMetadataRecord;
  feishuMessageId?: string;
};
type ControllerConfigRecord = {
  channels?: Array<{
    id?: string;
    botId?: string;
    channelType?: string;
  }>;
  secrets?: Record<string, string>;
};

const UUID_LIKE_TITLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEISHU_MENTION_TAGS_SYSTEM_LINE =
  /\n*\[System: The content may include mention tags in the form <at user_id="[^"]+">[^<]+<\/at>\. Treat these as real mentions of Feishu entities \(users or bots\)\.\]\s*$/u;
const FEISHU_SELF_MENTION_SYSTEM_LINE =
  /\n*\[System: If user_id is "[^"]+", that mention refers to you\.\]\s*$/u;

function sessionMetadataPath(filePath: string): string {
  return filePath.replace(/\.jsonl$/, ".meta.json");
}

export class SessionsRuntime {
  private readonly feishuTokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly env: ControllerEnv) {}

  async listSessions(): Promise<SessionResponse[]> {
    const agentsDir = path.join(this.env.openclawStateDir, "agents");

    try {
      const agentEntries = await readdir(agentsDir, { withFileTypes: true });
      const sessions: SessionResponse[] = [];

      for (const agentEntry of agentEntries) {
        if (!agentEntry.isDirectory()) {
          continue;
        }

        const sessionsDir = path.join(agentsDir, agentEntry.name, "sessions");
        let files: Dirent[];
        try {
          files = await readdir(sessionsDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".jsonl")) {
            continue;
          }

          const filePath = path.join(sessionsDir, file.name);
          const metadata = await stat(filePath);
          let extra = await this.readSessionMetadata(filePath);
          const sessionKey = file.name.replace(/\.jsonl$/, "");

          // Read the first user message metadata block and backfill exact
          // Feishu chat targets for existing sessions without touching
          // OpenClaw's transcript writer.
          const hints = await this.inferSessionHints(filePath);
          const resolvedHintMetadata = await this.resolveExactChatMetadata(
            agentEntry.name,
            extra.metadata,
            hints,
          );

          let { title, channelType } = extra;
          if (!channelType && hints.channelType) {
            channelType = hints.channelType;
          }
          if (
            this.shouldReplaceInferredTitle(title, sessionKey) &&
            hints.senderName
          ) {
            title =
              channelType === "openclaw-weixin"
                ? hints.senderName
                : channelType
                  ? `${hints.senderName} · ${channelType}`
                  : hints.senderName;
          }
          if (
            this.shouldReplaceInferredTitle(title, sessionKey) &&
            channelType === "openclaw-weixin"
          ) {
            title = "WeChat ClawBot";
          }

          const { metadata: mergedMetadata, changed: metadataBackfilled } =
            this.mergeSessionMetadata(extra.metadata, resolvedHintMetadata);
          const titleInferred =
            title !== extra.title && typeof title === "string";
          const channelTypeInferred =
            channelType !== extra.channelType &&
            typeof channelType === "string";
          if (metadataBackfilled || titleInferred || channelTypeInferred) {
            extra = {
              ...extra,
              title,
              channelType,
              metadata: mergedMetadata,
            };
            await this.writeSessionMetadata(filePath, extra);
          }

          // Read actual messages from .jsonl to get accurate count and
          // last-message timestamp (OpenClaw writes directly to .jsonl and
          // never updates .meta.json counters).
          const messages = await this.readMessages(
            filePath,
            Number.POSITIVE_INFINITY,
            channelType,
          );
          const lastMsg = messages.at(-1);

          sessions.push({
            id: file.name,
            botId: agentEntry.name,
            sessionKey,
            channelType: channelType ?? null,
            channelId: extra.channelId ?? null,
            title: title ?? sessionKey,
            status: extra.status ?? "active",
            messageCount: messages.length,
            lastMessageAt: lastMsg?.createdAt ?? metadata.mtime.toISOString(),
            metadata: this.buildPublicMetadata(filePath, extra.metadata),
            createdAt: extra.createdAt ?? metadata.birthtime.toISOString(),
            updatedAt: extra.updatedAt ?? metadata.mtime.toISOString(),
          });
        }
      }

      return sessions.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    } catch {
      return [];
    }
  }

  async createOrUpdateSession(
    input: CreateSessionInput,
  ): Promise<SessionResponse> {
    const filePath = this.getSessionFilePath(input.botId, input.sessionKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await stat(filePath);
    } catch {
      await writeFile(filePath, "", "utf8");
    }

    const now = new Date().toISOString();
    const existing = await this.readSessionMetadata(filePath);
    await this.writeSessionMetadata(filePath, {
      ...existing,
      title: input.title,
      channelType: input.channelType ?? null,
      channelId: input.channelId ?? null,
      status: input.status ?? existing.status ?? "active",
      messageCount: input.messageCount ?? existing.messageCount ?? 0,
      lastMessageAt: input.lastMessageAt ?? existing.lastMessageAt ?? now,
      metadata: input.metadata ?? existing.metadata ?? null,
      createdAt: existing.createdAt ?? now,
      updatedAt: now,
    });

    const session = await this.getSessionByKey(input.botId, input.sessionKey);
    if (!session) {
      throw new Error("Failed to create or update session");
    }
    return session;
  }

  async updateSession(
    id: string,
    input: UpdateSessionInput,
  ): Promise<SessionResponse | null> {
    const session = await this.getSession(id);
    if (!session) {
      return null;
    }
    const filePath = this.getSessionFilePath(session.botId, session.sessionKey);
    const existing = await this.readSessionMetadata(filePath);
    const now = new Date().toISOString();
    await this.writeSessionMetadata(filePath, {
      ...existing,
      title: input.title ?? existing.title ?? session.title,
      status: input.status ?? existing.status ?? session.status,
      messageCount:
        input.messageCount ?? existing.messageCount ?? session.messageCount,
      lastMessageAt:
        input.lastMessageAt ?? existing.lastMessageAt ?? session.lastMessageAt,
      metadata: input.metadata ?? existing.metadata ?? session.metadata,
      channelType: existing.channelType ?? session.channelType,
      channelId: existing.channelId ?? session.channelId,
      createdAt: existing.createdAt ?? session.createdAt,
      updatedAt: now,
    });
    return this.getSession(id);
  }

  async resetSession(id: string): Promise<SessionResponse | null> {
    const session = await this.getSession(id);
    if (!session) {
      return null;
    }
    const filePath = this.getSessionFilePath(session.botId, session.sessionKey);
    await truncate(filePath, 0);
    const now = new Date().toISOString();
    const existing = await this.readSessionMetadata(filePath);
    await this.writeSessionMetadata(filePath, {
      ...existing,
      messageCount: 0,
      lastMessageAt: null,
      updatedAt: now,
    });
    return this.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const session = await this.getSession(id);
    if (!session) {
      return false;
    }
    const filePath = this.getSessionFilePath(session.botId, session.sessionKey);
    await rm(filePath, { force: true });
    await rm(sessionMetadataPath(filePath), { force: true });
    return true;
  }

  async getChatHistory(
    id: string,
    limit?: number,
  ): Promise<{ messages: ChatMessage[]; sessionKey: string | null }> {
    const session = await this.getSession(id);
    if (!session) {
      return { messages: [], sessionKey: null };
    }
    const filePath = this.getSessionFilePath(session.botId, session.sessionKey);
    return {
      messages: await this.readMessages(
        filePath,
        limit ?? 200,
        session.channelType,
      ),
      sessionKey: session.sessionKey,
    };
  }

  private async readMessages(
    filePath: string,
    limit: number,
    channelType?: string | null,
  ): Promise<ChatMessage[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return [];
    }

    const messages: ChatMessage[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          id?: string;
          timestamp?: string;
          message?: {
            role?: string;
            content?: unknown;
            timestamp?: number;
          };
        };
        if (entry.type !== "message" || !entry.message) continue;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;
        const normalizedMessage = this.normalizeChatMessage(
          {
            id: entry.id ?? "",
            role,
            content: entry.message.content,
            timestamp: entry.message.timestamp ?? null,
            createdAt: entry.timestamp ?? null,
          },
          channelType,
        );
        if (normalizedMessage) {
          messages.push(normalizedMessage);
        }
      } catch {
        // skip malformed lines
      }
    }

    // Return last N messages
    return messages.slice(-limit);
  }

  private normalizeChatMessage(
    message: ChatMessage,
    channelType?: string | null,
  ): ChatMessage | null {
    const content = this.normalizeMessageContent(
      message.role,
      message.content,
      channelType,
    );
    if (content == null) {
      return null;
    }

    return {
      ...message,
      content,
    };
  }

  private normalizeMessageContent(
    role: ChatMessage["role"],
    content: unknown,
    channelType?: string | null,
  ): unknown | null {
    if (typeof content === "string") {
      const normalizedParts = this.normalizeTextParts(
        role,
        content,
        channelType,
      );
      if (normalizedParts.length === 0) {
        return null;
      }

      if (normalizedParts.length === 1 && normalizedParts[0]?.type === "text") {
        return normalizedParts[0].text;
      }

      return normalizedParts;
    }

    if (!Array.isArray(content)) {
      return content;
    }

    const normalizedBlocks: Array<Record<string, unknown>> = [];
    let hasVisibleContent = false;

    for (const part of content) {
      if (typeof part !== "object" || part === null) {
        continue;
      }

      const block = part as Record<string, unknown>;
      const blockType = typeof block.type === "string" ? block.type : null;

      if (blockType === "thinking") {
        continue;
      }

      if (blockType === "text") {
        const rawText = typeof block.text === "string" ? block.text : null;
        if (rawText == null) {
          continue;
        }

        const normalizedParts = this.normalizeTextParts(
          role,
          rawText,
          channelType,
        );
        if (normalizedParts.length === 0) {
          continue;
        }

        for (const normalizedPart of normalizedParts) {
          if (normalizedPart.type === "replyContext") {
            normalizedBlocks.push(normalizedPart);
            hasVisibleContent = true;
            continue;
          }

          normalizedBlocks.push({
            ...block,
            text: normalizedPart.text,
          });
          hasVisibleContent = true;
        }
        continue;
      }

      if (blockType === "replyContext") {
        const replyText =
          typeof block.text === "string" ? block.text.trim() : "";
        if (replyText.length === 0) {
          continue;
        }

        normalizedBlocks.push({
          ...block,
          text: replyText,
        });
        hasVisibleContent = true;
        continue;
      }

      if (blockType === "toolCall" || blockType === "tool_use") {
        normalizedBlocks.push(block);
        hasVisibleContent = true;
        continue;
      }

      // Preserve unknown blocks for forward compatibility, but only text,
      // replyContext, and tool blocks count as visible transcript content.
      normalizedBlocks.push(block);
    }

    return hasVisibleContent ? normalizedBlocks : null;
  }

  private normalizeTextParts(
    role: ChatMessage["role"],
    text: string,
    channelType?: string | null,
  ): NormalizedTextPart[] {
    if (role === "assistant") {
      const normalizedText = this.stripAssistantReplyPrefix(text).trim();
      return normalizedText.length > 0
        ? [{ type: "text", text: normalizedText }]
        : [];
    }

    const sanitized = this.sanitizeUserMessageText(text, channelType);
    const normalizedParts: NormalizedTextPart[] = [];

    if (sanitized.replyContext) {
      normalizedParts.push({
        type: "replyContext",
        text: sanitized.replyContext,
      });
    }
    if (sanitized.text.length > 0) {
      normalizedParts.push({
        type: "text",
        text: sanitized.text,
      });
    }

    return normalizedParts;
  }

  private sanitizeUserMessageText(
    text: string,
    channelType?: string | null,
  ): SanitizedUserMessageText {
    const replyContextFromMetadata = this.extractReplyContextFromMetadata(text);
    const withoutMetadata = this.stripTranscriptMetadataBlocks(text);
    const withoutChannelSuffix = this.stripChannelSystemSuffix(
      withoutMetadata,
      channelType,
    );

    let normalizedText = withoutChannelSuffix.trim();
    const markerMatch = withoutChannelSuffix.match(
      /\[message_id:\s*[^\]]+\](?:\n|\\n)(.+?):\s*([\s\S]*)$/,
    );
    if (markerMatch?.[2] != null) {
      normalizedText = markerMatch[2].trim();
    } else {
      const timestampMatch = withoutChannelSuffix.match(
        /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*([\s\S]*)$/,
      );
      if (timestampMatch?.[1] != null) {
        normalizedText = timestampMatch[1].trim();
      }
    }

    const extractedReplyContext = this.extractReplyContextPrefix(
      normalizedText,
      channelType,
    );

    return {
      text: extractedReplyContext.text.trim(),
      replyContext:
        replyContextFromMetadata ?? extractedReplyContext.replyContext,
    };
  }

  private stripAssistantReplyPrefix(text: string): string {
    return text.replace(/^\s*\[\[reply_to_current\]\]\s*/u, "");
  }

  private stripTranscriptMetadataBlocks(text: string): string {
    return text
      .replace(
        /Conversation info \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/gu,
        "",
      )
      .replace(
        /Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/gu,
        "",
      )
      .replace(
        /Replied message \(untrusted, for context\):\s*```json\s*[\s\S]*?```\s*/gu,
        "",
      );
  }

  private stripChannelSystemSuffix(
    text: string,
    channelType?: string | null,
  ): string {
    if (channelType?.toLowerCase() !== "feishu") {
      return text;
    }

    let normalized = text.trimEnd();
    normalized = normalized.replace(FEISHU_SELF_MENTION_SYSTEM_LINE, "");
    normalized = normalized.replace(FEISHU_MENTION_TAGS_SYSTEM_LINE, "");

    return normalized.trimEnd();
  }

  private extractReplyContextFromMetadata(text: string): string | null {
    const replyMeta = this.parseJsonMetadataBlock(
      text,
      "Replied message (untrusted, for context)",
    );
    if (!replyMeta) {
      return null;
    }

    return (
      this.readStringValue(replyMeta, "body") ??
      this.readStringValue(replyMeta, "text") ??
      this.readStringValue(replyMeta, "message") ??
      this.readStringValue(replyMeta, "title") ??
      this.readStringValue(replyMeta, "content") ??
      null
    );
  }

  private extractReplyContextPrefix(
    text: string,
    channelType?: string | null,
  ): SanitizedUserMessageText {
    const normalizedChannelType = channelType?.toLowerCase() ?? "";
    const matchers = [
      normalizedChannelType === "feishu"
        ? this.matchEnglishReplyContextPrefix(text)
        : null,
      normalizedChannelType === "openclaw-weixin" ||
      normalizedChannelType === "wechat"
        ? this.matchChineseReplyContextPrefix(text)
        : null,
      normalizedChannelType.length === 0
        ? (this.matchEnglishReplyContextPrefix(text) ??
          this.matchChineseReplyContextPrefix(text))
        : null,
    ].filter((match): match is SanitizedUserMessageText => match != null);

    return (
      matchers[0] ?? {
        text,
        replyContext: null,
      }
    );
  }

  private matchEnglishReplyContextPrefix(
    text: string,
  ): SanitizedUserMessageText | null {
    const match = text.match(
      /^\[Replying to:\s*(?:"([\s\S]*?)"|([^\]]+))\]\s*(?:(?:\r?\n)|\\n)+([\s\S]*)$/u,
    );
    const replyContext = (match?.[1] ?? match?.[2] ?? "").trim();
    const body = (match?.[3] ?? "").trim();
    if (!match || replyContext.length === 0) {
      return null;
    }

    return {
      text: body,
      replyContext,
    };
  }

  private matchChineseReplyContextPrefix(
    text: string,
  ): SanitizedUserMessageText | null {
    const match = text.match(
      /^\[引用:\s*([\s\S]*?)\]\s*(?:(?:\r?\n)|\\n)+([\s\S]*)$/u,
    );
    const replyContext = (match?.[1] ?? "").trim();
    const body = (match?.[2] ?? "").trim();
    if (!match || replyContext.length === 0) {
      return null;
    }

    return {
      text: body,
      replyContext,
    };
  }

  async getSession(id: string): Promise<SessionResponse | null> {
    const sessions = await this.listSessions();
    return sessions.find((session) => session.id === id) ?? null;
  }

  private async getSessionByKey(
    botId: string,
    sessionKey: string,
  ): Promise<SessionResponse | null> {
    const id = `${sessionKey}.jsonl`;
    const sessions = await this.listSessions();
    return (
      sessions.find(
        (session) => session.id === id && session.botId === botId,
      ) ?? null
    );
  }

  private getSessionFilePath(botId: string, sessionKey: string): string {
    return path.join(
      this.env.openclawStateDir,
      "agents",
      botId,
      "sessions",
      `${sessionKey}.jsonl`,
    );
  }

  private async readSessionMetadata(
    filePath: string,
  ): Promise<SessionMetadata> {
    try {
      const raw = await readFile(sessionMetadataPath(filePath), "utf8");
      return JSON.parse(raw) as SessionMetadata;
    } catch {
      return {};
    }
  }

  private buildPublicMetadata(
    filePath: string,
    metadata: Record<string, unknown> | null | undefined,
  ): SessionMetadataRecord {
    return {
      ...(metadata ?? {}),
      source: "openclaw-filesystem",
      path: filePath,
    };
  }

  /**
   * Read the first few KB of a JSONL file and extract sender name and
   * channel type from the first user message's "Sender (untrusted metadata)"
   * block. This avoids reading the entire (potentially large) session file.
   */
  private async inferSessionHints(filePath: string): Promise<SessionHints> {
    const READ_BYTES = 16_384; // 16 KB is enough for the first ~20 lines
    let chunk: string;
    try {
      const fh = await open(filePath, "r");
      try {
        const buf = Buffer.alloc(READ_BYTES);
        const { bytesRead } = await fh.read(buf, 0, READ_BYTES, 0);
        chunk = buf.toString("utf8", 0, bytesRead);
      } finally {
        await fh.close();
      }
    } catch {
      return {};
    }

    for (const line of chunk.split("\n")) {
      if (!line.trim()) continue;
      let entry: {
        type?: string;
        message?: { role?: string; content?: unknown };
      };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "message" || entry.message?.role !== "user") continue;

      const content = entry.message.content;
      const text = this.extractTextFromContent(content);
      if (!text) continue;

      return this.parseSessionHints(text);
    }
    return {};
  }

  private extractTextFromContent(content: unknown): string | undefined {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type: string }).type === "text" &&
          "text" in part
        ) {
          return (part as { text: string }).text;
        }
      }
    }
    return undefined;
  }

  private parseSessionHints(text: string): SessionHints {
    const senderMeta = this.parseJsonMetadataBlock(
      text,
      "Sender (untrusted metadata)",
    );
    const conversationMeta = this.parseJsonMetadataBlock(
      text,
      "Conversation info (untrusted metadata)",
    );

    const senderName =
      this.readStringValue(senderMeta, "name") ??
      this.readStringValue(senderMeta, "label") ??
      this.readStringValue(conversationMeta, "sender") ??
      undefined;

    let channelType: string | undefined;
    const combined = [
      this.readStringValue(senderMeta, "label") ?? "",
      this.readStringValue(senderMeta, "id") ?? "",
      this.readStringValue(conversationMeta, "sender_id") ?? "",
      this.readStringValue(conversationMeta, "conversation_label") ?? "",
      this.readStringValue(conversationMeta, "group_subject") ?? "",
      text,
    ]
      .join(" ")
      .toLowerCase();
    if (
      combined.includes("feishu") ||
      /\b(?:ou|oc)_[a-f0-9]{32}\b/.test(combined)
    ) {
      channelType = "feishu";
    } else if (
      combined.includes("openclaw-weixin") ||
      combined.includes("wechat")
    ) {
      channelType = "openclaw-weixin";
    } else if (combined.includes("slack")) {
      channelType = "slack";
    } else if (combined.includes("discord")) {
      channelType = "discord";
    }

    return {
      senderName,
      channelType,
      metadata: this.extractExactChatTargetMetadata(
        senderMeta,
        conversationMeta,
      ),
      feishuMessageId:
        this.readStringValue(conversationMeta, "message_id") ?? undefined,
    };
  }

  private parseJsonMetadataBlock(
    text: string,
    title: string,
  ): SessionMetadataRecord | null {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`${escapedTitle}:\\s*\`\`\`json\\s*\\n([\\s\\S]*?)\`\`\``),
    );
    const jsonBlock = match?.[1];
    if (!jsonBlock) {
      return null;
    }

    try {
      return JSON.parse(jsonBlock) as SessionMetadataRecord;
    } catch {
      return null;
    }
  }

  private shouldReplaceInferredTitle(
    title: string | undefined,
    sessionKey: string,
  ): boolean {
    if (!title) {
      return true;
    }

    const normalized = title.trim();
    if (!normalized) {
      return true;
    }

    return (
      normalized === sessionKey || UUID_LIKE_TITLE_PATTERN.test(normalized)
    );
  }

  private extractExactChatTargetMetadata(
    senderMeta: SessionMetadataRecord | null,
    conversationMeta: SessionMetadataRecord | null,
  ): SessionMetadataRecord | undefined {
    const metadata: SessionMetadataRecord = {};

    const openChatId = [
      this.readStringValue(conversationMeta, "openChatId"),
      this.readStringValue(conversationMeta, "open_chat_id"),
      this.readStringValue(conversationMeta, "chatId"),
      this.readStringValue(conversationMeta, "chat_id"),
      this.readStringValue(conversationMeta, "conversation_label"),
      this.readStringValue(conversationMeta, "group_subject"),
    ].find((value) => value?.startsWith("oc_"));
    if (openChatId) {
      metadata.openChatId = openChatId;
    }

    const openId = [
      this.readStringValue(conversationMeta, "openId"),
      this.readStringValue(conversationMeta, "open_id"),
      this.readStringValue(conversationMeta, "sender_id"),
      this.readStringValue(senderMeta, "openId"),
      this.readStringValue(senderMeta, "open_id"),
      this.readStringValue(senderMeta, "id"),
    ].find((value) => value?.startsWith("ou_"));
    if (openId) {
      metadata.openId = openId;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  private mergeSessionMetadata(
    existing: SessionMetadataRecord | null | undefined,
    inferred: SessionMetadataRecord | undefined,
  ): { metadata: SessionMetadataRecord | null; changed: boolean } {
    if (!inferred || Object.keys(inferred).length === 0) {
      return { metadata: existing ?? null, changed: false };
    }

    const merged: SessionMetadataRecord = {
      ...(existing ?? {}),
    };
    let changed = false;

    for (const [key, value] of Object.entries(inferred)) {
      const current = merged[key];
      if (typeof current === "string" && current.trim().length > 0) {
        continue;
      }
      merged[key] = value;
      changed = true;
    }

    return { metadata: merged, changed };
  }

  private async resolveExactChatMetadata(
    botId: string,
    existing: SessionMetadataRecord | null | undefined,
    hints: SessionHints,
  ): Promise<SessionMetadataRecord | undefined> {
    const existingOpenChatId =
      this.readStringValue(existing, "openChatId") ??
      this.readStringValue(existing, "open_chat_id") ??
      this.readStringValue(existing, "chatId") ??
      this.readStringValue(existing, "chat_id");
    if (existingOpenChatId?.startsWith("oc_")) {
      return hints.metadata;
    }

    const hintedOpenChatId = this.readStringValue(hints.metadata, "openChatId");
    if (hintedOpenChatId?.startsWith("oc_")) {
      return hints.metadata;
    }

    if (hints.channelType !== "feishu" || !hints.feishuMessageId) {
      return hints.metadata;
    }

    const openChatId = await this.fetchFeishuOpenChatIdByMessageId(
      botId,
      hints.feishuMessageId,
    );
    if (!openChatId) {
      return hints.metadata;
    }

    return {
      ...(hints.metadata ?? {}),
      openChatId,
    };
  }

  private async fetchFeishuOpenChatIdByMessageId(
    botId: string,
    messageId: string,
  ): Promise<string | null> {
    const credentials = await this.getFeishuCredentials(botId);
    if (!credentials) {
      return null;
    }

    const tenantToken = await this.getFeishuTenantToken(
      credentials.appId,
      credentials.appSecret,
    );
    if (!tenantToken) {
      return null;
    }

    try {
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
        {
          headers: {
            Authorization: `Bearer ${tenantToken}`,
          },
        },
      );
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        code?: number;
        data?: {
          chat_id?: string;
          message?: {
            chat_id?: string;
          };
          items?: Array<{
            chat_id?: string;
          }>;
        };
      };
      if (payload.code !== 0) {
        return null;
      }

      const openChatId =
        payload.data?.chat_id ??
        payload.data?.message?.chat_id ??
        payload.data?.items?.[0]?.chat_id;
      return typeof openChatId === "string" && openChatId.startsWith("oc_")
        ? openChatId
        : null;
    } catch {
      return null;
    }
  }

  private async getFeishuCredentials(
    botId: string,
  ): Promise<{ appId: string; appSecret: string } | null> {
    const config = await this.readControllerConfig();
    const channel = config?.channels?.find(
      (item) => item.botId === botId && item.channelType === "feishu",
    );
    if (!channel?.id) {
      return null;
    }

    const appId = config?.secrets?.[`channel:${channel.id}:appId`];
    const appSecret = config?.secrets?.[`channel:${channel.id}:appSecret`];
    if (
      typeof appId !== "string" ||
      appId.length === 0 ||
      typeof appSecret !== "string" ||
      appSecret.length === 0
    ) {
      return null;
    }

    return { appId, appSecret };
  }

  private async readControllerConfig(): Promise<ControllerConfigRecord | null> {
    try {
      const raw = await readFile(this.env.nexuConfigPath, "utf8");
      return JSON.parse(raw) as ControllerConfigRecord;
    } catch {
      return null;
    }
  }

  private async getFeishuTenantToken(
    appId: string,
    appSecret: string,
  ): Promise<string | null> {
    const cached = this.feishuTokenCache.get(appId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    try {
      const response = await fetch(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
          }),
        },
      );
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        code?: number;
        tenant_access_token?: string;
        expire?: number;
      };
      if (
        payload.code !== 0 ||
        typeof payload.tenant_access_token !== "string" ||
        payload.tenant_access_token.length === 0
      ) {
        return null;
      }

      const expiresAt =
        Date.now() + Math.max((payload.expire ?? 7200) - 60, 60) * 1000;
      this.feishuTokenCache.set(appId, {
        token: payload.tenant_access_token,
        expiresAt,
      });
      return payload.tenant_access_token;
    } catch {
      return null;
    }
  }

  private readStringValue(
    record: SessionMetadataRecord | null | undefined,
    key: string,
  ): string | null {
    if (!record) {
      return null;
    }

    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }

  private async writeSessionMetadata(
    filePath: string,
    metadata: SessionMetadata,
  ): Promise<void> {
    await writeFile(
      sessionMetadataPath(filePath),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  }
}
