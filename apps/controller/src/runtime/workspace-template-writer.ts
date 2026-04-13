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

  /**
   * Seed each active bot's workspace with platform docs (AGENTS.md,
   * BOOTSTRAP.md, IDENTITY.md, SOUL.md, TOOLS.md, USER.md, HEARTBEAT.md).
   *
   * Strict seed-if-missing semantics: any file that already exists in the
   * destination is left untouched. Agents edit these files at runtime
   * (self-evolution), so re-writing would silently destroy state. Should
   * therefore only need to be invoked once per bot, at creation time.
   */
  async write(bots: BotInfo[]): Promise<void> {
    const activeBots = bots.filter((bot) => bot.status === "active");
    const sourceDir = this.env.platformTemplatesDir;

    if (!sourceDir) {
      logger.warn(
        {},
        "platformTemplatesDir not configured; new agents will be created without platform docs (AGENTS.md, BOOTSTRAP.md, ...)",
      );
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
      let seededCount = 0;
      let preservedCount = 0;

      for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        // Write directly to workspace root, not nexu-platform/ subdirectory
        const targetPath = path.join(workspaceDir, entry.name);

        // Strict seed-if-missing: never clobber agent-edited content.
        // Agents read/write these files at runtime; force-overwriting would
        // silently destroy self-evolution state.
        if (await this.pathExists(targetPath)) {
          preservedCount += 1;
          logger.debug(
            {
              botId,
              workspaceDir,
              sourcePath,
              targetPath,
              decision: "preserved",
            },
            "platform_template_file_decision",
          );
          continue;
        }

        await cp(sourcePath, targetPath, {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
        seededCount += 1;
        logger.debug(
          {
            botId,
            workspaceDir,
            sourcePath,
            targetPath,
            decision: "seeded",
          },
          "platform_template_file_decision",
        );
      }

      logger.debug(
        { botId, workspaceDir, seededCount, preservedCount },
        "platform templates seed pass complete",
      );
    } catch (err) {
      logger.error(
        { botId, sourceDir, error: err instanceof Error ? err.message : err },
        "failed to seed platform templates",
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

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
