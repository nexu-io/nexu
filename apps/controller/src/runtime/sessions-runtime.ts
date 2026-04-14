import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  CreateSessionInput,
  SessionResponse,
  UpdateSessionInput,
} from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { proxyFetch } from "../lib/proxy-fetch.js";

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
  groupName?: string;
  channelType?: string;
  metadata?: SessionMetadataRecord;
  feishuMessageId?: string;
  qqbotPeerId?: string;
  qqbotGroupOpenid?: string;
  qqbotMessageType?: "c2c" | "group";
};
type SessionsIndexEntry = {
  sessionId?: string;
  sessionFile?: string;
  lastChannel?: string;
  origin?: {
    provider?: string;
    label?: string;
  };
};
type OpenAiUserSessionContext = {
  channel?: string;
  accountid?: string;
  chattype?: string;
  peerid?: string;
  conversationid?: string;
  sendername?: string;
  groupsubject?: string;
};
type ControllerConfigRecord = {
  channels?: Array<{
    id?: string;
    botId?: string;
    channelType?: string;
    accountId?: string;
  }>;
  secrets?: Record<string, string>;
};

type QqbotKnownUser = {
  openid: string;
  type: "c2c" | "group";
  nickname?: string;
  groupOpenid?: string;
  accountId?: string;
};

const UUID_LIKE_TITLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QQBOT_OPEN_ID_PATTERN = /^[0-9a-f]{32}$/i;
const QQBOT_TARGET_PATTERN = /^qqbot:(c2c|group):([0-9a-f-]+)$/i;
const FEISHU_MENTION_TAGS_SYSTEM_LINE =
  /\n*\[System: The content may include mention tags in the form <at user_id="[^"]+">[^<]+<\/at>\. Treat these as real mentions of Feishu entities \(users or bots\)\.\]\s*$/u;
const FEISHU_SELF_MENTION_SYSTEM_LINE =
  /\n*\[System: If user_id is "[^"]+", that mention refers to you\.\]\s*$/u;

function sessionMetadataPath(filePath: string): string {
  return filePath.replace(/\.jsonl$/, ".meta.json");
}

function abbreviateOpaqueId(value: string): string {
  return value.slice(0, 8).toUpperCase();
}

function extractQqbotOpaqueId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const targetMatch = trimmed.match(QQBOT_TARGET_PATTERN);
  if (targetMatch?.[2]) {
    return targetMatch[2];
  }

  return QQBOT_OPEN_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function normalizeQqbotDisplayName(
  value: string | undefined,
  kind: "user" | "group",
): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const targetMatch = trimmed.match(QQBOT_TARGET_PATTERN);
  if (targetMatch) {
    const targetKind =
      targetMatch[1]?.toLowerCase() === "group" ? "group" : "user";
    const opaqueId = targetMatch[2] ?? trimmed;
    return `QQ ${targetKind === "group" ? "group" : "user"} ${abbreviateOpaqueId(opaqueId)}`;
  }

  if (QQBOT_OPEN_ID_PATTERN.test(trimmed)) {
    return `QQ ${kind === "group" ? "group" : "user"} ${abbreviateOpaqueId(trimmed)}`;
  }

  return trimmed;
}

export class SessionsRuntime {
  private readonly feishuTokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();
  private qqbotKnownUsersCache: {
    filePath: string;
    mtimeMs: number;
    users: QqbotKnownUser[];
  } | null = null;

  constructor(private readonly env: ControllerEnv) {}

  async listSessions(): Promise<SessionResponse[]> {
    const agentsDir = path.join(this.env.openclawStateDir, "agents");
    const qqbotKnownUsers = await this.readQqbotKnownUsers();

    try {
      const agentEntries = await readdir(agentsDir, { withFileTypes: true });
      const sessions: SessionResponse[] = [];

      for (const agentEntry of agentEntries) {
        if (!agentEntry.isDirectory()) {
          continue;
        }

        const sessionsDir = path.join(agentsDir, agentEntry.name, "sessions");
        const sessionsIndex = await this.readSessionsIndex(sessionsDir);
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
          const transcriptHints = await this.inferSessionHints(filePath);
          const indexHints = this.inferSessionHintsFromIndex(
            sessionsIndex,
            filePath,
            sessionKey,
          );
          const hints: SessionHints = {
            senderName: transcriptHints.senderName ?? indexHints.senderName,
            groupName: transcriptHints.groupName ?? indexHints.groupName,
            channelType: transcriptHints.channelType ?? indexHints.channelType,
            metadata: transcriptHints.metadata ?? indexHints.metadata,
            feishuMessageId:
              transcriptHints.feishuMessageId ?? indexHints.feishuMessageId,
          };
          const resolvedHintMetadata = await this.resolveExactChatMetadata(
            agentEntry.name,
            extra.metadata,
            hints,
          );

          let { title, channelType } = extra;
          if (!channelType && hints.channelType) {
            channelType = hints.channelType;
          }
          const qqbotDisplayNames =
            channelType === "qqbot"
              ? this.resolveQqbotDisplayNames(hints, qqbotKnownUsers)
              : null;
          const normalizedGroupName =
            channelType === "qqbot"
              ? normalizeQqbotDisplayName(
                  qqbotDisplayNames?.groupName ?? hints.groupName,
                  "group",
                )
              : channelType === "openclaw-weixin"
                ? undefined
                : hints.groupName;
          const normalizedSenderName =
            channelType === "qqbot"
              ? normalizeQqbotDisplayName(
                  qqbotDisplayNames?.senderName ?? hints.senderName,
                  "user",
                )
              : channelType === "openclaw-weixin"
                ? // WeChat protocol exposes only an opaque @im.wechat id;
                  // skip the per-sender title and fall through to the
                  // generic "WeChat ClawBot" fallback below.
                  undefined
                : hints.senderName;
          if (this.shouldReplaceInferredTitle(title, sessionKey)) {
            if (normalizedGroupName) {
              title =
                channelType &&
                channelType !== "openclaw-weixin" &&
                channelType !== "qqbot"
                  ? `${normalizedGroupName} · ${channelType}`
                  : normalizedGroupName;
            } else if (normalizedSenderName) {
              title =
                channelType === "openclaw-weixin" || channelType === "qqbot"
                  ? normalizedSenderName
                  : channelType
                    ? `${normalizedSenderName} · ${channelType}`
                    : normalizedSenderName;
            }
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

  async getChatHistoryBySessionKey(
    botId: string,
    sessionKey: string,
    limit?: number,
  ): Promise<{ messages: ChatMessage[]; sessionKey: string | null }> {
    const session = await this.getSessionByKey(botId, sessionKey);
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

  async appendCompatTranscript(input: {
    botId: string;
    sessionKey: string;
    title: string;
    channelType: string;
    channelId?: string | null;
    metadata?: Record<string, unknown>;
    userText: string;
    assistantText: string;
    provider?: string | null;
    model?: string | null;
    api?: string | null;
  }): Promise<void> {
    const filePath = this.getSessionFilePath(input.botId, input.sessionKey);
    await mkdir(path.dirname(filePath), { recursive: true });

    let existingFile = true;
    try {
      await stat(filePath);
    } catch {
      existingFile = false;
    }

    if (!existingFile) {
      const sessionEntry = {
        type: "session",
        version: 3,
        id: input.sessionKey,
        timestamp: new Date().toISOString(),
        cwd: path.join(this.env.openclawStateDir, "agents", input.botId),
      };
      await writeFile(filePath, `${JSON.stringify(sessionEntry)}\n`, "utf8");
    }

    const nowIso = new Date().toISOString();
    const rootId = crypto.randomBytes(4).toString("hex");
    const userId = crypto.randomBytes(4).toString("hex");
    const assistantId = crypto.randomBytes(4).toString("hex");
    const transcript = [
      JSON.stringify({
        type: "message",
        id: userId,
        parentId: rootId,
        timestamp: nowIso,
        message: {
          role: "user",
          content: [{ type: "text", text: input.userText }],
          timestamp: Date.now(),
        },
      }),
      JSON.stringify({
        type: "message",
        id: assistantId,
        parentId: userId,
        timestamp: nowIso,
        message: {
          role: "assistant",
          content: [{ type: "text", text: input.assistantText }],
          ...(input.api ? { api: input.api } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.model ? { model: input.model } : {}),
          timestamp: Date.now(),
        },
      }),
    ].join("\n");
    await appendFile(filePath, `${transcript}\n`, "utf8");

    const existing = await this.readSessionMetadata(filePath);
    await this.writeSessionMetadata(filePath, {
      ...existing,
      title: input.title,
      channelType: input.channelType,
      channelId: input.channelId ?? null,
      status: "active",
      lastMessageAt: nowIso,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(input.metadata ?? {}),
      },
      createdAt: existing.createdAt ?? nowIso,
      updatedAt: nowIso,
    });
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

  private async readSessionsIndex(
    sessionsDir: string,
  ): Promise<Record<string, SessionsIndexEntry>> {
    const indexPath = path.join(sessionsDir, "sessions.json");
    try {
      const raw = await readFile(indexPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, SessionsIndexEntry>;
      return parsed;
    } catch {
      return {};
    }
  }

  private inferSessionHintsFromIndex(
    index: Record<string, SessionsIndexEntry>,
    filePath: string,
    sessionKey: string,
  ): SessionHints {
    const matched = Object.entries(index).find(([, item]) => {
      if (item.sessionId === sessionKey) {
        return true;
      }
      if (typeof item.sessionFile === "string") {
        return path.resolve(item.sessionFile) === path.resolve(filePath);
      }
      return false;
    });

    if (!matched) {
      return {};
    }

    const [indexKey, entry] = matched;
    const openAiUserContext = this.parseOpenAiUserSessionContext(indexKey);
    const rawChannel =
      openAiUserContext?.channel ??
      entry.lastChannel ??
      entry.origin?.provider ??
      undefined;
    const normalizedChannel = this.normalizeInferredChannelType(rawChannel);
    const channelType =
      normalizedChannel === "dingtalk-connector"
        ? "dingtalk"
        : normalizedChannel;
    const senderName =
      openAiUserContext?.sendername ?? entry.origin?.label ?? undefined;
    const groupName = openAiUserContext?.groupsubject ?? undefined;

    return {
      senderName,
      groupName,
      channelType,
    };
  }

  private parseOpenAiUserSessionContext(
    indexKey: string,
  ): OpenAiUserSessionContext | null {
    const marker = ":openai-user:";
    const markerIndex = indexKey.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const rawContext = indexKey.slice(markerIndex + marker.length).trim();
    if (!rawContext.startsWith("{")) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawContext) as OpenAiUserSessionContext;
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
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
    const qqbotPeerId =
      this.readStringValue(conversationMeta, "sender_id") ??
      this.readStringValue(senderMeta, "id") ??
      undefined;
    const qqbotGroupOpenid =
      this.readStringValue(conversationMeta, "group_openid") ?? undefined;

    // Extract group name from conversation metadata, with multi-source fallback
    const rawGroupName =
      this.readStringValue(conversationMeta, "group_name") ??
      this.readStringValue(conversationMeta, "chat_name") ??
      this.readStringValue(conversationMeta, "group_subject") ??
      this.readStringValue(conversationMeta, "conversation_label") ??
      undefined;

    // Filter out platform-internal IDs that look like identifiers rather than
    // human-readable group names:
    //   oc_ / ou_  — OpenClaw / Feishu internal IDs (hex suffix)
    //   C/G/D + [A-Z0-9]{8,} — Slack IDs: channels (C), groups (G), DMs (D)
    const isIdLike =
      rawGroupName !== undefined &&
      /^(?:oc_|ou_)[a-f0-9]+$|^[CGD][A-Z0-9]{8,}$/.test(rawGroupName);
    const groupName = isIdLike ? undefined : rawGroupName;

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
    } else if (
      combined.includes("whatsapp") ||
      combined.includes("@s.whatsapp.net") ||
      combined.includes("@g.us")
    ) {
      channelType = "whatsapp";
    } else if (combined.includes("qqbot")) {
      channelType = "qqbot";
    } else if (combined.includes("telegram")) {
      channelType = "telegram";
    }

    let qqbotMessageType: "c2c" | "group" | undefined;
    if (channelType === "qqbot") {
      if (qqbotGroupOpenid || /qqbot:group:/i.test(combined)) {
        qqbotMessageType = "group";
      } else if (qqbotPeerId || /qqbot:c2c:/i.test(combined)) {
        qqbotMessageType = "c2c";
      }
    }

    return {
      senderName,
      groupName,
      channelType: this.normalizeInferredChannelType(channelType),
      metadata: this.extractExactChatTargetMetadata(
        senderMeta,
        conversationMeta,
      ),
      feishuMessageId:
        this.readStringValue(conversationMeta, "message_id") ?? undefined,
      qqbotPeerId,
      qqbotGroupOpenid,
      qqbotMessageType,
    };
  }

  private resolveQqbotDisplayNames(
    hints: SessionHints,
    knownUsers: QqbotKnownUser[],
  ): { senderName?: string; groupName?: string } | null {
    const senderName = hints.senderName?.trim();
    const groupName = hints.groupName?.trim();
    const senderReadable =
      senderName && !this.isOpaqueQqbotValue(senderName, "user")
        ? senderName
        : undefined;
    const groupReadable =
      groupName && !this.isOpaqueQqbotValue(groupName, "group")
        ? groupName
        : undefined;

    if (senderReadable || groupReadable) {
      return {
        senderName: senderReadable,
        groupName: groupReadable,
      };
    }

    const knownUserNickname = this.findQqbotKnownUserNickname(
      knownUsers,
      hints.qqbotPeerId ?? extractQqbotOpaqueId(senderName),
      hints.qqbotMessageType ?? "c2c",
      hints.qqbotGroupOpenid ?? extractQqbotOpaqueId(groupName),
    );

    return {
      senderName: senderReadable ?? knownUserNickname ?? senderName,
      groupName: groupReadable ?? groupName,
    };
  }

  private normalizeInferredChannelType(
    channelType: string | undefined,
  ): string | undefined {
    if (!channelType) {
      return undefined;
    }

    const normalized = channelType.trim().toLowerCase();
    if (normalized === "wechat") {
      return "openclaw-weixin";
    }
    if (normalized === "dingtalk-connector") {
      return "dingtalk";
    }

    return normalized || undefined;
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
      normalized === sessionKey ||
      UUID_LIKE_TITLE_PATTERN.test(normalized) ||
      // Heal sessions whose persisted title is the raw opaque wechat id.
      normalized.endsWith("@im.wechat")
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
      const response = await proxyFetch(
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
      const response = await proxyFetch(
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

  private isOpaqueQqbotValue(value: string, kind: "user" | "group"): boolean {
    const normalized = normalizeQqbotDisplayName(value, kind);
    return normalized !== undefined && normalized !== value.trim();
  }

  private findQqbotKnownUserNickname(
    users: QqbotKnownUser[],
    openid: string | undefined,
    type: "c2c" | "group",
    groupOpenid?: string,
  ): string | undefined {
    if (!openid) {
      return undefined;
    }

    const exactMatch = users.find((user) => {
      if (user.openid !== openid || user.type !== type) {
        return false;
      }
      if (type === "group" && groupOpenid) {
        return user.groupOpenid === groupOpenid;
      }
      return true;
    });
    const nickname = exactMatch?.nickname?.trim();
    return nickname && !this.isOpaqueQqbotValue(nickname, "user")
      ? nickname
      : undefined;
  }

  private async readQqbotKnownUsers(): Promise<QqbotKnownUser[]> {
    const homeDir = process.env.HOME?.trim() || homedir();
    const filePath = path.join(
      homeDir,
      ".openclaw",
      "qqbot",
      "data",
      "known-users.json",
    );

    try {
      await access(filePath);
    } catch {
      this.qqbotKnownUsersCache = null;
      return [];
    }

    try {
      const fileStat = await stat(filePath);
      if (
        this.qqbotKnownUsersCache &&
        this.qqbotKnownUsersCache.filePath === filePath &&
        this.qqbotKnownUsersCache.mtimeMs === fileStat.mtimeMs
      ) {
        return this.qqbotKnownUsersCache.users;
      }

      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const users = Array.isArray(parsed)
        ? parsed.filter((item): item is QqbotKnownUser => {
            if (typeof item !== "object" || item === null) {
              return false;
            }
            const record = item as Record<string, unknown>;
            return (
              typeof record.openid === "string" &&
              (record.type === "c2c" || record.type === "group")
            );
          })
        : [];

      this.qqbotKnownUsersCache = {
        filePath,
        mtimeMs: fileStat.mtimeMs,
        users,
      };

      return users;
    } catch {
      return [];
    }
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
