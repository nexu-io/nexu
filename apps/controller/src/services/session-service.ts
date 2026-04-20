import type { CreateSessionInput, UpdateSessionInput } from "@nexu/shared";
import type { SessionsRuntime } from "../runtime/sessions-runtime.js";

export class SessionService {
  constructor(private readonly sessionsRuntime: SessionsRuntime) {}

  async listSessions(params: {
    limit: number;
    offset: number;
    botId?: string;
    channelType?: string;
    status?: string;
  }) {
    let sessions = await this.sessionsRuntime.listSessions();

    if (params.botId) {
      sessions = sessions.filter((session) => session.botId === params.botId);
    }
    if (params.channelType) {
      sessions = sessions.filter(
        (session) => session.channelType === params.channelType,
      );
    }
    if (params.status) {
      sessions = sessions.filter((session) => session.status === params.status);
    }

    return {
      sessions: sessions.slice(params.offset, params.offset + params.limit),
      total: sessions.length,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async getSession(id: string) {
    return this.sessionsRuntime.getSession(id);
  }

  async createSession(input: CreateSessionInput) {
    return this.sessionsRuntime.createOrUpdateSession(input);
  }

  async updateSession(id: string, input: UpdateSessionInput) {
    return this.sessionsRuntime.updateSession(id, input);
  }

  async resetSession(id: string) {
    return this.sessionsRuntime.resetSession(id);
  }

  async deleteSession(id: string) {
    return this.sessionsRuntime.deleteSession(id);
  }

  async getSessionBySessionKey(botId: string, sessionKey: string) {
    return this.sessionsRuntime.getSessionBySessionKey(botId, sessionKey);
  }

  async getChatHistory(id: string, limit?: number) {
    return this.sessionsRuntime.getChatHistory(id, limit);
  }

  async getChatHistoryBySessionKey(
    botId: string,
    sessionKey: string,
    limit?: number,
  ) {
    return this.sessionsRuntime.getChatHistoryBySessionKey(
      botId,
      sessionKey,
      limit,
    );
  }

  async getFullMainChatHistory(botId: string, limit?: number) {
    return this.sessionsRuntime.getFullMainChatHistory(botId, limit);
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
  }) {
    return this.sessionsRuntime.appendCompatTranscript(input);
  }
}
