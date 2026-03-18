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
    const sessions = await this.sessionsRuntime.listSessions();
    return sessions.find((session) => session.id === id) ?? null;
  }
}
