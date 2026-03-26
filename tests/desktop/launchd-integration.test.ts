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
});
