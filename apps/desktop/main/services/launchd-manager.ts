/**
 * LaunchdManager - macOS launchd service management wrapper
 *
 * Manages LaunchAgent services via launchctl commands.
 * Only works on macOS (darwin).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ServiceStatus {
  label: string;
  plistPath: string;
  status: "running" | "stopped" | "unknown";
  pid?: number;
  /** Environment variables from launchctl print (only populated when running) */
  env?: Record<string, string>;
}

export class LaunchdManager {
  private readonly plistDir: string;
  private readonly uid: number;
  private readonly domain: string;

  constructor(opts?: { plistDir?: string }) {
    if (process.platform !== "darwin") {
      throw new Error("LaunchdManager only works on macOS");
    }
    this.plistDir =
      opts?.plistDir ?? path.join(os.homedir(), "Library/LaunchAgents");
    this.uid = os.userInfo().uid;
    this.domain = `gui/${this.uid}`;
  }

  /**
   * Install and bootstrap a launchd service.
   */
  async installService(label: string, plistContent: string): Promise<void> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    await fs.mkdir(this.plistDir, { recursive: true });
    await fs.writeFile(plistPath, plistContent, "utf8");

    const isRegistered = await this.isServiceRegistered(label);
    if (!isRegistered) {
      try {
        const { stdout, stderr } = await execFileAsync("launchctl", [
          "bootstrap",
          this.domain,
          plistPath,
        ]);
        if (stdout) console.log(`Bootstrap ${label}:`, stdout);
        if (stderr) console.warn(`Bootstrap ${label} warnings:`, stderr);
      } catch (err) {
        console.error(
          `Failed to bootstrap ${label}:`,
          err instanceof Error ? err.message : err,
        );
        throw err;
      }
    }
  }

  /**
   * Bootout a launchd service (stop + unregister, but keep plist on disk).
   */
  async bootoutService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["bootout", `${this.domain}/${label}`]);
  }

  /**
   * Uninstall a launchd service (bootout + remove plist).
   */
  async uninstallService(label: string): Promise<void> {
    try {
      await execFileAsync("launchctl", ["bootout", `${this.domain}/${label}`]);
    } catch (err) {
      // Service may not be running, log but don't throw
      console.warn(
        `Failed to bootout ${label}:`,
        err instanceof Error ? err.message : err,
      );
    }
    try {
      const plistPath = path.join(this.plistDir, `${label}.plist`);
      await fs.unlink(plistPath);
    } catch {
      // Plist may not exist
    }
  }

  /**
   * Start a service (kickstart).
   */
  async startService(label: string): Promise<void> {
    await execFileAsync("launchctl", ["kickstart", `${this.domain}/${label}`]);
  }

  /**
   * Stop a service (kill SIGTERM).
   */
  async stopService(label: string): Promise<void> {
    await execFileAsync("launchctl", [
      "kill",
      "SIGTERM",
      `${this.domain}/${label}`,
    ]);
  }

  /**
   * Gracefully stop service: send SIGTERM then wait, force kill on timeout.
   */
  async stopServiceGracefully(label: string, timeoutMs = 5000): Promise<void> {
    try {
      await this.stopService(label);
    } catch {
      // Service may already be stopped
      return;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getServiceStatus(label);
      if (status.status !== "running") return;
      await new Promise((r) => setTimeout(r, 200));
    }

    console.warn(
      `Service ${label} did not stop in ${timeoutMs}ms, force killing`,
    );
    try {
      await execFileAsync("launchctl", [
        "kill",
        "SIGKILL",
        `${this.domain}/${label}`,
      ]);
    } catch {
      // Best effort
    }
  }

  /**
   * Get service status via launchctl print.
   */
  async getServiceStatus(label: string): Promise<ServiceStatus> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);

    try {
      const { stdout } = await execFileAsync("launchctl", [
        "print",
        `${this.domain}/${label}`,
      ]);

      // Parse PID from output
      const pidMatch = stdout.match(/pid\s*=\s*(\d+)/i);
      const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : undefined;

      // Check state
      const stateMatch = stdout.match(/state\s*=\s*(\w+)/i);
      const state = stateMatch?.[1]?.toLowerCase();

      const isRunning = state === "running" || (pid !== undefined && pid > 0);
      const env = isRunning ? this.parseEnvBlock(stdout) : undefined;

      return {
        label,
        plistPath,
        status: isRunning ? "running" : "stopped",
        pid,
        env,
      };
    } catch {
      // Service not registered or error
      return {
        label,
        plistPath,
        status: "unknown",
      };
    }
  }

  /**
   * Parse the `environment = { KEY => VALUE }` block from launchctl print.
   * Must match the top-level `environment` key (not `inherited environment`
   * or `default environment`).
   */
  private parseEnvBlock(stdout: string): Record<string, string> {
    const env: Record<string, string> = {};
    const lines = stdout.split("\n");
    let inBlock = false;
    for (const line of lines) {
      if (!inBlock) {
        // Match tab-indented "environment = {" but not "inherited environment"
        if (/^\tenvironment = \{/.test(line)) {
          inBlock = true;
        }
        continue;
      }
      if (/^\t\}/.test(line)) break;
      const m = line.match(/^\t\t(\S+)\s+=>\s+(.*)$/);
      if (m) {
        env[m[1]] = m[2];
      }
    }
    return env;
  }

  /**
   * Check if service is registered with launchd.
   */
  async isServiceRegistered(label: string): Promise<boolean> {
    try {
      await execFileAsync("launchctl", ["print", `${this.domain}/${label}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if plist file exists.
   */
  async hasPlistFile(label: string): Promise<boolean> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    try {
      await fs.access(plistPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if service is installed (plist exists and registered).
   */
  async isServiceInstalled(label: string): Promise<boolean> {
    const hasPlist = await this.hasPlistFile(label);
    const isRegistered = await this.isServiceRegistered(label);
    return hasPlist && isRegistered;
  }

  /**
   * Force restart a service (kickstart -k).
   */
  async restartService(label: string): Promise<void> {
    await execFileAsync("launchctl", [
      "kickstart",
      "-k",
      `${this.domain}/${label}`,
    ]);
  }

  /**
   * Get plist directory path.
   */
  getPlistDir(): string {
    return this.plistDir;
  }

  /**
   * Get launchd domain.
   */
  getDomain(): string {
    return this.domain;
  }
}

/**
 * Service labels for Nexu Desktop.
 */
export const SERVICE_LABELS = {
  controller: (isDev: boolean) =>
    isDev ? "io.nexu.controller.dev" : "io.nexu.controller",
  openclaw: (isDev: boolean) =>
    isDev ? "io.nexu.openclaw.dev" : "io.nexu.openclaw",
} as const;
