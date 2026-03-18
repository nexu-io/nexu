import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SessionResponse } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";

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
          sessions.push({
            id: file.name,
            botId: agentEntry.name,
            sessionKey: file.name.replace(/\.jsonl$/, ""),
            channelType: null,
            channelId: null,
            title: file.name.replace(/\.jsonl$/, ""),
            status: "active",
            messageCount: 0,
            lastMessageAt: metadata.mtime.toISOString(),
            metadata: {
              source: "openclaw-filesystem",
              path: filePath,
            },
            createdAt: metadata.birthtime.toISOString(),
            updatedAt: metadata.mtime.toISOString(),
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
}
