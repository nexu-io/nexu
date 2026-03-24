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
import { ensurePackagedOpenclawSidecar } from "../runtime/manifests";
import {
  type EmbeddedWebServer,
  startEmbeddedWebServer,
} from "./embedded-web-server";
import { LaunchdManager, SERVICE_LABELS } from "./launchd-manager";
import { type PlistEnv, generatePlist } from "./plist-generator";

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
}

export interface LaunchdBootstrapResult {
  launchd: LaunchdManager;
  webServer: EmbeddedWebServer;
  labels: {
    controller: string;
    openclaw: string;
  };
  /** Promise that resolves when controller is ready (for optional awaiting) */
  controllerReady: Promise<void>;
  /** If set, these are ports recovered from an attached session */
  attachedPorts?: {
    controllerPort: number;
    openclawPort: number;
    webPort: number;
  };
}

/** Metadata persisted between sessions for attach discovery */
interface RuntimePortsMetadata {
  writtenAt: string;
  electronPid: number;
  controllerPort: number;
  openclawPort: number;
  webPort: number;
  nexuHome: string;
  isDev: boolean;
}

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

// ---------------------------------------------------------------------------
// Runtime ports metadata — persisted across sessions for attach discovery
// ---------------------------------------------------------------------------

function getRuntimePortsPath(plistDir: string): string {
  return path.join(plistDir, "runtime-ports.json");
}

async function writeRuntimePorts(
  plistDir: string,
  meta: RuntimePortsMetadata,
): Promise<void> {
  await fs.writeFile(
    getRuntimePortsPath(plistDir),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

async function readRuntimePorts(
  plistDir: string,
): Promise<RuntimePortsMetadata | null> {
  try {
    const raw = await fs.readFile(getRuntimePortsPath(plistDir), "utf8");
    return JSON.parse(raw) as RuntimePortsMetadata;
  } catch {
    return null;
  }
}

export async function deleteRuntimePorts(plistDir: string): Promise<void> {
  try {
    await fs.unlink(getRuntimePortsPath(plistDir));
  } catch {
    // best effort
  }
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

async function tryAttachToRunningServices(opts: {
  launchd: LaunchdManager;
  labels: { controller: string; openclaw: string };
  plistDir: string;
  isDev: boolean;
  expectedNexuHome?: string;
  webRoot: string;
  controllerPort: number;
}): Promise<LaunchdBootstrapResult | null> {
  // 1. Read runtime-ports.json
  const meta = await readRuntimePorts(opts.plistDir);
  if (!meta) return null;

  // 2. Validate mode matches
  if (meta.isDev !== opts.isDev) {
    console.log("Attach: isDev mismatch, skipping");
    return null;
  }

  // 3. Check both services are running (parallel)
  const [controllerStatus, openclawStatus] = await Promise.all([
    opts.launchd.getServiceStatus(opts.labels.controller),
    opts.launchd.getServiceStatus(opts.labels.openclaw),
  ]);

  if (
    controllerStatus.status !== "running" ||
    openclawStatus.status !== "running"
  ) {
    console.log(
      `Attach: services not running (controller=${controllerStatus.status} openclaw=${openclawStatus.status})`,
    );
    return null;
  }

  // 4. Validate NEXU_HOME from controller env matches expectations
  const controllerNexuHome = controllerStatus.env?.NEXU_HOME;
  if (opts.expectedNexuHome && controllerNexuHome !== opts.expectedNexuHome) {
    console.log(
      `Attach: NEXU_HOME mismatch (expected=${opts.expectedNexuHome} actual=${controllerNexuHome}), tearing down`,
    );
    await Promise.allSettled([
      opts.launchd.bootoutService(opts.labels.openclaw),
      opts.launchd.bootoutService(opts.labels.controller),
    ]);
    return null;
  }

  // 5. Recover ports from running services
  const controllerPort = controllerStatus.env?.PORT
    ? Number(controllerStatus.env.PORT)
    : meta.controllerPort;
  const openclawPort = meta.openclawPort;

  // 6. Health probes (parallel)
  const [controllerHealthy, openclawListening] = await Promise.all([
    probeControllerHealth(controllerPort),
    probePort(openclawPort),
  ]);

  if (!controllerHealthy || !openclawListening) {
    console.log(
      `Attach: health check failed (controller=${controllerHealthy} openclaw=${openclawListening}), tearing down`,
    );
    await Promise.allSettled([
      opts.launchd.bootoutService(opts.labels.openclaw),
      opts.launchd.bootoutService(opts.labels.controller),
    ]);
    return null;
  }

  // 7. Start embedded web server
  let webPort = meta.webPort;
  let webServer: EmbeddedWebServer;
  try {
    webServer = await startEmbeddedWebServer({
      port: webPort,
      webRoot: opts.webRoot,
      controllerPort,
    });
  } catch {
    // Port occupied (previous Electron died without cleanup) — try fresh port
    webPort = 0; // OS assigns free port
    webServer = await startEmbeddedWebServer({
      port: webPort,
      webRoot: opts.webRoot,
      controllerPort,
    });
  }

  console.log(
    `Attached to running services (controller=${controllerPort} openclaw=${openclawPort} web=${webPort})`,
  );

  return {
    launchd: opts.launchd,
    webServer,
    labels: opts.labels,
    controllerReady: Promise.resolve(),
    attachedPorts: {
      controllerPort,
      openclawPort,
      webPort,
    },
  };
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
 * Bootstrap desktop using launchd for process management.
 */
export async function bootstrapWithLaunchd(
  env: LaunchdBootstrapEnv,
): Promise<LaunchdBootstrapResult> {
  const logDir = await ensureLogDir(env.nexuHome);
  const plistDir = env.plistDir ?? getDefaultPlistDir(env.isDev);

  // Create launchd manager
  const launchd = new LaunchdManager({
    plistDir,
  });

  const labels = {
    controller: SERVICE_LABELS.controller(env.isDev),
    openclaw: SERVICE_LABELS.openclaw(env.isDev),
  };

  // --- Recover ports from previous session if available ---
  const recovered = await readRuntimePorts(plistDir);
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

  if (recovered && anyRunning && recovered.isDev === env.isDev) {
    // Validate NEXU_HOME matches (don't attach to wrong environment)
    const runningNexuHome =
      controllerStatus.env?.NEXU_HOME ?? openclawStatus.env?.NEXU_HOME;
    const expectedNexuHome = env.nexuHome;

    if (
      !expectedNexuHome ||
      !runningNexuHome ||
      runningNexuHome === expectedNexuHome
    ) {
      effectivePorts = {
        controllerPort: recovered.controllerPort,
        openclawPort: recovered.openclawPort,
        webPort: recovered.webPort,
      };
      useRecoveredPorts = true;
      console.log(
        `Recovering ports from previous session (controller=${effectivePorts.controllerPort} openclaw=${effectivePorts.openclawPort} web=${effectivePorts.webPort})`,
      );
    } else {
      // NEXU_HOME mismatch — tear down stale services
      console.log(
        `NEXU_HOME mismatch (expected=${expectedNexuHome} actual=${runningNexuHome}), tearing down stale services`,
      );
      await Promise.allSettled([
        controllerRunning
          ? launchd.bootoutService(labels.controller)
          : Promise.resolve(),
        openclawRunning
          ? launchd.bootoutService(labels.openclaw)
          : Promise.resolve(),
      ]);
    }
  }

  // --- Per-service: validate running ones, start missing ones ---
  const systemPath = process.env.PATH;
  const nodeModulesPath = path.dirname(path.dirname(env.openclawPath));

  const plistEnv: PlistEnv = {
    isDev: env.isDev,
    logDir,
    controllerPort: effectivePorts.controllerPort,
    openclawPort: effectivePorts.openclawPort,
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
  };

  // Health check running services, install + start missing ones
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

  // Install + start any services that aren't healthy
  const ensureService = async (
    label: string,
    type: "controller" | "openclaw",
  ) => {
    if (!(await launchd.isServiceInstalled(label))) {
      const plist = generatePlist(type, plistEnv);
      await launchd.installService(label, plist);
      console.log(`Installed ${label}`);
    }
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
    // Check for port occupier before starting
    const occupier = await detectPortOccupier(effectivePorts.openclawPort);
    if (occupier) {
      console.warn(
        `Port ${effectivePorts.openclawPort} occupied by PID ${occupier.pid}, killing...`,
      );
      try {
        process.kill(occupier.pid, "SIGKILL");
        await new Promise((r) => setTimeout(r, 1000));
      } catch {
        /* best effort */
      }
    }
    await ensureService(labels.openclaw, "openclaw");
    await ensureRunning(labels.openclaw);
  }

  // Start embedded web server
  let webServer: EmbeddedWebServer;
  try {
    webServer = await startEmbeddedWebServer({
      port: effectivePorts.webPort,
      webRoot: env.webRoot,
      controllerPort: effectivePorts.controllerPort,
    });
  } catch {
    // Web port occupied — try next port
    effectivePorts.webPort = effectivePorts.webPort + 1;
    webServer = await startEmbeddedWebServer({
      port: effectivePorts.webPort,
      webRoot: env.webRoot,
      controllerPort: effectivePorts.controllerPort,
    });
  }

  console.log(
    `Services ready (controller=${effectivePorts.controllerPort} openclaw=${effectivePorts.openclawPort})`,
  );

  // Controller readiness
  const controllerReady = needsControllerReady
    ? waitForControllerReadiness(effectivePorts.controllerPort).then(() =>
        console.log("Controller is ready"),
      )
    : Promise.resolve();

  // Persist port metadata
  await writeRuntimePorts(plistDir, {
    writtenAt: new Date().toISOString(),
    electronPid: process.pid,
    controllerPort: effectivePorts.controllerPort,
    openclawPort: effectivePorts.openclawPort,
    webPort: effectivePorts.webPort,
    nexuHome: env.nexuHome ?? path.join(os.homedir(), ".nexu"),
    isDev: env.isDev,
  });

  return {
    launchd,
    webServer,
    labels,
    controllerReady,
    ...(useRecoveredPorts ? { attachedPorts: effectivePorts } : {}),
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
 * Check if launchd bootstrap is enabled.
 * Currently controlled by environment variable.
 */
export function isLaunchdBootstrapEnabled(): boolean {
  // Explicitly disabled
  if (process.env.NEXU_USE_LAUNCHD === "0") return false;
  // Explicitly enabled (dev scripts)
  if (process.env.NEXU_USE_LAUNCHD === "1") return true;
  // CI environments should use orchestrator mode
  if (process.env.CI) return false;
  // Packaged app on macOS: default to launchd
  // ELECTRON_IS_PACKAGED is not a real env var — check if running from
  // an .app bundle by looking at the executable path.
  const isPackaged = !process.execPath.includes("node_modules");
  if (isPackaged && process.platform === "darwin") return true;
  return false;
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

/**
 * Resolve paths for launchd bootstrap based on whether app is packaged.
 */
export function resolveLaunchdPaths(
  isPackaged: boolean,
  resourcesPath: string,
): {
  nodePath: string;
  controllerEntryPath: string;
  openclawPath: string;
  controllerCwd: string;
  openclawCwd: string;
} {
  if (isPackaged) {
    // Packaged app: extract openclaw sidecar from tar archive if needed,
    // then resolve paths to the extracted location.
    const runtimeDir = path.join(resourcesPath, "runtime");
    const nexuHome = path.join(os.homedir(), ".nexu");
    const openclawSidecarRoot = ensurePackagedOpenclawSidecar(
      runtimeDir,
      nexuHome,
    );
    return {
      nodePath: process.execPath,
      controllerEntryPath: path.join(
        runtimeDir,
        "controller",
        "dist",
        "index.js",
      ),
      openclawPath: path.join(
        openclawSidecarRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      ),
      controllerCwd: path.join(runtimeDir, "controller"),
      openclawCwd: openclawSidecarRoot,
    };
  }

  // Development: use local paths
  const repoRoot = getWorkspaceRoot();
  return {
    nodePath: process.execPath,
    controllerEntryPath: path.join(
      repoRoot,
      "apps",
      "controller",
      "dist",
      "index.js",
    ),
    openclawPath: path.join(
      repoRoot,
      "openclaw-runtime",
      "node_modules",
      "openclaw",
      "openclaw.mjs",
    ),
    controllerCwd: path.join(repoRoot, "apps", "controller"),
    openclawCwd: repoRoot,
  };
}
