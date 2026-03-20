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

function sessionMetadataPath(filePath: string): string {
  return filePath.replace(/\.jsonl$/, ".meta.json");
}

export class SessionsRuntime {
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
          const extra = await this.readSessionMetadata(filePath);
          const sessionKey = file.name.replace(/\.jsonl$/, "");

          // When .meta.json lacks title or channelType, try to infer from
          // the JSONL content (first user message's sender metadata block).
          let { title, channelType } = extra;
          if (!title || !channelType) {
            const hints = await this.inferSessionHints(filePath);
            if (!channelType && hints.channelType) {
              channelType = hints.channelType;
            }
            if (!title && hints.senderName) {
              title = channelType
                ? `${hints.senderName} · ${channelType}`
                : hints.senderName;
            }
          }

          sessions.push({
            id: file.name,
            botId: agentEntry.name,
            sessionKey,
            channelType: channelType ?? null,
            channelId: extra.channelId ?? null,
            title: title ?? sessionKey,
            status: extra.status ?? "active",
            messageCount: extra.messageCount ?? 0,
            lastMessageAt: extra.lastMessageAt ?? metadata.mtime.toISOString(),
            metadata: extra.metadata ?? {
              source: "openclaw-filesystem",
              path: filePath,
            },
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
      messages: await this.readMessages(filePath, limit ?? 200),
      sessionKey: session.sessionKey,
    };
  }

  private async readMessages(
    filePath: string,
    limit: number,
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
        messages.push({
          id: entry.id ?? "",
          role,
          content: entry.message.content,
          timestamp: entry.message.timestamp ?? null,
          createdAt: entry.timestamp ?? null,
        });
      } catch {
        // skip malformed lines
      }
    }

    // Return last N messages
    return messages.slice(-limit);
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

  /**
   * Read the first few KB of a JSONL file and extract sender name and
   * channel type from the first user message's "Sender (untrusted metadata)"
   * block. This avoids reading the entire (potentially large) session file.
   */
  private async inferSessionHints(
    filePath: string,
  ): Promise<{ senderName?: string; channelType?: string }> {
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

      return this.parseSenderHints(text);
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

  /**
   * Parse sender name and channel type from the text of a user message.
   *
   * OpenClaw injects a "Sender (untrusted metadata)" JSON block at the top
   * of each user message. The block has `label`, `id`, and optionally `name`.
   * For Feishu messages the `name` field contains the real user display name,
   * while `label` typically includes "feishu" for Feishu-originated messages.
   * For Slack messages `label` typically includes "slack".
   */
  private parseSenderHints(text: string): {
    senderName?: string;
    channelType?: string;
  } {
    // Match the JSON block after "Sender (untrusted metadata):"
    const match = text.match(
      /Sender\s+\(untrusted metadata\):\s*```json\s*\n([\s\S]*?)```/,
    );
    const jsonBlock = match?.[1];
    if (!jsonBlock) return {};

    let meta: { label?: string; id?: string; name?: string };
    try {
      meta = JSON.parse(jsonBlock);
    } catch {
      return {};
    }

    const senderName = meta.name || meta.label || undefined;

    // Infer channel type from label / id / surrounding text
    let channelType: string | undefined;
    const combined =
      `${meta.label ?? ""} ${meta.id ?? ""} ${text}`.toLowerCase();
    if (combined.includes("feishu")) {
      channelType = "feishu";
    } else if (combined.includes("slack")) {
      channelType = "slack";
    } else if (combined.includes("discord")) {
      channelType = "discord";
    }

    return { senderName, channelType };
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
