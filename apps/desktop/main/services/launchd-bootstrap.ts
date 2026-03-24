/**
 * Launchd Bootstrap - Desktop startup using launchd process management
 *
 * This module handles the launchd-based startup sequence:
 * 1. Ensure launchd services are installed (Controller, OpenClaw)
 * 2. Start services via launchd
 * 3. Start embedded web server
 * 4. Handle graceful shutdown
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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
}

/**
 * Get unified log directory path.
 */
export function getLogDir(): string {
  return path.join(os.homedir(), ".nexu", "logs");
}

/**
 * Ensure log directory exists.
 */
async function ensureLogDir(): Promise<string> {
  const logDir = getLogDir();
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

/**
 * Bootstrap desktop using launchd for process management.
 */
export async function bootstrapWithLaunchd(
  env: LaunchdBootstrapEnv,
): Promise<LaunchdBootstrapResult> {
  const logDir = await ensureLogDir();

  // Create launchd manager
  const launchd = new LaunchdManager({
    plistDir: env.plistDir,
  });

  const labels = {
    controller: SERVICE_LABELS.controller(env.isDev),
    openclaw: SERVICE_LABELS.openclaw(env.isDev),
  };

  // Prepare plist environment
  // Capture system PATH for launchd - launchd doesn't inherit shell env
  const systemPath = process.env.PATH;
  // Build NODE_PATH for TypeScript plugin resolution
  // OpenClaw plugins need to resolve dependencies like 'openclaw/plugin-sdk'
  // env.openclawPath = .../openclaw-runtime/node_modules/openclaw/openclaw.mjs
  // We need: .../openclaw-runtime/node_modules
  const nodeModulesPath = path.dirname(path.dirname(env.openclawPath));

  const plistEnv: PlistEnv = {
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
    gatewayToken: env.gatewayToken,
    systemPath,
    nodeModulesPath,
  };

  // 1. Ensure services are installed (parallel)
  console.log("Installing launchd services...");

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

  await Promise.all([
    ensureService(labels.controller, "controller"),
    ensureService(labels.openclaw, "openclaw"),
  ]);

  // 2. Start services in parallel
  console.log("Starting services...");

  const ensureRunning = async (label: string) => {
    const status = await launchd.getServiceStatus(label);
    if (status.status !== "running") {
      await launchd.startService(label);
    }
  };

  // Start both services and embedded web server in parallel
  const [, , webServer] = await Promise.all([
    ensureRunning(labels.controller),
    ensureRunning(labels.openclaw),
    startEmbeddedWebServer({
      port: env.webPort,
      webRoot: env.webRoot,
      controllerPort: env.controllerPort,
    }),
  ]);

  console.log(
    `Services started, web server ready on http://127.0.0.1:${env.webPort}`,
  );

  // 5. Create background readiness promise (non-blocking)
  const controllerReady = waitForControllerReadiness(env.controllerPort).then(
    () => console.log("Controller is ready"),
  );

  return {
    launchd,
    webServer,
    labels,
    controllerReady,
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
