import type { CreateSessionInput, UpdateSessionInput } from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { SessionsRuntime } from "../runtime/sessions-runtime.js";
import type { ArtifactService } from "./artifact-service.js";

export class SessionService {
  constructor(
    private readonly sessionsRuntime: SessionsRuntime,
    private readonly artifactService?: ArtifactService,
  ) {}

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

  async deleteSession(id: string, botId: string) {
    const session = await this.sessionsRuntime.getSessionForBot(botId, id);
    if (!session) {
      return false;
    }

    await this.sessionsRuntime.deleteSessionFiles(
      session.botId,
      session.sessionKey,
    );

    try {
      await this.artifactService?.deleteArtifactsForSession(
        session.botId,
        session.sessionKey,
      );
    } catch (error) {
      logger.warn(
        {
          sessionId: id,
          botId: session.botId,
          sessionKey: session.sessionKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "session_delete_artifact_cleanup_failed",
      );
    }

    return true;
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
