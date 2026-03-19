import { type ChildProcess, execSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

const MAX_CONSECUTIVE_RESTARTS = 10;
const BASE_RESTART_DELAY_MS = 3000;
const RESTART_WINDOW_MS = 120_000;

export class OpenClawProcessManager {
  private child: ChildProcess | null = null;
  private autoRestartEnabled = false;
  private consecutiveRestarts = 0;
  private lastStartTime = 0;

  constructor(private readonly env: ControllerEnv) {}

  async prepare(): Promise<void> {
    if (!this.env.manageOpenclawProcess) {
      return;
    }

    await this.clearStaleSessionLocks();
    await this.clearStaleGatewayLocks();
  }

  enableAutoRestart(): void {
    this.autoRestartEnabled = true;
  }

  start(): void {
    if (!this.env.manageOpenclawProcess || this.child !== null) {
      return;
    }

    this.killOrphanedOpenClawProcesses();

    const child = spawn(this.env.openclawBin, ["gateway", "run"], {
      cwd: path.resolve(this.env.openclawStateDir),
      env: {
        ...process.env,
        OPENCLAW_LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;
    this.lastStartTime = Date.now();

    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        logger.info({ stream: "stdout", source: "openclaw" }, line);
      });
    }

    if (child.stderr) {
      createInterface({ input: child.stderr }).on("line", (line) => {
        logger.warn({ stream: "stderr", source: "openclaw" }, line);
      });
    }

    child.once("error", (error) => {
      logger.error(
        { error: error.message },
        "failed to spawn openclaw process",
      );
      this.child = null;
      this.scheduleRestart(null, null);
    });

    child.once("exit", (code, signal) => {
      logger.warn(
        { code: code ?? null, signal: signal ?? null },
        "openclaw process exited",
      );
      this.child = null;
      if (signal !== "SIGTERM") {
        this.scheduleRestart(code, signal);
      }
    });
  }

  restartForHealth(): void {
    if (this.child === null || this.child.killed) {
      return;
    }

    logger.warn(
      { event: "openclaw_restart_for_health" },
      "restarting unhealthy openclaw process",
    );
    this.child.kill("SIGKILL");
  }

  async stop(): Promise<void> {
    this.autoRestartEnabled = false;

    if (this.child === null || this.child.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      const current = this.child;
      if (current === null) {
        resolve();
        return;
      }

      const forceKillTimer = setTimeout(() => {
        if (!current.killed) {
          logger.warn(
            {},
            "openclaw process did not exit in time, sending SIGKILL",
          );
          current.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      current.once("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });
      current.kill("SIGTERM");
    });
  }

  private scheduleRestart(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (!this.autoRestartEnabled) {
      return;
    }

    const uptime = Date.now() - this.lastStartTime;
    if (uptime > RESTART_WINDOW_MS) {
      this.consecutiveRestarts = 0;
    }

    this.consecutiveRestarts += 1;
    if (this.consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
      logger.error(
        {
          attempts: this.consecutiveRestarts,
          maxAttempts: MAX_CONSECUTIVE_RESTARTS,
          exitCode,
          signal,
        },
        "openclaw process exceeded max restart attempts",
      );
      return;
    }

    const delayMs =
      BASE_RESTART_DELAY_MS * Math.min(this.consecutiveRestarts, 5);
    logger.info(
      { attempt: this.consecutiveRestarts, delayMs },
      "scheduling openclaw restart",
    );

    setTimeout(() => {
      void this.clearStaleGatewayLocks().then(() => {
        this.start();
      });
    }, delayMs);
  }

  private async clearStaleSessionLocks(): Promise<void> {
    const agentsDir = path.join(this.env.openclawStateDir, "agents");
    let agentEntries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      agentEntries = await readdir(agentsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of agentEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sessionsDir = path.join(agentsDir, entry.name, "sessions");
      let files: string[];
      try {
        files = await readdir(sessionsDir);
      } catch {
        continue;
      }

      await Promise.all(
        files
          .filter((file) => file.endsWith(".lock"))
          .map((file) => rm(path.join(sessionsDir, file), { force: true })),
      );
    }
  }

  private async clearStaleGatewayLocks(): Promise<void> {
    const uid =
      typeof process.getuid === "function" ? process.getuid() : undefined;
    const suffix = uid != null ? `openclaw-${uid}` : "openclaw";
    const lockDir = path.join(tmpdir(), suffix);
    let files: string[];
    try {
      files = await readdir(lockDir);
    } catch {
      return;
    }

    await Promise.all(
      files
        .filter((file) => file.startsWith("gateway.") && file.endsWith(".lock"))
        .map((file) => rm(path.join(lockDir, file), { force: true })),
    );
  }

  private killOrphanedOpenClawProcesses(): void {
    try {
      const procEntries = readdirSync("/proc");
      for (const entry of procEntries) {
        if (!/^\d+$/.test(entry)) {
          continue;
        }
        const pid = Number.parseInt(entry, 10);
        if (pid === process.pid) {
          continue;
        }
        try {
          const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
            .replace(/\0/g, " ")
            .trim();
          if (cmdline.includes("openclaw") && cmdline.includes("gateway")) {
            process.kill(pid, "SIGKILL");
          }
        } catch {
          // process exited between listing and inspection
        }
      }
      return;
    } catch {
      // fall through to macOS/BSD pgrep
    }

    try {
      const output = execSync("/usr/bin/pgrep -f 'openclaw.*gateway'", {
        encoding: "utf8",
        timeout: 3000,
      }).trim();
      for (const line of output.split("\n")) {
        const pid = Number.parseInt(line, 10);
        if (Number.isNaN(pid) || pid === process.pid) {
          continue;
        }
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // process already exited
        }
      }
    } catch {
      return;
    }
  }
}
