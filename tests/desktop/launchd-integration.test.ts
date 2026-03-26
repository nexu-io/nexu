/**
 * Real launchd integration tests — runs actual launchctl commands on macOS.
 *
 * These tests are SKIPPED on non-macOS platforms. On macOS they exercise
 * the real LaunchdManager, teardownLaunchdServices, and ensureNexuProcessesDead
 * against actual launchd services, catching issues that mocked tests miss
 * (wrong launchctl arguments, timing issues, PID handling, etc.).
 *
 * Each test creates isolated services with unique labels and cleans up
 * in afterEach to avoid polluting the host system.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const IS_MACOS = process.platform === "darwin";
const _REPO_ROOT = resolve(__dirname, "../..");
const NODE_BIN = process.execPath;
const UID = IS_MACOS
  ? execFileSync("id", ["-u"], { encoding: "utf8" }).trim()
  : "0";
const DOMAIN = `gui/${UID}`;

// Unique label prefix to avoid collisions with real services or parallel tests
const LABEL_PREFIX = `io.nexu.test.${process.pid}`;
const CONTROLLER_LABEL = `${LABEL_PREFIX}.controller`;

describe.skipIf(!IS_MACOS)("Real launchd integration", () => {
  let tempDir: string;
  let plistDir: string;
  let logDir: string;
  let testPort: number;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "nexu-launchd-test-"));
    plistDir = join(tempDir, "plists");
    logDir = join(tempDir, "logs");
    mkdirSync(plistDir, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    // Pick a random high port to avoid conflicts
    testPort = 51000 + Math.floor(Math.random() * 1000);
  });

  afterEach(() => {
    // Best-effort cleanup: bootout any registered services
    try {
      execFileSync("launchctl", ["bootout", `${DOMAIN}/${CONTROLLER_LABEL}`], {
        stdio: "ignore",
      });
    } catch {
      // Not registered — fine
    }
    // Kill any processes on our test port
    try {
      const pid = execFileSync(
        "lsof",
        [`-iTCP:${testPort}`, "-sTCP:LISTEN", "-t"],
        {
          encoding: "utf8",
        },
      ).trim();
      if (pid) process.kill(Number(pid), "SIGKILL");
    } catch {
      // No process — fine
    }
    // Remove temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Helper: write a plist that runs a simple HTTP server
  function writePlist(): string {
    const plistPath = join(plistDir, `${CONTROLLER_LABEL}.plist`);
    const serverScript = join(tempDir, "server.mjs");

    // Write a trivial HTTP server script
    writeFileSync(
      serverScript,
      `
      import { createServer } from "node:http";
      const s = createServer((_, r) => { r.writeHead(200); r.end("ok"); });
      s.listen(${testPort}, "127.0.0.1", () => {
        console.log("test-server listening on ${testPort}");
      });
      `,
    );

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${CONTROLLER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${serverScript}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${tempDir}</string>
    <key>StandardOutPath</key>
    <string>${join(logDir, "stdout.log")}</string>
    <key>StandardErrorPath</key>
    <string>${join(logDir, "stderr.log")}</string>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;

    writeFileSync(plistPath, plistContent);
    return plistContent;
  }

  function isLabelRegistered(): boolean {
    try {
      execFileSync("launchctl", ["print", `${DOMAIN}/${CONTROLLER_LABEL}`], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }

  function getServicePid(): number | null {
    try {
      const output = execFileSync(
        "launchctl",
        ["print", `${DOMAIN}/${CONTROLLER_LABEL}`],
        { encoding: "utf8" },
      );
      const match = output.match(/pid\s*=\s*(\d+)/i);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }

  function isPortListening(): boolean {
    try {
      execFileSync("lsof", [`-iTCP:${testPort}`, "-sTCP:LISTEN"], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 10000,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // 1. LaunchdManager.installService + startService
  // -----------------------------------------------------------------------
  it("installs and starts a real launchd service", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    expect(isLabelRegistered()).toBe(true);

    await mgr.startService(CONTROLLER_LABEL);

    // Wait for process to start and port to listen
    const started = await waitFor(() => isPortListening(), 15000);
    expect(started).toBe(true);

    const status = await mgr.getServiceStatus(CONTROLLER_LABEL);
    expect(status.status).toBe("running");
    expect(status.pid).toBeGreaterThan(0);
  }, 20000);

  // -----------------------------------------------------------------------
  // 2. LaunchdManager.bootoutAndWaitForExit
  // -----------------------------------------------------------------------
  it("bootoutAndWaitForExit stops service and process exits", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => isPortListening(), 15000);

    const pidBefore = getServicePid();
    expect(pidBefore).not.toBeNull();

    await mgr.bootoutAndWaitForExit(CONTROLLER_LABEL, 10000);

    // Label should be unregistered
    expect(isLabelRegistered()).toBe(false);

    // Process should be dead
    let processAlive = false;
    try {
      process.kill(pidBefore ?? -1, 0);
      processAlive = true;
    } catch {
      processAlive = false;
    }
    expect(processAlive).toBe(false);

    // Port should be free
    expect(isPortListening()).toBe(false);
  }, 30000);

  // -----------------------------------------------------------------------
  // 3. teardownLaunchdServices (full sequence)
  // -----------------------------------------------------------------------
  it("teardownLaunchdServices stops service and cleans up state", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => isPortListening(), 15000);

    // Write a fake runtime-ports.json that should be deleted
    const portsFile = join(plistDir, "runtime-ports.json");
    writeFileSync(portsFile, JSON.stringify({ test: true }));

    await teardownLaunchdServices({
      launchd: mgr,
      labels: {
        // Use same label for both — we only have one test service
        controller: CONTROLLER_LABEL,
        openclaw: `${LABEL_PREFIX}.nonexistent`,
      },
      plistDir,
    });

    // Service should be gone
    expect(isLabelRegistered()).toBe(false);
    expect(isPortListening()).toBe(false);
  }, 30000);

  // -----------------------------------------------------------------------
  // 4. ensureNexuProcessesDead kills orphan processes
  // -----------------------------------------------------------------------
  it("ensureNexuProcessesDead kills orphan processes by pattern", async () => {
    const { ensureNexuProcessesDead } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );

    // Spawn a process that matches one of NEXU_PROCESS_PATTERNS:
    // "controller/dist/index.js" — we'll spawn a node process with that in args
    const orphanDir = join(tempDir, "controller", "dist");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(
      join(orphanDir, "index.js"),
      "setTimeout(() => process.exit(0), 60000);",
    );

    const orphan = spawn(NODE_BIN, [join(orphanDir, "index.js")], {
      detached: true,
      stdio: "ignore",
    });
    orphan.unref();
    const orphanPid = orphan.pid ?? 0;

    // Verify orphan is alive
    expect(() => process.kill(orphanPid, 0)).not.toThrow();

    const result = await ensureNexuProcessesDead({
      timeoutMs: 10000,
      intervalMs: 200,
    });

    expect(result.clean).toBe(true);

    // Orphan should be dead
    let alive = false;
    try {
      process.kill(orphanPid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  }, 15000);

  // -----------------------------------------------------------------------
  // 5. getServiceStatus parses running service correctly
  // -----------------------------------------------------------------------
  it("getServiceStatus returns correct status and PID for running service", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => getServicePid() !== null, 10000);

    const status = await mgr.getServiceStatus(CONTROLLER_LABEL);
    expect(status.status).toBe("running");
    expect(typeof status.pid).toBe("number");
    expect(status.pid ?? -1).toBeGreaterThan(0);

    // Verify PID is actually alive
    expect(() => process.kill(status.pid ?? -1, 0)).not.toThrow();
  }, 15000);

  // -----------------------------------------------------------------------
  // 6. getServiceStatus returns unknown for non-existent service
  // -----------------------------------------------------------------------
  it("getServiceStatus returns unknown for non-existent label", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });

    const status = await mgr.getServiceStatus("io.nexu.test.nonexistent");
    expect(status.status).toBe("unknown");
    expect(status.pid).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 7. installService detects plist content change
  // -----------------------------------------------------------------------
  it("installService re-bootstraps when plist content changes", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    // First install
    await mgr.installService(CONTROLLER_LABEL, plistContent);
    expect(isLabelRegistered()).toBe(true);

    // Second install with same content — should be no-op
    await mgr.installService(CONTROLLER_LABEL, plistContent);
    expect(isLabelRegistered()).toBe(true);

    // Third install with different content — should re-bootstrap
    const modifiedContent = plistContent.replace(
      "<integer>5</integer>",
      "<integer>10</integer>",
    );
    await mgr.installService(CONTROLLER_LABEL, modifiedContent);
    expect(isLabelRegistered()).toBe(true);
  }, 15000);

  // -----------------------------------------------------------------------
  // 8. stopServiceGracefully sends SIGTERM then waits
  // -----------------------------------------------------------------------
  it("stopServiceGracefully stops a running service", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => isPortListening(), 15000);

    await mgr.stopServiceGracefully(CONTROLLER_LABEL, 10000);

    // Service should still be registered (stopServiceGracefully doesn't bootout)
    // but process should not be running
    const portFree = await waitFor(() => !isPortListening(), 5000);
    expect(portFree).toBe(true);
  }, 30000);

  // -----------------------------------------------------------------------
  // 9. Full cycle: start → stop → verify clean → re-start (cold start after quit)
  // -----------------------------------------------------------------------
  it("full cycle: start → bootout → verify clean → re-start succeeds", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    // Start
    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => isPortListening(), 15000);

    // Stop via bootout
    await mgr.bootoutAndWaitForExit(CONTROLLER_LABEL, 10000);
    expect(isLabelRegistered()).toBe(false);
    expect(isPortListening()).toBe(false);

    // Re-start from scratch (simulates next app launch)
    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    const restarted = await waitFor(() => isPortListening(), 15000);
    expect(restarted).toBe(true);

    const status = await mgr.getServiceStatus(CONTROLLER_LABEL);
    expect(status.status).toBe("running");
  }, 45000);

  // -----------------------------------------------------------------------
  // 10. Attach scenario: services running, new Electron attaches
  // -----------------------------------------------------------------------
  it("attach: detects already-running service from a previous session", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    // Simulate previous session: service is running
    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => isPortListening(), 15000);

    // New "Electron" process creates a fresh LaunchdManager and queries status
    const mgr2 = new LaunchdManager({ plistDir });
    const status = await mgr2.getServiceStatus(CONTROLLER_LABEL);
    expect(status.status).toBe("running");
    expect(status.pid).toBeGreaterThan(0);

    // Verify port is still listening (service was not disrupted)
    expect(isPortListening()).toBe(true);
  }, 20000);

  // -----------------------------------------------------------------------
  // 11. KeepAlive: service auto-restarts after crash
  // -----------------------------------------------------------------------
  it("KeepAlive: service auto-restarts after being killed", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => isPortListening(), 15000);

    // Kill the process (simulates crash)
    const pid = getServicePid();
    expect(pid).not.toBeNull();
    process.kill(pid ?? -1, "SIGKILL");

    // Port goes down
    await waitFor(() => !isPortListening(), 5000);

    // KeepAlive.SuccessfulExit=false should make launchd restart it.
    // Wait for it to come back (ThrottleInterval=5s in our plist).
    const restarted = await waitFor(() => isPortListening(), 15000);
    expect(restarted).toBe(true);

    // PID should be different from the killed one
    const newPid = getServicePid();
    expect(newPid).not.toBeNull();
    expect(newPid).not.toBe(pid);
  }, 30000);

  // -----------------------------------------------------------------------
  // 12. Rapid start/stop cycles don't leave orphans
  // -----------------------------------------------------------------------
  it("rapid start/stop cycles leave no orphan processes", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    // Do 3 rapid cycles
    for (let i = 0; i < 3; i++) {
      await mgr.installService(CONTROLLER_LABEL, plistContent);
      await mgr.startService(CONTROLLER_LABEL);
      // Brief wait for process to start
      await new Promise((r) => setTimeout(r, 500));
      await mgr.bootoutAndWaitForExit(CONTROLLER_LABEL, 10000);
    }

    // Verify: no service registered, no port occupied
    expect(isLabelRegistered()).toBe(false);
    expect(isPortListening()).toBe(false);

    // Also check via pgrep that no orphan node processes are on our port
    let orphanPid: string | null = null;
    try {
      orphanPid = execFileSync(
        "lsof",
        [`-iTCP:${testPort}`, "-sTCP:LISTEN", "-t"],
        { encoding: "utf8" },
      ).trim();
    } catch {
      orphanPid = null;
    }
    expect(orphanPid).toBeFalsy();
  }, 45000);

  // -----------------------------------------------------------------------
  // 13. Port conflict: service fails to bind, bootout cleans up
  // -----------------------------------------------------------------------
  it("port conflict: occupied port prevents service, bootout cleans up", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });

    // Occupy the port with a dummy process
    const blocker = spawn(NODE_BIN, [
      "-e",
      `require("net").createServer().listen(${testPort}, "127.0.0.1")`,
    ]);
    await waitFor(() => isPortListening(), 5000);

    // Now install and start the service — it won't be able to bind the port
    const plistContent = writePlist();
    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);

    // Service process starts but the port is taken.
    // Regardless of whether the service crashes or runs with port error,
    // bootout should still clean up the registration.
    await new Promise((r) => setTimeout(r, 2000));
    await mgr.bootoutAndWaitForExit(CONTROLLER_LABEL, 10000);
    expect(isLabelRegistered()).toBe(false);

    // Clean up blocker
    blocker.kill("SIGKILL");
    await waitFor(() => !isPortListening(), 5000);
  }, 30000);

  // -----------------------------------------------------------------------
  // 14. bootout on already-stopped service is idempotent
  // -----------------------------------------------------------------------
  it("bootout on non-running/non-registered service does not throw", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });

    // bootoutAndWaitForExit on a label that was never registered
    await expect(
      mgr.bootoutAndWaitForExit(`${LABEL_PREFIX}.ghost`, 3000),
    ).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 15. teardownLaunchdServices with non-existent labels is safe
  // -----------------------------------------------------------------------
  it("teardownLaunchdServices with non-existent labels completes without error", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const { teardownLaunchdServices } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const mgr = new LaunchdManager({ plistDir });

    await expect(
      teardownLaunchdServices({
        launchd: mgr,
        labels: {
          controller: `${LABEL_PREFIX}.nope1`,
          openclaw: `${LABEL_PREFIX}.nope2`,
        },
        plistDir,
      }),
    ).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 16. waitForExit with PID that dies during bootout
  // -----------------------------------------------------------------------
  it("waitForExit handles process dying exactly during bootout", async () => {
    const { LaunchdManager } = await import(
      "../../apps/desktop/main/services/launchd-manager"
    );
    const mgr = new LaunchdManager({ plistDir });
    const plistContent = writePlist();

    await mgr.installService(CONTROLLER_LABEL, plistContent);
    await mgr.startService(CONTROLLER_LABEL);
    await waitFor(() => getServicePid() !== null, 10000);

    const pid = getServicePid();
    expect(pid).not.toBeNull();

    // Kill process manually right before bootout (race condition)
    process.kill(pid ?? -1, "SIGKILL");

    // bootoutAndWaitForExit should handle this gracefully
    await expect(
      mgr.bootoutAndWaitForExit(CONTROLLER_LABEL, 10000),
    ).resolves.toBeUndefined();

    // Should be clean
    expect(isPortListening()).toBe(false);
  }, 20000);
});
