import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

export class OpenClawConfigWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(config: OpenClawConfig): Promise<void> {
    await mkdir(path.dirname(this.env.openclawConfigPath), { recursive: true });
    const content = `${JSON.stringify(config, null, 2)}\n`;
    const writeStartedAt = Date.now();
    logger.info(
      {
        path: this.env.openclawConfigPath,
        contentLength: content.length,
        startedAt: writeStartedAt,
      },
      "openclaw_config_write_begin",
    );
    await writeFile(this.env.openclawConfigPath, content, "utf8");
    const configStat = await stat(this.env.openclawConfigPath);
    logger.info(
      {
        path: this.env.openclawConfigPath,
        contentLength: content.length,
        inode: configStat.ino,
        size: configStat.size,
        mtimeMs: configStat.mtimeMs,
        finishedAt: Date.now(),
        durationMs: Date.now() - writeStartedAt,
      },
      "openclaw_config_write_complete",
    );
  }
}
