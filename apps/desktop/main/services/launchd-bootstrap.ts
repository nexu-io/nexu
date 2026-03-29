/**
 * Launchd Bootstrap - Desktop startup using launchd process management
 *
 * This module handles the launchd-based startup sequence:
 * 1. Ensure launchd services are installed (Controller, OpenClaw)
 * 2. Start services via launchd
 * 3. Start embedded web server
 * 4. Handle graceful shutdown
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { createConnection } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import {
  decideLaunchdRecovery,
  detectStaleLaunchdSession,
} from "../lifecycle/launchd-recovery-policy";
import {
  deleteLaunchdRuntimeSession,
  readLaunchdRuntimeSession,
  writeLaunchdRuntimeSession,
} from "../lifecycle/launchd-session-store";
import { platform } from "../platforms/platform-backends";
import {
  type EmbeddedWebServer,
  startEmbeddedWebServer,
} from "./embedded-web-server";
import { type LaunchdManager, SERVICE_LABELS } from "./launchd-manager";
import { type PlistEnv, generatePlist } from "./plist-generator";
export {
  ensureExternalNodeRunner,
  resolveLaunchdPaths,
} from "../platforms/mac/launchd-paths";

export interface LaunchdBootstrapEnv {
  /** Is this a development build */
  isDev: boolean;
  /** Controller HTTP port */
  controllerPort: number;
  /** OpenClaw gateway port */
  openclawPort: number;
  /** Web UI port */
  webPort: number;
  /** Path to web static files */
  webRoot: string;
  /** Path to node binary */
  nodePath: string;
  /** Path to controller entry point */
  controllerEntryPath: string;
  /** Path to openclaw binary */
  openclawPath: string;
  /** OpenClaw config path */
  openclawConfigPath: string;
  /** OpenClaw state directory */
  openclawStateDir: string;
  /** Controller working directory */
  controllerCwd: string;
  /** OpenClaw working directory */
  openclawCwd: string;
  /** NEXU_HOME override for controller (dev: repo-local path) */
  nexuHome?: string;
  /** Gateway auth token */
  gatewayToken?: string;
  /** Plist directory (default: ~/Library/LaunchAgents or repo-local for dev) */
  plistDir?: string;
  /** App version (used to detect reinstalls and prevent attaching to stale services) */
  appVersion?: string;
  /** Electron userData path — persisted for cross-build attach validation */
  userDataPath?: string;
  /** Build source identifier (e.g. "stable", "beta") — persisted for cross-build attach validation */
  buildSource?: string;

  // --- Controller env vars (must match manifests.ts) ---
  /** Web UI URL for CORS/redirects */
  webUrl: string;
  /** OpenClaw skills directory */
  openclawSkillsDir: string;
  /** Bundled static skills directory */
  skillhubStaticSkillsDir: string;
  /** Platform templates directory */
  platformTemplatesDir: string;
  /** OpenClaw binary path */
  openclawBinPath: string;
  /** OpenClaw extensions directory */
  openclawExtensionsDir: string;
  /** Skill NODE_PATH for controller module resolution */
  skillNodePath: string;
  /** TMPDIR for openclaw temp files */
  openclawTmpDir: string;
}

export interface LaunchdBootstrapResult {
  launchd: LaunchdManager;
  webServer: EmbeddedWebServer;
  labels: {
    controller: string;
    openclaw: string;
  };
  /** Promise that always settles with controller readiness outcome. */
  controllerReady: Promise<ControllerReadyResult>;
  /** Actual ports used (may differ from requested if OS-assigned or recovered) */
  effectivePorts: {
    controllerPort: number;
    openclawPort: number;
    webPort: number;
  };
  /** True if services were already running and we attached to them */
  isAttach: boolean;
}

type ControllerReadyResult = { ok: true } | { ok: false; error: Error };

/**
 * Get unified log directory path.
 * In dev mode, logs go under the NEXU_HOME directory.
 * In production, defaults to ~/.nexu/logs.
 */
export function getLogDir(nexuHome?: string): string {
  if (nexuHome) {
    return path.join(nexuHome, "logs");
  }
  return path.join(os.homedir(), ".nexu", "logs");
}

/**
 * Ensure log directory exists.
 */
async function ensureLogDir(nexuHome?: string): Promise<string> {
  const logDir = getLogDir(nexuHome);
  await fs.mkdir(logDir, { recursive: true });
  return logDir;
}

/**
 * Wait for controller to be ready by polling health endpoint.
 *
 * NOTE: This uses /api/auth/get-session (not /health) intentionally.
 * The /health endpoint returns 200 as soon as the HTTP server binds,
 * before middleware, DB, and auth are initialized. /api/auth/get-session
 * validates deeper initialization (DB connection, session middleware)
 * which is what the desktop shell needs before showing the UI.
 * The orchestrator mode (index.ts) uses /health because it manages
 * startup ordering itself and only needs to know the port is listening.
 */
async function waitForControllerReadiness(
  port: number,
  timeoutMs = 15000,
): Promise<void> {
  const startedAt = Date.now();
  const probeUrl = `http://127.0.0.1:${port}/api/auth/get-session`;
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(probeUrl, {
        headers: { Accept: "application/json" },
      });
      if (response.status < 500) {
        console.log(
          `Controller ready via ${probeUrl} status=${response.status} after ${Date.now() - startedAt}ms`,
        );
        return;
      }
    } catch {
      // Ignore transient failures during startup
    }
    // Adaptive polling: start aggressive (50ms), increase to 250ms
    const delay = Math.min(50 + attempt * 50, 250);
    await new Promise((r) => setTimeout(r, delay));
    attempt++;
  }

  throw new Error(`Controller readiness probe timed out for ${probeUrl}`);
}

export async function deleteRuntimePorts(plistDir: string): Promise<void> {
  await deleteLaunchdRuntimeSession(plistDir);
}

// ---------------------------------------------------------------------------
// Attach — detect and reuse already-running launchd services
// ---------------------------------------------------------------------------

async function probeControllerHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Process liveness check
// ---------------------------------------------------------------------------

/**
 * Check if a process with the given PID is still alive.
 * Uses kill(pid, 0) which doesn't send a signal but checks for existence.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Port occupier detection
// ---------------------------------------------------------------------------

async function detectPortOccupier(
  port: number,
): Promise<{ pid: number } | null> {
  try {
    const { stdout } = await execFileAsync("lsof", [
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    const pid = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(pid) ? null : { pid };
  } catch {
    return null;
  }
}

/**
 * Find a free port starting from the preferred port.
 * Tries preferred, then preferred+1, +2, ... up to 10 attempts, then port 0 (OS-assigned).
 */
async function findFreePort(preferred: number): Promise<number> {
  for (let offset = 0; offset < 10; offset++) {
    const port = preferred + offset;
    const occupier = await detectPortOccupier(port);
    if (!occupier) return port;
  }
  // All 10 ports occupied — let OS assign
  return 0;
}

// ---------------------------------------------------------------------------
// Stale plist cleanup — detect plists from a different app installation
// ---------------------------------------------------------------------------

/**
 * Check if existing plists on disk are stale (from a different app version or
 * installation path). Compares the full plist content against what we would
 * generate now — since generatePlist() is deterministic, any difference means
 * the plist is outdated (new env vars, different ports, different paths, etc.).
 *
 * Stale plists are bootout + deleted so the bootstrap can install fresh ones.
 */
async function cleanupStalePlists(
  launchd: LaunchdManager,
  plistDir: string,
  labels: { controller: string; openclaw: string },
  plistEnv: PlistEnv,
): Promise<void> {
  let cleaned = false;
  for (const [type, label] of Object.entries(labels) as [
    "controller" | "openclaw",
    string,
  ][]) {
    const plistPath = path.join(plistDir, `${label}.plist`);
    let existing: string;
    try {
      existing = await fs.readFile(plistPath, "utf8");
    } catch {
      continue; // No plist file — nothing to clean
    }

    const expected = generatePlist(type, plistEnv);
    if (existing === expected) {
      continue; // Content matches — not stale
    }

    console.log(`Stale plist detected for ${label}, cleaning up`);
    try {
      await launchd.bootoutService(label);
    } catch {
      // May not be registered — that's fine
    }
    try {
      await fs.unlink(plistPath);
    } catch {
      // Best effort
    }
    cleaned = true;
  }

  // If any plist was stale, runtime-ports.json is also stale
  if (cleaned) {
    try {
      await fs.unlink(path.join(plistDir, "runtime-ports.json"));
    } catch {
      // Best effort
    }
  }
}

/**
 * Bootstrap desktop using launchd for process management.
 */
export async function bootstrapWithLaunchd(
  env: LaunchdBootstrapEnv,
): Promise<LaunchdBootstrapResult> {
  const logDir = await ensureLogDir(env.nexuHome);
  const plistDir = env.plistDir ?? getDefaultPlistDir(env.isDev);

  // Create launchd manager
  const launchd = platform.supervisor.createLaunchdSupervisor({
    plistDir,
  });

  const labels = {
    controller: SERVICE_LABELS.controller(env.isDev),
    openclaw: SERVICE_LABELS.openclaw(env.isDev),
  };

  // --- Clean up stale plists from a previous/different installation ---
  // Build a plistEnv with default ports for comparison. If existing plists
  // differ from what we'd generate now, they're from a different version or
  // installation and should be cleaned up.
  const systemPath = process.env.PATH;
  const nodeModulesPath = path.dirname(path.dirname(env.openclawPath));
  const cleanupPlistEnv: PlistEnv = {
    isDev: env.isDev,
    logDir,
    controllerPort: env.controllerPort,
    openclawPort: env.openclawPort,
    nodePath: env.nodePath,
    controllerEntryPath: env.controllerEntryPath,
    openclawPath: env.openclawPath,
    openclawConfigPath: env.openclawConfigPath,
    openclawStateDir: env.openclawStateDir,
    controllerCwd: env.controllerCwd,
    openclawCwd: env.openclawCwd,
    nexuHome: env.nexuHome,
    gatewayToken: env.gatewayToken,
    systemPath,
    nodeModulesPath,
    webUrl: env.webUrl,
    openclawSkillsDir: env.openclawSkillsDir,
    skillhubStaticSkillsDir: env.skillhubStaticSkillsDir,
    platformTemplatesDir: env.platformTemplatesDir,
    openclawBinPath: env.openclawBinPath,
    openclawExtensionsDir: env.openclawExtensionsDir,
    skillNodePath: env.skillNodePath,
    openclawTmpDir: env.openclawTmpDir,
  };
  await cleanupStalePlists(launchd, plistDir, labels, cleanupPlistEnv);

  // --- Kill orphan processes that are NOT managed by launchd ---
  // Only kill processes that are NOT currently registered launchd services.
  // A failed update install or force-killed Electron can leave processes
  // running without valid launchd registration — those block port binding.
  const [ctrlStatus, ocStatus] = await Promise.all([
    launchd.getServiceStatus(labels.controller),
    launchd.getServiceStatus(labels.openclaw),
  ]);
  // Only run orphan cleanup if neither service is registered with launchd.
  // If services ARE registered, they're legitimate launchd-managed processes.
  if (ctrlStatus.status === "unknown" && ocStatus.status === "unknown") {
    await killOrphanNexuProcesses();
  }

  // --- Recover ports from previous session if available ---
  // Single read — used for both stale session detection and port recovery.
  let recovered = await readLaunchdRuntimeSession(plistDir);

  // Detect and clean up stale sessions from a Force Quit.
  // When the user Force Quits Electron, the quit handler doesn't run and
  // launchd services stay alive permanently due to KeepAlive. Detect this
  // by checking if the previous Electron PID is dead and the metadata is
  // older than 5 minutes.
  if (recovered) {
    const staleSession = detectStaleLaunchdSession({
      metadata: recovered,
      isElectronAlive: isProcessAlive(recovered.electronPid),
    });
    if (staleSession.stale) {
      console.log(staleSession.reason);
      await Promise.allSettled([
        launchd.bootoutService(labels.controller),
        launchd.bootoutService(labels.openclaw),
      ]);
      await deleteRuntimePorts(plistDir);
      recovered = null; // Force fresh start
    }
  }
  const [controllerStatus, openclawStatus] = await Promise.all([
    launchd.getServiceStatus(labels.controller),
    launchd.getServiceStatus(labels.openclaw),
  ]);

  const controllerRunning = controllerStatus.status === "running";
  const openclawRunning = openclawStatus.status === "running";
  const anyRunning = controllerRunning || openclawRunning;

  // If we have a previous session and at least one service is still running,
  // validate and reuse the recovered ports. Otherwise use fresh ports.
  let useRecoveredPorts = false;
  let effectivePorts = {
    controllerPort: env.controllerPort,
    openclawPort: env.openclawPort,
    webPort: env.webPort,
  };

  const recoveryDecision = decideLaunchdRecovery({
    recovered,
    env: {
      isDev: env.isDev,
      appVersion: env.appVersion,
      nexuHome: env.nexuHome,
      openclawStateDir: env.openclawStateDir,
      userDataPath: env.userDataPath,
      buildSource: env.buildSource,
    },
    anyRunning,
    runningNexuHome:
      controllerStatus.env?.NEXU_HOME ?? openclawStatus.env?.NEXU_HOME,
    defaultWebPort: env.webPort,
    previousElectronAlive:
      recovered != null ? isProcessAlive(recovered.electronPid) : undefined,
  });

  if (recoveryDecision.action === "teardown-stale-services") {
    console.log(recoveryDecision.reason);
    await Promise.allSettled([
      controllerRunning
        ? launchd.bootoutService(labels.controller)
        : Promise.resolve(),
      openclawRunning
        ? launchd.bootoutService(labels.openclaw)
        : Promise.resolve(),
    ]);
    if (recoveryDecision.deleteSession) {
      await deleteRuntimePorts(plistDir).catch(() => {});
    }
  } else if (recoveryDecision.action === "reuse-ports") {
    if (!recoveryDecision.previousElectronAlive && recovered) {
      console.log(
        `Previous Electron (pid=${recovered.electronPid}) is dead, web port ${recovered.webPort} likely stale`,
      );
    }
    effectivePorts = recoveryDecision.effectivePorts;
    useRecoveredPorts = true;
    console.log(recoveryDecision.reason);
  }

  // --- Per-service: validate running ones, start missing ones ---

  // Health check running services
  let controllerHealthy = false;
  let openclawHealthy = false;
  let needsControllerReady = true;

  if (controllerRunning && useRecoveredPorts) {
    controllerHealthy = await probeControllerHealth(
      effectivePorts.controllerPort,
    );
    if (controllerHealthy) {
      console.log("Controller already running and healthy");
      needsControllerReady = false;
    } else {
      console.log("Controller running but unhealthy, restarting...");
      try {
        await launchd.bootoutService(labels.controller);
      } catch {
        /* best effort */
      }
    }
  }

  if (openclawRunning && useRecoveredPorts) {
    openclawHealthy = await probePort(effectivePorts.openclawPort);
    if (openclawHealthy) {
      console.log("OpenClaw already running and healthy");
    } else {
      console.log("OpenClaw running but port not listening, restarting...");
      try {
        await launchd.bootoutService(labels.openclaw);
      } catch {
        /* best effort */
      }
    }
  }

  // Resolve port conflicts BEFORE generating plists. If a port is occupied
  // (e.g. packaged app running on the same port), find a free alternative.
  // This must happen before plist generation because the port is baked into
  // the plist's PORT environment variable.
  if (!controllerHealthy) {
    const freePort = await findFreePort(effectivePorts.controllerPort);
    if (freePort !== effectivePorts.controllerPort) {
      console.log(
        `Controller port ${effectivePorts.controllerPort} occupied, using ${freePort}`,
      );
      effectivePorts.controllerPort = freePort;
    }
  }
  if (!openclawHealthy) {
    const freePort = await findFreePort(effectivePorts.openclawPort);
    if (freePort !== effectivePorts.openclawPort) {
      console.log(
        `OpenClaw port ${effectivePorts.openclawPort} occupied, using ${freePort}`,
      );
      effectivePorts.openclawPort = freePort;
    }
  }

  // Build plistEnv with final resolved ports
  const plistEnv: PlistEnv = {
    ...cleanupPlistEnv,
    controllerPort: effectivePorts.controllerPort,
    openclawPort: effectivePorts.openclawPort,
  };

  // Install + start any services that aren't healthy.
  // Always generate the plist and pass to installService — it detects content
  // changes and bootout + re-bootstraps when needed (fixes config drift after
  // app upgrades).
  const ensureService = async (
    label: string,
    type: "controller" | "openclaw",
  ) => {
    const plist = generatePlist(type, plistEnv);
    await launchd.installService(label, plist);
  };

  const ensureRunning = async (label: string) => {
    const status = await launchd.getServiceStatus(label);
    if (status.status !== "running") {
      await launchd.startService(label);
      console.log(`Started ${label}`);
    }
  };

  if (!controllerHealthy) {
    await ensureService(labels.controller, "controller");
    await ensureRunning(labels.controller);
  }
  if (!openclawHealthy) {
    await ensureService(labels.openclaw, "openclaw");
    await ensureRunning(labels.openclaw);
  }

  // Start embedded web server with port retry.
  // Try up to WEB_PORT_ATTEMPTS adjacent ports, then fall back to port 0
  // (OS-assigned) as a last resort.
  let webServer: EmbeddedWebServer | undefined;
  const WEB_PORT_ATTEMPTS = 5;
  for (let offset = 0; offset < WEB_PORT_ATTEMPTS; offset++) {
    const tryPort = effectivePorts.webPort + offset;
    try {
      webServer = await startEmbeddedWebServer({
        port: tryPort,
        webRoot: env.webRoot,
        controllerPort: effectivePorts.controllerPort,
      });
      break;
    } catch (err: unknown) {
      // Only retry on port-occupied errors; re-throw other failures immediately
      const code =
        err instanceof Error && "code" in err
          ? (err as { code: string }).code
          : undefined;
      if (code !== "EADDRINUSE") {
        throw err;
      }
      console.log(
        `Web port ${tryPort} occupied, trying next${offset === WEB_PORT_ATTEMPTS - 2 ? " (then OS-assigned fallback)" : ""}`,
      );
    }
  }
  // Last resort: let OS pick a free port
  if (!webServer) {
    try {
      webServer = await startEmbeddedWebServer({
        port: 0,
        webRoot: env.webRoot,
        controllerPort: effectivePorts.controllerPort,
      });
    } catch {
      throw new Error(
        "Failed to start embedded web server: all port attempts exhausted (including OS-assigned)",
      );
    }
  }
  if (!webServer) {
    throw new Error("Failed to start embedded web server: no server created");
  }
  // Update effective port to actual bound port (may differ if OS-assigned)
  effectivePorts.webPort = webServer.port;

  console.log(
    `Services ready (controller=${effectivePorts.controllerPort} openclaw=${effectivePorts.openclawPort})`,
  );

  // Controller readiness
  const controllerReady: Promise<ControllerReadyResult> = needsControllerReady
    ? waitForControllerReadiness(effectivePorts.controllerPort)
        .then(() => {
          console.log("Controller is ready");
          return { ok: true } as const;
        })
        .catch((error: unknown) => ({
          ok: false,
          error:
            error instanceof Error
              ? error
              : new Error(`Controller readiness failed: ${String(error)}`),
        }))
    : Promise.resolve({ ok: true });

  // Persist port metadata (including identity fields for cross-build validation)
  await writeLaunchdRuntimeSession(plistDir, {
    writtenAt: new Date().toISOString(),
    electronPid: process.pid,
    controllerPort: effectivePorts.controllerPort,
    openclawPort: effectivePorts.openclawPort,
    webPort: effectivePorts.webPort,
    nexuHome: env.nexuHome ?? path.join(os.homedir(), ".nexu"),
    isDev: env.isDev,
    appVersion: env.appVersion,
    openclawStateDir: env.openclawStateDir,
    userDataPath: env.userDataPath,
    buildSource: env.buildSource,
  });

  return {
    launchd,
    webServer,
    labels,
    controllerReady,
    effectivePorts,
    isAttach: useRecoveredPorts,
  };
}

/**
 * Gracefully stop all services managed by launchd.
 */
export async function stopAllServices(
  launchd: LaunchdManager,
  labels: { controller: string; openclaw: string },
): Promise<void> {
  console.log("Stopping OpenClaw...");
  await launchd.stopServiceGracefully(labels.openclaw);

  console.log("Stopping Controller...");
  await launchd.stopServiceGracefully(labels.controller);

  console.log("All services stopped");
}

/**
 * Fully tear down launchd services for a clean app exit.
 *
 * This is the single, authoritative shutdown sequence used by both the quit
 * handler ("Quit Completely") and the auto-updater ("Install Update").
 *
 * The sequence:
 * 1. Bootout each service (unregisters from launchd so KeepAlive cannot
 *    respawn it), then wait for the process to actually exit. If the process
 *    survives the timeout, SIGKILL is sent using the PID captured *before*
 *    the bootout (after bootout, `launchctl print` may no longer see it).
 * 2. Delete runtime-ports.json so the next launch does a clean cold start.
 * 3. As a last resort, scan for orphan Nexu processes by name pattern and
 *    kill them — this handles edge cases where a previous crashed session
 *    left processes that are no longer managed by any launchd label.
 */
export async function teardownLaunchdServices(opts: {
  launchd: LaunchdManager;
  labels: { controller: string; openclaw: string };
  plistDir: string;
  /** Per-service bootout timeout in ms (default 5000) */
  timeoutMs?: number;
}): Promise<void> {
  const { launchd, labels, plistDir, timeoutMs = 5000 } = opts;

  // Bootout openclaw first (it depends on controller), then controller
  for (const label of [labels.openclaw, labels.controller]) {
    try {
      await launchd.bootoutAndWaitForExit(label, timeoutMs);
    } catch (err) {
      console.error(
        `teardown: error stopping ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Delete runtime-ports.json so next launch does a clean cold start
  await deleteRuntimePorts(plistDir).catch(() => {});

  // Final safety net: kill any orphan Nexu processes that survived bootout
  // (e.g. from a previous crashed session with stale launchd registrations).
  await killOrphanNexuProcesses();
}

/**
 * Kill orphan Nexu-related processes that are not managed by launchd.
 *
 * This catches processes left behind by a crashed Electron session, a failed
 * update install, or manual launchd manipulation.
 *
 * Lookup hierarchy:
 * 1. Authoritative sources: launchd labels (launchctl print) + runtime-ports.json
 *    — these are the most reliable because they directly identify our processes.
 * 2. Fallback: pgrep pattern matching against NEXU_PROCESS_PATTERNS.
 *    — only used if the authoritative sources return no results, since pgrep
 *    can false-positive on editors, grep commands, etc.
 */
async function killOrphanNexuProcesses(): Promise<void> {
  // Try authoritative sources first
  let pids = await findNexuProcessPidsByLabel();

  // Fall back to pgrep pattern matching only if authoritative sources found nothing.
  // Pass excludeProcessTree=true to avoid killing our own child processes.
  if (pids.length === 0) {
    pids = await findNexuProcessPids(true);
  }

  for (const pid of pids) {
    console.warn(`teardown: killing orphan process pid=${pid}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ESRCH — already gone
    }
  }
}

/**
 * Process patterns used for detecting Nexu sidecar processes.
 * Shared between killOrphanNexuProcesses and ensureNexuProcessesDead so
 * they agree on what constitutes a "Nexu process".
 */
// Patterns must be specific enough to avoid matching unrelated processes
// (e.g. an editor with the file open, or a grep searching for these paths).
// Prefix with "node" to only match actual Node.js processes.
const NEXU_PROCESS_PATTERNS = [
  "node.*controller/dist/index.js",
  "node.*openclaw.mjs gateway",
  "openclaw-gateway",
] as const;

/**
 * Collect the current process tree PIDs (current PID + all descendants) so
 * they can be excluded from pgrep results.
 */
async function getCurrentProcessTreePids(): Promise<Set<number>> {
  const treePids = new Set<number>();
  treePids.add(process.pid);
  try {
    // pgrep -P <ppid> returns direct children of the given PID
    const { stdout } = await execFileAsync("pgrep", [
      "-P",
      String(process.pid),
    ]);
    for (const line of stdout.trim().split("\n")) {
      const pid = Number.parseInt(line, 10);
      if (pid > 0) treePids.add(pid);
    }
  } catch {
    // No children or pgrep error — just exclude self
  }
  return treePids;
}

/**
 * Find Nexu process PIDs using authoritative sources:
 * 1. launchctl print — gets PID directly from launchd service labels
 * 2. runtime-ports.json — gets stored electron PID
 *
 * Returns deduplicated PIDs excluding the current process tree.
 */
async function findNexuProcessPidsByLabel(): Promise<number[]> {
  const allPids = new Set<number>();
  const uid = os.userInfo().uid;

  // Check both dev and production labels
  const labelsToCheck = [
    SERVICE_LABELS.controller(true),
    SERVICE_LABELS.controller(false),
    SERVICE_LABELS.openclaw(true),
    SERVICE_LABELS.openclaw(false),
  ];

  for (const label of labelsToCheck) {
    try {
      const { stdout } = await execFileAsync("launchctl", [
        "print",
        `gui/${uid}/${label}`,
      ]);
      const pidMatch = stdout.match(/pid\s*=\s*(\d+)/i);
      if (pidMatch) {
        const pid = Number.parseInt(pidMatch[1], 10);
        if (pid > 0) allPids.add(pid);
      }
    } catch {
      // Service not registered — expected
    }
  }

  // Also check runtime-ports.json in both dev and production plist dirs
  for (const isDev of [true, false]) {
    const plistDir = getDefaultPlistDir(isDev);
    const recovered = await readLaunchdRuntimeSession(plistDir);
    if (recovered?.electronPid && recovered.electronPid > 0) {
      // Only include the stored electron PID if it's still alive but is NOT
      // our current process — it's a stale leftover from a previous session.
      if (
        isProcessAlive(recovered.electronPid) &&
        recovered.electronPid !== process.pid
      ) {
        allPids.add(recovered.electronPid);
      }
    }
  }

  // Exclude current process tree
  const treePids = await getCurrentProcessTreePids();
  for (const pid of treePids) {
    allPids.delete(pid);
  }

  return Array.from(allPids);
}

/**
 * Find all PIDs matching Nexu sidecar process patterns.
 * Returns deduplicated PIDs excluding the current process.
 *
 * @param excludeProcessTree - If true, excludes the entire current process
 *   tree (not just the current PID). Used by killOrphanNexuProcesses to
 *   avoid killing our own child processes. Default: false.
 */
async function findNexuProcessPids(
  excludeProcessTree = false,
): Promise<number[]> {
  const allPids = new Set<number>();
  const excludePids = excludeProcessTree
    ? await getCurrentProcessTreePids()
    : new Set([process.pid]);

  for (const pattern of NEXU_PROCESS_PATTERNS) {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-f", pattern]);
      for (const line of stdout.trim().split("\n")) {
        const pid = Number.parseInt(line, 10);
        if (pid > 0 && !excludePids.has(pid)) {
          allPids.add(pid);
        }
      }
    } catch {
      // pgrep exits 1 when no matches — expected
    }
  }

  return Array.from(allPids);
}

/**
 * Check whether any process holds file handles to critical update paths.
 *
 * Uses `lsof` to inspect whether the .app bundle or the extracted sidecar
 * directories are still referenced by a running process. This is the final
 * evidence-based gate before deciding whether to proceed with an update.
 *
 * Returns `locked: false` if no handles are found (safe to install) or if
 * lsof fails (best-effort — proceed optimistically).
 */
export async function checkCriticalPathsLocked(): Promise<{
  locked: boolean;
  lockedPaths: string[];
}> {
  // Critical paths that, if locked, would cause an update install to fail
  // or leave the app in a corrupt state.
  const criticalPaths = [
    // The .app bundle itself (Finder checks this)
    process.execPath.includes(".app/")
      ? process.execPath.replace(/\/Contents\/.*$/, "")
      : null,
    // Extracted runner (launchd services reference this)
    path.join(os.homedir(), ".nexu", "runtime", "nexu-runner.app"),
    // Extracted controller sidecar
    path.join(os.homedir(), ".nexu", "runtime", "controller-sidecar"),
    // Extracted openclaw sidecar
    path.join(os.homedir(), ".nexu", "runtime", "openclaw-sidecar"),
  ].filter((p): p is string => p !== null);

  const lockedPaths: string[] = [];

  for (const criticalPath of criticalPaths) {
    try {
      // lsof +D checks for any open file under the directory.
      // Exit code 0 = something found, exit code 1 = nothing found.
      const { stdout } = await execFileAsync("lsof", ["+D", criticalPath], {
        timeout: 5_000,
      });
      // Parse lsof output by PID column (2nd field) to avoid false
      // positives when our PID digits appear elsewhere in the line.
      const hasOtherHolder = stdout.split("\n").some((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("COMMAND")) return false;
        const [, pidToken] = trimmed.split(/\s+/, 3);
        return Number(pidToken) !== process.pid;
      });
      if (hasOtherHolder) {
        lockedPaths.push(criticalPath);
      }
    } catch {
      // lsof exit 1 = no open files (good), or lsof not found / timeout.
      // Either way, this path is not locked.
    }
  }

  return {
    locked: lockedPaths.length > 0,
    lockedPaths,
  };
}

/**
 * Verification gate: confirm all Nexu sidecar processes are dead.
 *
 * This is the final safety check before an update install. It polls for
 * surviving Nexu processes (via pgrep) and sends SIGKILL to any it finds,
 * looping until either:
 * - No matching processes remain (success), or
 * - The timeout is reached (proceeds anyway — the installer may still
 *   succeed if file handles were released, and the next launch has its
 *   own orphan cleanup as a fallback).
 *
 * Call this AFTER teardownLaunchdServices + orchestrator.dispose, as a
 * belt-and-suspenders check before autoUpdater.quitAndInstall().
 */
export async function ensureNexuProcessesDead(opts?: {
  /** Maximum time to wait in ms (default 15000) */
  timeoutMs?: number;
  /** Polling interval in ms (default 500) */
  intervalMs?: number;
}): Promise<{ clean: boolean; remainingPids: number[] }> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const intervalMs = opts?.intervalMs ?? 500;
  const startTime = Date.now();

  let remainingPids: number[] = [];
  let round = 0;

  while (Date.now() - startTime < timeoutMs) {
    // Combine authoritative sources (launchd labels, stored PIDs) with
    // pattern matching to catch both launchd-managed and orphan processes.
    // This ensures packaged-mode Electron-as-Node runners (whose process
    // name may not contain "node") are found via launchctl print.
    const [authPids, patternPids] = await Promise.all([
      findNexuProcessPidsByLabel(),
      findNexuProcessPids(),
    ]);
    const combined = new Set([...authPids, ...patternPids]);
    combined.delete(process.pid);
    remainingPids = Array.from(combined);

    if (remainingPids.length === 0) {
      if (round > 0) {
        console.log(
          `ensureNexuProcessesDead: all processes confirmed dead after ${round} round(s)`,
        );
      }
      return { clean: true, remainingPids: [] };
    }

    // Send SIGKILL to every survivor
    for (const pid of remainingPids) {
      console.warn(
        `ensureNexuProcessesDead: round ${round + 1} — killing pid=${pid}`,
      );
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ESRCH — already gone between pgrep and kill
      }
    }

    round++;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // Final check after timeout — same combined lookup
  const [finalAuth, finalPattern] = await Promise.all([
    findNexuProcessPidsByLabel(),
    findNexuProcessPids(),
  ]);
  const finalSet = new Set([...finalAuth, ...finalPattern]);
  finalSet.delete(process.pid);
  remainingPids = Array.from(finalSet);
  if (remainingPids.length === 0) {
    console.log(
      "ensureNexuProcessesDead: all processes confirmed dead after timeout",
    );
    return { clean: true, remainingPids: [] };
  }

  console.error(
    `ensureNexuProcessesDead: ${remainingPids.length} process(es) still alive after ${timeoutMs}ms: ${remainingPids.join(", ")}`,
  );
  return { clean: false, remainingPids };
}

/**
 * Get default plist directory based on environment.
 */
export function getDefaultPlistDir(isDev: boolean): string {
  if (isDev) {
    // Dev mode: use repo-local directory
    return path.join(getWorkspaceRoot(), ".tmp", "launchd");
  }
  // Production: use standard LaunchAgents directory
  return path.join(os.homedir(), "Library", "LaunchAgents");
}
