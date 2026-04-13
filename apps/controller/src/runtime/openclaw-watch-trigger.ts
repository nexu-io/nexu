import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  utimes,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { OpenClawProcessManager } from "./openclaw-process.js";

const execFileAsync = promisify(execFile);

/**
 * Dotfile sentinel inside the skills directory used as the single nudge
 * point for OpenClaw's skills chokidar watcher. The dot prefix keeps it
 * out of every "list skills" code path, which all filter by
 * `isDirectory()` + presence of `SKILL.md`.
 */
const SKILLS_NUDGE_MARKER_NAME = ".controller-nudge";
const SESSIONS_INDEX_NAME = "sessions.json";

type SessionIndexRecord = Record<string, unknown>;

export class OpenClawWatchTrigger {
  private openclawProcess: OpenClawProcessManager | null = null;

  constructor(private readonly env: ControllerEnv) {}

  /**
   * Inject the process manager after construction to avoid circular deps.
   */
  setProcessManager(pm: OpenClawProcessManager): void {
    this.openclawProcess = pm;
  }

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
      const invalidatedSessions = await this.invalidateSessionSkillSnapshots();
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
      const restarted = await this.restartGateway(reason);
      logger.info(
        {
          reason,
          marker,
          mtime: now.toISOString(),
          invalidatedSessions,
          gatewayRestarted: restarted,
        },
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

  /**
   * Restart the OpenClaw gateway so it re-reads the runtime config
   * (including the updated agent skill allowlist). OpenClaw's config
   * hot-reload treats `agents.list` skill changes as kind "none" and
   * does not apply them — a full process restart is required.
   *
   * Handles both orchestrator mode (direct child process) and launchd
   * mode (kickstart via launchctl).
   */
  private async restartGateway(reason: string): Promise<boolean> {
    try {
      if (this.env.manageOpenclawProcess && this.openclawProcess) {
        await this.openclawProcess.stop();
        this.openclawProcess.enableAutoRestart();
        this.openclawProcess.start();
        logger.info({ reason }, "openclaw gateway restarted (orchestrator)");
        return true;
      }

      if (this.env.openclawLaunchdLabel) {
        const domain = `gui/${os.userInfo().uid}/${this.env.openclawLaunchdLabel}`;
        await execFileAsync("launchctl", ["kickstart", "-k", domain]);
        logger.info({ reason, domain }, "openclaw gateway restarted (launchd)");
        return true;
      }

      logger.warn(
        { reason },
        "openclaw gateway restart skipped: no process manager or launchd label",
      );
      return false;
    } catch (error) {
      logger.warn(
        {
          reason,
          err: error instanceof Error ? error.message : String(error),
        },
        "openclaw gateway restart failed",
      );
      return false;
    }
  }

  private async touchFile(filePath: string): Promise<void> {
    try {
      await appendFile(filePath, "", "utf8");
    } catch {
      return;
    }
  }

  private async invalidateSessionSkillSnapshots(): Promise<number> {
    const agentsDir = path.join(this.env.openclawStateDir, "agents");
    let invalidatedSessions = 0;

    let agentEntries: Dirent[];
    try {
      agentEntries = await readdir(agentsDir, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const agentEntry of agentEntries) {
      if (!agentEntry.isDirectory()) {
        continue;
      }

      const sessionsIndexPath = path.join(
        agentsDir,
        agentEntry.name,
        "sessions",
        SESSIONS_INDEX_NAME,
      );
      const currentIndex = await this.readSessionsIndex(sessionsIndexPath);
      if (currentIndex == null) {
        continue;
      }

      let changed = false;
      const nextIndex = Object.fromEntries(
        Object.entries(currentIndex).map(([sessionKey, sessionValue]) => {
          if (!this.hasSkillsSnapshot(sessionValue)) {
            return [sessionKey, sessionValue];
          }

          changed = true;
          invalidatedSessions += 1;
          const { skillsSnapshot: _skillsSnapshot, ...rest } = sessionValue;
          return [sessionKey, rest];
        }),
      );

      if (!changed) {
        continue;
      }

      await writeFile(
        sessionsIndexPath,
        `${JSON.stringify(nextIndex, null, 2)}\n`,
        "utf8",
      );
    }

    return invalidatedSessions;
  }

  private async readSessionsIndex(
    sessionsIndexPath: string,
  ): Promise<Record<string, SessionIndexRecord> | null> {
    try {
      const raw = await readFile(sessionsIndexPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed == null ||
        Array.isArray(parsed)
      ) {
        return null;
      }

      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, SessionIndexRecord] =>
            typeof entry[1] === "object" &&
            entry[1] != null &&
            !Array.isArray(entry[1]),
        ),
      );
    } catch {
      return null;
    }
  }

  private hasSkillsSnapshot(
    value: SessionIndexRecord,
  ): value is SessionIndexRecord & { skillsSnapshot: unknown } {
    return "skillsSnapshot" in value;
  }
}
