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
  private readonly log: (message: string) => void;

  constructor(opts?: { plistDir?: string; log?: (message: string) => void }) {
    this.plistDir =
      opts?.plistDir ?? path.join(os.homedir(), "Library/LaunchAgents");
    this.uid = os.userInfo().uid;
    this.domain = `gui/${this.uid}`;
    this.log = opts?.log ?? console.log;
  }

  /**
   * Install and bootstrap a launchd service.
   * If the service is already registered but the plist content has changed,
   * bootout the old service and re-bootstrap with the new plist.
   */
  async installService(label: string, plistContent: string): Promise<void> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    await fs.mkdir(this.plistDir, { recursive: true });

    // Always clear any persistent "disabled" override left by legacy
    // `launchctl unload -w`. `launchctl enable` is idempotent (no-op when
    // not disabled), so this is safe to run on every boot. Without this,
    // upgrades that leave the plist unchanged hit the early-return below
    // and leak the disabled flag, causing OpenClaw's SIGUSR1 self-restart
    // to fail with "Bootstrap failed: 5".
    const disabled = await this.isServiceDisabled(label);
    if (disabled) {
      this.log(
        `installService: ${label} has disabled override, clearing with launchctl enable`,
      );
      await this.enableService(label);
    }

    const isRegistered = await this.isServiceRegistered(label);

    if (isRegistered) {
      // Check if plist content changed — if so, bootout and re-bootstrap
      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(plistPath, "utf8");
      } catch {
        // File missing but service registered — stale registration
      }

      if (existingContent === plistContent) {
        // Plist unchanged and already registered — nothing to do
        return;
      }

      // Content changed or file missing: bootout old, write new, re-bootstrap
      console.log(`Plist content changed for ${label}, bootout + re-bootstrap`);
      try {
        await this.bootoutService(label);
        // Brief wait for launchd to finish teardown
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // Service may have been in a bad state — continue with fresh bootstrap
      }
    }

    await fs.writeFile(plistPath, plistContent, "utf8");

    // Bootstrap with retry: "Input/output error" (code 5) means launchd
    // has stale state for this label. Bootout to clear it, then retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { stdout, stderr } = await execFileAsync("launchctl", [
          "bootstrap",
          this.domain,
          plistPath,
        ]);
        if (stdout) console.log(`Bootstrap ${label}:`, stdout);
        if (stderr) console.warn(`Bootstrap ${label} warnings:`, stderr);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && /Input\/output error|error: 5/.test(message)) {
          console.warn(
            `Bootstrap ${label} hit stale state, clearing and retrying`,
          );
          try {
            await this.bootoutService(label);
          } catch {
            // may already be unregistered
          }
          // Also clear disabled override in case that's the cause
          await this.enableService(label).catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        console.error(`Failed to bootstrap ${label}:`, message);
        throw err;
      }
    }
  }

  /**
   * Bootout a launchd service (stop + unregister, but keep plist on disk).
   * Tolerates "not found" errors — the service may already be unregistered.
   */
  async bootoutService(label: string): Promise<void> {
    try {
      await execFileAsync("launchctl", ["bootout", `${this.domain}/${label}`]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // launchctl returns non-zero when the service is already gone.
      // These patterns cover the known macOS launchctl error messages.
      const isAlreadyGone =
        /could not find specified service/i.test(message) ||
        /no such process/i.test(message) ||
        /service not found/i.test(message) ||
        /not bootstrapped/i.test(message);
      if (isAlreadyGone) {
        console.debug(
          `bootoutService: ${label} already unregistered (${message.trim()})`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Uninstall a launchd service (bootout + remove plist).
   */
  async uninstallService(label: string): Promise<void> {
    await this.bootoutAndWaitForExit(label);
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
   * Check if a service has a persistent "disabled" override in launchd's database.
   * This happens when someone runs `launchctl unload -w` which writes a sticky
   * disabled flag, causing all subsequent `launchctl bootstrap` calls to fail
   * with error 5 (Input/output error).
   */
  async isServiceDisabled(label: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("launchctl", [
        "print-disabled",
        this.domain,
      ]);
      // Output format: "io.nexu.controller" => true
      const pattern = new RegExp(
        `"${label.replace(/\./g, "\\.")}"\\s*=>\\s*true`,
      );
      return pattern.test(stdout);
    } catch {
      // Command failed or label not found — assume not disabled
      return false;
    }
  }

  /**
   * Clear a persistent "disabled" override for a service.
   * Runs `launchctl enable gui/<uid>/<label>` so that subsequent bootstrap
   * calls succeed. Tolerates errors (the label may not be in the disabled database).
   */
  async enableService(label: string): Promise<void> {
    try {
      await execFileAsync("launchctl", ["enable", `${this.domain}/${label}`]);
      this.log(`enableService: cleared disabled override for ${label}`);
    } catch (err) {
      this.log(
        `enableService: failed to clear disabled override for ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
   * Wait for a service to exit after bootout.
   * Polls status until the service is no longer running or timeout is reached.
   * If still running after timeout, sends SIGKILL as last resort.
   *
   * @param knownPid - PID captured *before* bootout. After bootout, launchctl
   *   print may return "unknown" even though the process is still exiting.
   *   Passing the PID lets the fallback SIGKILL work reliably.
   */
  async waitForExit(
    label: string,
    timeoutMs = 5000,
    knownPid?: number,
  ): Promise<void> {
    const startTime = Date.now();
    let consecutiveUnknown = 0;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getServiceStatus(label);
      if (status.status === "stopped") return;
      if (status.status === "unknown") {
        consecutiveUnknown++;
        // After 3 consecutive "unknown" reads, the label is unregistered.
        // If we have a known PID, verify the process is actually gone.
        if (consecutiveUnknown >= 3) {
          if (knownPid && isProcessAlive(knownPid)) {
            // Label gone but process still alive — break to SIGKILL path
            break;
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      consecutiveUnknown = 0;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Last resort: force kill by PID, then verify
    const targetPid = knownPid ?? (await this.getServiceStatus(label)).pid;
    if (!targetPid) return;

    console.warn(
      `Service ${label} (pid=${targetPid}) still running after bootout + ${timeoutMs}ms, sending SIGKILL`,
    );
    try {
      process.kill(targetPid, "SIGKILL");
    } catch {
      // Process may have exited between check and kill (ESRCH)
      return;
    }
    // Re-poll briefly to confirm kill took effect
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (!isProcessAlive(targetPid)) return;
    }
  }

  /**
   * Bootout a service and wait for the process to fully exit.
   * Captures the PID before bootout so the fallback SIGKILL works even after
   * the label is unregistered from launchd.
   */
  async bootoutAndWaitForExit(label: string, timeoutMs = 5000): Promise<void> {
    // Capture PID before bootout — after bootout, launchctl print may fail
    const status = await this.getServiceStatus(label);
    const pid = status.pid;

    try {
      await this.bootoutService(label);
    } catch {
      // Service may not be registered — if we have a PID, still try to kill it
      if (pid && isProcessAlive(pid)) {
        console.warn(
          `Bootout failed for ${label} but pid=${pid} is alive, sending SIGKILL`,
        );
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ESRCH — already gone
        }
      }
      return;
    }

    await this.waitForExit(label, timeoutMs, pid);
  }

  /**
   * Re-bootstrap a service from its existing plist file on disk.
   * Used after bootout to re-register the service with launchd.
   */
  async rebootstrapFromPlist(label: string): Promise<void> {
    const plistPath = path.join(this.plistDir, `${label}.plist`);
    try {
      await execFileAsync("launchctl", ["bootstrap", this.domain, plistPath]);
    } catch (err) {
      console.error(
        `Failed to re-bootstrap ${label}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
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

/**
 * Check if a process is still alive (signal 0 = existence check).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
