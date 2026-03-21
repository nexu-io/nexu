import { cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

interface BotInfo {
  id: string;
  status: string;
}

export class WorkspaceTemplateWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(bots: BotInfo[]): Promise<void> {
    const activeBots = bots.filter((bot) => bot.status === "active");
    const sourceDir = this.env.platformTemplatesDir;

    if (!sourceDir) {
      logger.debug({}, "platformTemplatesDir not configured, skipping");
      return;
    }

    const sourceDirExists = await this.directoryExists(sourceDir);
    if (!sourceDirExists) {
      logger.warn({ sourceDir }, "platform templates directory not found");
      return;
    }

    for (const bot of activeBots) {
      await this.copyPlatformTemplates(bot.id, sourceDir);
    }
  }

  private async copyPlatformTemplates(
    botId: string,
    sourceDir: string,
  ): Promise<void> {
    const workspaceDir = path.join(this.env.openclawStateDir, "agents", botId);

    // Ensure workspace directory exists before OpenClaw initializes it
    await mkdir(workspaceDir, { recursive: true });

    try {
      const entries = await readdir(sourceDir, { withFileTypes: true });

      for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        // Write directly to workspace root, not nexu-platform/ subdirectory
        const targetPath = path.join(workspaceDir, entry.name);

        await cp(sourcePath, targetPath, { recursive: true, force: true });
      }

      logger.debug(
        { botId, workspaceDir },
        "copied platform templates to workspace root",
      );
    } catch (err) {
      logger.error(
        { botId, sourceDir, error: err instanceof Error ? err.message : err },
        "failed to copy platform templates",
      );
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}
