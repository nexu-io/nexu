import { appendFile, mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

/**
 * Dotfile sentinel inside the skills directory used as the single nudge
 * point for OpenClaw's skills chokidar watcher. The dot prefix keeps it
 * out of every "list skills" code path, which all filter by
 * `isDirectory()` + presence of `SKILL.md`.
 */
const SKILLS_NUDGE_MARKER_NAME = ".controller-nudge";

export class OpenClawWatchTrigger {
  constructor(private readonly env: ControllerEnv) {}

  async touchConfig(): Promise<void> {
    await this.touchFile(this.env.openclawConfigPath);
  }

  /**
   * Fire a synthetic chokidar `change` event in OpenClaw's skills watcher
   * so it bumps `snapshotVersion`. Live sessions drop their cached skills
   * snapshot and rebuild it on the next agent turn, picking up any new
   * agent allowlist or on-disk skill content.
   *
   * This is the single converged nudge primitive for the skills pipeline.
   * Every code path that mutates the agent skill allowlist or skill files
   * (config push, install, uninstall, edit, …) should funnel through here.
   *
   * @param reason short identifier of the caller for troubleshooting logs,
   *   e.g. `"config-pushed"`, `"skill-installed"`, `"skill-uninstalled"`.
   */
  async nudgeSkillsWatcher(reason: string): Promise<void> {
    const marker = path.join(
      this.env.openclawSkillsDir,
      SKILLS_NUDGE_MARKER_NAME,
    );
    try {
      await mkdir(this.env.openclawSkillsDir, { recursive: true });
      // Ensure the marker exists. `flag: "a"` creates on first run, no-op
      // afterwards. The dot prefix keeps the marker out of every "list
      // skills" reader, all of which filter by isDirectory() + SKILL.md.
      await writeFile(marker, "", { flag: "a" });
      // Explicit mtime bump. `writeFile(..., "")` writes zero bytes and
      // does not reliably update mtime on macOS APFS, which would
      // silently skip the chokidar `change` event we depend on.
      const now = new Date();
      await utimes(marker, now, now);
      logger.info(
        { reason, marker, mtime: now.toISOString() },
        "openclaw skills watcher nudged",
      );
    } catch (error) {
      logger.warn(
        {
          reason,
          marker,
          err: error instanceof Error ? error.message : String(error),
        },
        "openclaw skills watcher nudge failed",
      );
    }
  }

  private async touchFile(filePath: string): Promise<void> {
    try {
      await appendFile(filePath, "", "utf8");
    } catch {
      return;
    }
  }
}
