import type { Dirent } from "node:fs";
import {
  mkdir,
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
          sessions.push({
            id: file.name,
            botId: agentEntry.name,
            sessionKey,
            channelType: extra.channelType ?? null,
            channelId: extra.channelId ?? null,
            title: extra.title ?? sessionKey,
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
