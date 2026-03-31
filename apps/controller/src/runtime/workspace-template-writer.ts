import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

interface BotInfo {
  id: string;
  status: string;
}

export interface UserIdentity {
  name?: string;
  timezone?: string;
}

export class WorkspaceTemplateWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(bots: BotInfo[], userIdentity?: UserIdentity): Promise<void> {
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
      await this.copyPlatformTemplates(bot.id, sourceDir, userIdentity);
    }
  }

  private async copyPlatformTemplates(
    botId: string,
    sourceDir: string,
    userIdentity?: UserIdentity,
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

        // Skip files that already exist to preserve agent-written data (e.g. USER.md)
        if (await this.pathExists(targetPath)) {
          continue;
        }
        await cp(sourcePath, targetPath, { recursive: true });
      }

      // Pre-fill USER.md with known user identity so the agent doesn't need to ask
      if (userIdentity) {
        await this.prefillUserMd(workspaceDir, userIdentity);
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

  private async prefillUserMd(
    workspaceDir: string,
    identity: UserIdentity,
  ): Promise<void> {
    const userMdPath = path.join(workspaceDir, "USER.md");
    if (!(await this.pathExists(userMdPath))) return;

    try {
      let content = await readFile(userMdPath, "utf8");
      const hasName = identity.name && identity.name !== "Desktop User";
      const hasTz = identity.timezone;

      // Only fill empty fields — don't overwrite agent-written values
      if (hasName && content.includes("- **Name:**\n")) {
        content = content.replace(
          "- **Name:**\n",
          `- **Name:** ${identity.name}\n`,
        );
        content = content.replace(
          "- **What to call them:**\n",
          `- **What to call them:** ${identity.name}\n`,
        );
      }
      if (hasTz && content.includes("- **Timezone:**\n")) {
        content = content.replace(
          "- **Timezone:**\n",
          `- **Timezone:** ${identity.timezone}\n`,
        );
      }

      await writeFile(userMdPath, content, "utf8");
    } catch {
      // Non-critical — agent can still ask for this info
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
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
