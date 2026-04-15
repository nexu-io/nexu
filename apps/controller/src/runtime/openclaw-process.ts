import {
  type ChildProcess,
  execFile,
  execSync,
  spawn,
} from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import net from "node:net";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { getOpenClawCommandSpec } from "./slimclaw-runtime-resolution.js";

const execFileAsync = promisify(execFile);

const MAX_CONSECUTIVE_RESTARTS = 10;
const BASE_RESTART_DELAY_MS = 3000;
const RESTART_WINDOW_MS = 120_000;
// OpenClaw full-process restarts can take tens of seconds before the successor
// starts listening again (observed ~20s during first-time Feishu enablement).
// Keep a generous grace window so the outer supervisor does not spawn a second
// gateway while the successor is still running doctor/startup work.
const CONTROLLED_RESTART_GRACE_MS = 45_000;
const CONTROLLED_RESTART_PROBE_INTERVAL_MS = 500;
const NEXU_EVENT_MARKER = "NEXU_EVENT ";

export interface OpenClawRuntimeEvent {
  event: string;
  payload?: unknown;
}

export class OpenClawProcessManager {
  private child: ChildProcess | null = null;
  private autoRestartEnabled = false;
  private consecutiveRestarts = 0;
  private lastStartTime = 0;
  private controlledRestartExpected = false;
  private controlledRestartTimer: NodeJS.Timeout | null = null;
  private controlledRestartSuccessorPid: number | null = null;
  private eventListeners = new Set<(event: OpenClawRuntimeEvent) => void>();

  constructor(private readonly env: ControllerEnv) {}

  managesProcess(): boolean {
    return this.env.manageOpenclawProcess;
  }

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

  noteControlledRestartExpected(source: string): void {
    if (!this.env.manageOpenclawProcess) {
      return;
    }

    if (!this.controlledRestartExpected) {
      logger.info({ source }, "openclaw_controlled_restart_expected");
    }
    this.controlledRestartExpected = true;
  }

  onRuntimeEvent(listener: (event: OpenClawRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }
  /**
   * Check whether the managed OpenClaw process is currently alive.
   * Returns true if a child process exists and its pid responds to signal 0.
   */
  isAlive(): boolean {
    if (!this.child || this.child.killed || !this.child.pid) {
      return false;
    }
    return this.isProcessAlive(this.child.pid);
  }

  start(): void {
    if (!this.env.manageOpenclawProcess || this.child !== null) {
      return;
    }

    if (this.controlledRestartTimer) {
      clearTimeout(this.controlledRestartTimer);
      this.controlledRestartTimer = null;
    }
    this.controlledRestartExpected = false;
    this.controlledRestartSuccessorPid = null;

    this.killOrphanedOpenClawProcesses();

    const spec = getOpenClawCommandSpec(this.env);
    const cmd = spec.command;
    const args = [...spec.argsPrefix, "gateway", "run"];

    const child = spawn(cmd, args, {
      cwd: path.resolve(this.env.openclawStateDir),
      env: {
        ...process.env,
        ...spec.extraEnv,
        OPENCLAW_LOG_LEVEL: "info",
        // Explicitly pass config path so OpenClaw's file watcher monitors the correct file
        OPENCLAW_CONFIG_PATH: this.env.openclawConfigPath,
        // Prefer sips (macOS system tool) over sharp for image processing on macOS.
        // sharp requires native binaries that may not be available in the packaged app.
        ...(process.platform === "darwin"
          ? { OPENCLAW_IMAGE_BACKEND: "sips" }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    logger.info(
      {
        configPath: this.env.openclawConfigPath,
        stateDir: this.env.openclawStateDir,
        gatewayPort: this.env.openclawGatewayPort,
      },
      "openclaw_process_spawned",
    );

    this.child = child;
    this.lastStartTime = Date.now();

    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line.includes("restart mode: full process restart (")) {
          this.noteControlledRestartExpected("stdout");
          const match = line.match(/spawned pid\s+(\d+)/i);
          const successorPid = match ? Number(match[1]) : null;
          if (
            successorPid !== null &&
            Number.isInteger(successorPid) &&
            successorPid > 0
          ) {
            this.controlledRestartSuccessorPid = successorPid;
            logger.info(
              { successorPid },
              "openclaw_controlled_restart_successor_pid",
            );
          }
        }
        logger.info({ stream: "stdout", source: "openclaw" }, line);
        this.emitRuntimeEventFromLine(line);
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
        if (code === 0 && this.controlledRestartExpected) {
          this.awaitControlledRestart();
          return;
        }
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

  /**
   * Restart the gateway regardless of whether the controller manages the
   * process directly (dev / local-dev) or an external supervisor owns it
   * (packaged desktop via launchd). Returns once the restart has been
   * initiated — callers that need readiness should probe separately.
   */
  async restart(reason: string): Promise<void> {
    logger.info({ reason }, "openclaw_restart_requested");

    if (this.env.manageOpenclawProcess) {
      await this.stop();
      this.enableAutoRestart();
      this.start();
      return;
    }

    if (this.env.openclawLaunchdLabel) {
      const domain = `gui/${os.userInfo().uid}/${this.env.openclawLaunchdLabel}`;
      try {
        await execFileAsync("launchctl", ["kickstart", "-k", domain]);
        logger.info({ reason, domain }, "openclaw_restart_launchd_kickstarted");
      } catch (err) {
        logger.error(
          { reason, domain, err },
          "openclaw_restart_launchd_failed",
        );
        throw err;
      }
      return;
    }

    logger.warn(
      {
        reason,
        manageOpenclawProcess: this.env.manageOpenclawProcess,
        hasLaunchdLabel: false,
      },
      "openclaw_restart_skipped_no_supervisor",
    );
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

  private awaitControlledRestart(): void {
    if (!this.autoRestartEnabled) {
      return;
    }

    this.controlledRestartExpected = false;
    const startedAt = Date.now();

    const poll = () => {
      const successorPid = this.controlledRestartSuccessorPid;
      void Promise.all([
        this.isGatewayPortOpen(),
        successorPid !== null
          ? Promise.resolve(this.isProcessAlive(successorPid))
          : Promise.resolve(false),
      ]).then(([ready, successorAlive]) => {
        if (ready) {
          logger.info(
            { successorPid: this.controlledRestartSuccessorPid },
            "openclaw_controlled_restart_observed",
          );
          this.consecutiveRestarts = 0;
          this.controlledRestartTimer = null;
          this.controlledRestartSuccessorPid = null;
          return;
        }

        // The successor process may stay alive for a long time before the WS
        // port comes back. Treat a live successor as progress and keep waiting
        // instead of falling back to a second controller-managed restart.
        if (successorAlive) {
          this.controlledRestartTimer = setTimeout(
            poll,
            CONTROLLED_RESTART_PROBE_INTERVAL_MS,
          );
          return;
        }

        if (Date.now() - startedAt >= CONTROLLED_RESTART_GRACE_MS) {
          logger.warn(
            { successorPid: this.controlledRestartSuccessorPid },
            "openclaw_controlled_restart_timeout",
          );
          this.controlledRestartTimer = null;
          this.controlledRestartSuccessorPid = null;
          void this.clearStaleGatewayLocks().then(() => {
            this.start();
          });
          return;
        }

        this.controlledRestartTimer = setTimeout(
          poll,
          CONTROLLED_RESTART_PROBE_INTERVAL_MS,
        );
      });
    };

    logger.info(
      {
        graceMs: CONTROLLED_RESTART_GRACE_MS,
        successorPid: this.controlledRestartSuccessorPid,
      },
      "waiting for controlled openclaw restart",
    );
    this.controlledRestartTimer = setTimeout(
      poll,
      CONTROLLED_RESTART_PROBE_INTERVAL_MS,
    );
  }

  private emitRuntimeEventFromLine(line: string): void {
    const markerIndex = line.indexOf(NEXU_EVENT_MARKER);
    if (markerIndex < 0) {
      return;
    }

    const eventLine = line.slice(markerIndex + NEXU_EVENT_MARKER.length).trim();
    const firstSpaceIndex = eventLine.indexOf(" ");
    const eventName =
      firstSpaceIndex >= 0 ? eventLine.slice(0, firstSpaceIndex) : eventLine;
    const rawPayload =
      firstSpaceIndex >= 0 ? eventLine.slice(firstSpaceIndex + 1).trim() : "";

    if (!eventName) {
      return;
    }

    let payload: unknown;
    if (rawPayload) {
      try {
        payload = JSON.parse(this.extractJsonPayload(rawPayload)) as unknown;
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            event: eventName,
          },
          "openclaw_runtime_event_parse_failed",
        );
        return;
      }
    }

    for (const listener of this.eventListeners) {
      try {
        listener({ event: eventName, payload });
      } catch (error) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            event: eventName,
          },
          "openclaw_runtime_event_listener_failed",
        );
      }
    }
  }

  private extractJsonPayload(rawPayload: string): string {
    const sanitized = this.stripAnsi(rawPayload).trim();
    if (!sanitized.startsWith("{")) {
      return sanitized;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < sanitized.length; index += 1) {
      const char = sanitized[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === "{") {
        depth += 1;
        continue;
      }

      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return sanitized.slice(0, index + 1);
        }
      }
    }

    return sanitized;
  }

  private stripAnsi(value: string): string {
    let result = "";

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === "\u001b" && value[index + 1] === "[") {
        index += 2;
        while (index < value.length) {
          const code = value.charCodeAt(index);
          if (code >= 64 && code <= 126) {
            break;
          }
          index += 1;
        }
        continue;
      }
      result += char;
    }

    return result;
  }
  private isGatewayPortOpen(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port: this.env.openclawGatewayPort,
      });

      const finish = (result: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(300);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
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
