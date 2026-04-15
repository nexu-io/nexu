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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import net, { createConnection } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  getSlimclawRuntimeRoot,
  resolveSlimclawRuntimeArtifacts,
  resolveSlimclawRuntimePaths,
} from "@nexu/slimclaw";

const execFileAsync = promisify(execFile);
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import { ensurePackagedOpenclawSidecar } from "../runtime/manifests";
import {
  type EmbeddedWebServer,
  startEmbeddedWebServer,
} from "./embedded-web-server";
import {
  LaunchdManager,
  SERVICE_LABELS,
  type ServiceStatus,
} from "./launchd-manager";
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
  /** Normalized proxy env propagated to controller/openclaw launchd services */
  proxyEnv: Record<string, string>;
  /** PostHog API key for controller analytics */
  posthogApiKey?: string;
  /** PostHog host for controller analytics */
  posthogHost?: string;
  /** Langfuse public key for controller/openclaw tracing */
  langfusePublicKey?: string;
  /** Langfuse secret key for controller/openclaw tracing */
  langfuseSecretKey?: string;
  /** Langfuse base URL for controller/openclaw tracing */
  langfuseBaseUrl?: string;
  /** Optional Node V8 coverage output directory */
  nodeV8Coverage?: string;
  /** Optional desktop E2E coverage mode switch */
  desktopE2ECoverage?: string;
  /** Optional desktop E2E coverage run identifier */
  desktopE2ECoverageRunId?: string;
  /** Optional structured logger for packaged mode (console.log is lost in packaged builds) */
  log?: (message: string) => void;
  /** Optional override for controller startup validation timeout (tests only). */
  controllerStartupValidationTimeoutMs?: number;
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

/** Metadata persisted between sessions for attach discovery */
interface RuntimePortsMetadata {
  writtenAt: string;
  electronPid: number;
  controllerPort: number;
  openclawPort: number;
  webPort: number;
  nexuHome: string;
  isDev: boolean;
  /** App version at the time ports were written. Used to detect reinstalls. */
  appVersion?: string;
  /** OpenClaw state directory — used to prevent cross-attach between builds sharing the same version. */
  openclawStateDir?: string;
  /** Electron userData path — used to prevent cross-attach between builds sharing the same version. */
  userDataPath?: string;
  /** Build source identifier (e.g. "stable", "beta", "dev") — used to prevent cross-attach. */
  buildSource?: string;
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
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  let attempt = 0;
  let lastProbeUrl = `http://127.0.0.1:${port}/api/internal/desktop/ready`;
  let lastFailureReason = "probe_timeout";

  while (Date.now() - startedAt < timeoutMs) {
    const result = await probeControllerReady(port, 2000);
    lastProbeUrl = result.probeUrl;
    if (result.ok) {
      console.log(
        `Controller ready via ${result.probeUrl} status=${result.status} after ${Date.now() - startedAt}ms`,
      );
      return;
    }
    lastFailureReason = result.reason;
    // Adaptive polling: start aggressive (50ms), increase to 250ms
    const delay = Math.min(50 + attempt * 50, 250);
    await new Promise((r) => setTimeout(r, delay));
    attempt++;
  }

  throw new Error(
    `Controller readiness probe timed out for ${lastProbeUrl} (reason=${lastFailureReason})`,
  );
}

type ControllerProbeFailureReason =
  | "port_unreachable"
  | "probe_timeout"
  | "probe_error"
  | "probe_status";

type ControllerStartupFailureReason =
  | "launchd_stopped"
  | "process_exited"
  | ControllerProbeFailureReason;

type ControllerReadyProbeResult =
  | {
      ok: true;
      probeUrl: string;
      status: number;
    }
  | {
      ok: false;
      probeUrl: string;
      reason: ControllerProbeFailureReason;
      status?: number;
    };

type ControllerStartupValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: ControllerStartupFailureReason;
      launchdStatus: ServiceStatus;
      probeUrl: string;
      probeStatus?: number;
    };

async function probeControllerReady(
  port: number,
  timeoutMs = 2000,
): Promise<ControllerReadyProbeResult> {
  const readyUrl = `http://127.0.0.1:${port}/api/internal/desktop/ready`;
  const sessionUrl = `http://127.0.0.1:${port}/api/auth/get-session`;

  const portListening = await probePort(port);
  if (!portListening) {
    return {
      ok: false,
      probeUrl: readyUrl,
      reason: "port_unreachable",
    };
  }

  try {
    const response = await fetch(readyUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      return { ok: true, probeUrl: readyUrl, status: response.status };
    }
    if (response.status !== 404) {
      return {
        ok: false,
        probeUrl: readyUrl,
        reason: "probe_status",
        status: response.status,
      };
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : undefined;
    return {
      ok: false,
      probeUrl: readyUrl,
      reason: name === "TimeoutError" ? "probe_timeout" : "probe_error",
    };
  }

  try {
    const response = await fetch(sessionUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status < 500) {
      return { ok: true, probeUrl: sessionUrl, status: response.status };
    }
    return {
      ok: false,
      probeUrl: sessionUrl,
      reason: "probe_status",
      status: response.status,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : undefined;
    return {
      ok: false,
      probeUrl: sessionUrl,
      reason: name === "TimeoutError" ? "probe_timeout" : "probe_error",
    };
  }
}

async function validateControllerStartup(opts: {
  launchd: LaunchdManager;
  label: string;
  port: number;
  probeTimeoutMs?: number;
}): Promise<ControllerStartupValidationResult> {
  const launchdStatus = await opts.launchd.getServiceStatus(opts.label);
  if (launchdStatus.status === "stopped") {
    return {
      ok: false,
      reason: launchdStatus.pid == null ? "launchd_stopped" : "process_exited",
      launchdStatus,
      probeUrl: `http://127.0.0.1:${opts.port}/api/internal/desktop/ready`,
    };
  }

  const probe = await probeControllerReady(
    opts.port,
    opts.probeTimeoutMs ?? 3000,
  );
  if (!probe.ok) {
    return {
      ok: false,
      reason: probe.reason,
      launchdStatus,
      probeUrl: probe.probeUrl,
      probeStatus: probe.status,
    };
  }

  return { ok: true };
}

async function waitForControllerStartupValidation(opts: {
  launchd: LaunchdManager;
  label: string;
  port: number;
  timeoutMs?: number;
  probeTimeoutMs?: number;
}): Promise<ControllerStartupValidationResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const startedAt = Date.now();
  let attempt = 0;
  let lastResult: ControllerStartupValidationResult | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastResult = await validateControllerStartup({
      launchd: opts.launchd,
      label: opts.label,
      port: opts.port,
      probeTimeoutMs: opts.probeTimeoutMs,
    });
    if (lastResult.ok) {
      return lastResult;
    }

    const delay = Math.min(100 + attempt * 100, 500);
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt++;
  }

  return (
    lastResult ?? {
      ok: false,
      reason: "probe_timeout",
      launchdStatus: { label: opts.label, plistPath: "", status: "unknown" },
      probeUrl: `http://127.0.0.1:${opts.port}/api/internal/desktop/ready`,
    }
  );
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
  // Atomic write: write to tmp file then rename, so a crash mid-write
  // never leaves a half-written JSON that breaks the next startup.
  const portsPath = getRuntimePortsPath(plistDir);
  const tmpPath = `${portsPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(meta, null, 2), "utf8");
  await fs.rename(tmpPath, portsPath);
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

/**
 * Check if a port is occupied by attempting to bind a temporary server.
 * Returns `{ pid: 0 }` if occupied, `null` if free.
 *
 * Uses net.createServer().listen() instead of lsof or net.connect because:
 * - lsof is blocked by macOS hardened runtime in packaged Electron apps
 * - net.connect conflicts with probePort (both use createConnection)
 */
async function detectPortOccupier(
  port: number,
): Promise<{ pid: number } | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      // EADDRINUSE or other bind failure — port is occupied
      resolve({ pid: 0 });
    });
    server.listen(port, "127.0.0.1", () => {
      // Successfully bound — port is free. Close immediately.
      server.close(() => resolve(null));
    });
  });
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
// User shell PATH resolution — fix $PATH for GUI-launched Electron apps
// ---------------------------------------------------------------------------

/**
 * Resolve the user's real login-shell PATH.
 *
 * GUI-launched Electron apps on macOS inherit a minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`) because launchd does not source the
 * user's shell profile. This means Homebrew, NVM, pyenv, etc. binaries
 * are invisible to child processes — including OpenClaw, which uses
 * `hasBinary()` to filter skills by `metadata.openclaw.requires.bins`.
 *
 * Windows GUI apps already inherit the full user PATH from the registry,
 * so this is a no-op on win32.
 *
 * Falls back to `process.env.PATH` on any error (timeout, missing shell).
 */
async function resolveUserShellPath(): Promise<string> {
  const fallback = process.env.PATH ?? "";

  if (process.platform === "win32") {
    return fallback;
  }

  // Print PATH on a single tagged line so we can find it reliably even
  // if shell init files (.zshrc, .bashrc) emit debug output around it.
  // We search stdout for the one line starting with the tag prefix and
  // strip it — all other lines are ignored.
  const tag = `__NEXU_PATH_${Date.now()}__`;
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const { stdout } = await execFileAsync(
      shell,
      ["-ilc", `printf '${tag}%s\\n' "$PATH"`],
      {
        timeout: 5000,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: os.homedir(),
          USER: os.userInfo().username,
          SHELL: shell,
        },
      },
    );

    const line = stdout.split("\n").find((l) => l.startsWith(tag));
    const resolved = line ? line.slice(tag.length).trim() : "";
    return resolved || fallback;
  } catch {
    return fallback;
  }
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
  const log = env.log ?? console.log;
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

  // --- Clean up stale plists from a previous/different installation ---
  // Build a plistEnv with default ports for comparison. If existing plists
  // differ from what we'd generate now, they're from a different version or
  // installation and should be cleaned up.
  const systemPath = await resolveUserShellPath();
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
    proxyEnv: env.proxyEnv,
    posthogApiKey: env.posthogApiKey,
    posthogHost: env.posthogHost,
    langfusePublicKey: env.langfusePublicKey,
    langfuseSecretKey: env.langfuseSecretKey,
    langfuseBaseUrl: env.langfuseBaseUrl,
    nodeV8Coverage: env.nodeV8Coverage,
    desktopE2ECoverage: env.desktopE2ECoverage,
    desktopE2ECoverageRunId: env.desktopE2ECoverageRunId,
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
  let recovered = await readRuntimePorts(plistDir);

  // Detect and clean up stale sessions from a Force Quit.
  // When the user Force Quits Electron, the quit handler doesn't run and
  // launchd services stay alive permanently due to KeepAlive. Detect this
  // by checking if the previous Electron PID is dead and the metadata is
  // older than 5 minutes.
  if (recovered) {
    const STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;
    const previousElectronDead = !isProcessAlive(recovered.electronPid);
    const metadataAgeMs = Date.now() - new Date(recovered.writtenAt).getTime();
    if (previousElectronDead && metadataAgeMs > STALE_SESSION_THRESHOLD_MS) {
      console.log(
        `Stale session detected: previous Electron pid=${recovered.electronPid} is dead, ` +
          `metadata age=${Math.round(metadataAgeMs / 1000)}s. Cleaning up launchd services.`,
      );
      await bootoutServicesAndWait({
        launchd,
        labels,
        controllerRunning: true,
        openclawRunning: true,
      });
      await deleteRuntimePorts(plistDir);
      recovered = null; // Force fresh start
    }
  }
  let [controllerStatus, openclawStatus] = await Promise.all([
    launchd.getServiceStatus(labels.controller),
    launchd.getServiceStatus(labels.openclaw),
  ]);

  let controllerRunning = controllerStatus.status === "running";
  let openclawRunning = openclawStatus.status === "running";
  let anyRunning = controllerRunning || openclawRunning;

  // Partial attach state is unsafe: one launchd service survived but the other
  // did not. In practice this leaves controller attached to stale OpenClaw
  // metadata, and OpenClaw may still exist as an orphaned process on the old
  // gateway port. Tear everything down and force a clean cold start.
  if (recovered && anyRunning && controllerRunning !== openclawRunning) {
    console.warn(
      `[bootstrap] partial launchd state detected (controller=${controllerRunning ? "running" : "stopped"} openclaw=${openclawRunning ? "running" : "stopped"}); forcing clean cold start`,
    );

    const staleOpenclawPort = recovered.openclawPort;
    const staleOccupier = await detectPortOccupier(staleOpenclawPort);
    if (staleOccupier && staleOccupier.pid !== openclawStatus.pid) {
      console.warn(
        `[bootstrap] stale openclaw port occupier detected port=${staleOpenclawPort} pid=${staleOccupier.pid}`,
      );
    }

    await bootoutServicesAndWait({
      launchd,
      labels,
      controllerRunning,
      openclawRunning,
    });

    await killOrphanOpenclawProcesses({
      registeredPid: openclawStatus.pid,
      extraPids: staleOccupier ? [staleOccupier.pid] : [],
    });
    await deleteRuntimePorts(plistDir).catch(() => {});

    recovered = null;
    [controllerStatus, openclawStatus] = await Promise.all([
      launchd.getServiceStatus(labels.controller),
      launchd.getServiceStatus(labels.openclaw),
    ]);
    controllerRunning = controllerStatus.status === "running";
    openclawRunning = openclawStatus.status === "running";
    anyRunning = controllerRunning || openclawRunning;
  }

  // If we have a previous session and at least one service is still running,
  // validate and reuse the recovered ports. Otherwise use fresh ports.
  let useRecoveredPorts = false;
  let effectivePorts = {
    controllerPort: env.controllerPort,
    openclawPort: env.openclawPort,
    webPort: env.webPort,
  };

  if (recovered && anyRunning && recovered.isDev === env.isDev) {
    // Detect reinstall / version upgrade: if the app version changed (or
    // the previous session has no version stamp — e.g. upgrading from an
    // older release), the running services are from a stale binary and
    // must be torn down. Treat missing recovered.appVersion as a mismatch
    // (conservative: forces fresh start on first upgrade to version-aware code).
    const versionMismatch =
      env.appVersion != null && recovered.appVersion !== env.appVersion;
    // Check identity fields beyond version: if any of openclawStateDir,
    // userDataPath, or buildSource are present in both recovered metadata
    // and current env, they must match. A mismatch means two different
    // builds share the same version (e.g. stable vs beta), and we must
    // not cross-attach.
    const identityMismatch =
      !versionMismatch &&
      (
        [
          [
            "openclawStateDir",
            recovered.openclawStateDir,
            env.openclawStateDir,
          ],
          ["userDataPath", recovered.userDataPath, env.userDataPath],
          ["buildSource", recovered.buildSource, env.buildSource],
        ] as const
      ).some(
        ([, recoveredVal, envVal]) =>
          recoveredVal != null && envVal != null && recoveredVal !== envVal,
      );

    if (versionMismatch || identityMismatch) {
      const reason = versionMismatch
        ? `App version changed (${recovered.appVersion} → ${env.appVersion})`
        : "Build identity mismatch (openclawStateDir, userDataPath, or buildSource differ)";
      console.log(
        `[bootstrap] teardown: ${reason} (controller=${controllerRunning ? "running" : "stopped"} openclaw=${openclawRunning ? "running" : "stopped"})`,
      );
      await bootoutServicesAndWait({
        launchd,
        labels,
        controllerRunning,
        openclawRunning,
      });
      await deleteRuntimePorts(plistDir).catch(() => {});
      // Fall through to fresh start below (useRecoveredPorts remains false)
    } else {
      // Detect stale session: if the previous Electron process is dead, the web
      // server port won't be listening. We can still reuse controller/openclaw
      // ports since launchd keeps those running, but we'll need a fresh web port.
      const previousElectronAlive = isProcessAlive(recovered.electronPid);
      if (!previousElectronAlive) {
        console.log(
          `Previous Electron (pid=${recovered.electronPid}) is dead, web port ${recovered.webPort} likely stale`,
        );
      }

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
          // Keep controller/openclaw ports but use fresh web port if Electron died
          webPort: previousElectronAlive ? recovered.webPort : env.webPort,
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
        await bootoutServicesAndWait({
          launchd,
          labels,
          controllerRunning,
          openclawRunning,
        });
      }
    } // end: version match — proceed with attach
  } else if (anyRunning && !recovered) {
    // Services running but no runtime-ports.json (e.g. file was deleted or
    // corrupted). We can't know the ports they're using, so tear them down
    // and do a clean cold start with fresh ports.
    console.log(
      `[bootstrap] teardown: no runtime-ports.json but services running (controller=${controllerRunning ? "running" : "stopped"} openclaw=${openclawRunning ? "running" : "stopped"})`,
    );
    await bootoutServicesAndWait({
      launchd,
      labels,
      controllerRunning,
      openclawRunning,
    });
  }

  // --- Per-service: validate running ones, start missing ones ---

  // Health check running services
  console.log(
    `[bootstrap] health check: controller=${controllerRunning ? "running" : "stopped"} openclaw=${openclawRunning ? "running" : "stopped"} useRecoveredPorts=${useRecoveredPorts}`,
  );
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
    const portListening = await probePort(effectivePorts.openclawPort);
    // Port listening isn't enough — verify it's OUR openclaw by checking
    // that the launchd service env matches our expected token/state dir.
    // This prevents attaching to a global openclaw or ClawX on the same port.
    if (portListening) {
      const ocEnv = (await launchd.getServiceStatus(labels.openclaw)).env;
      const expectedToken = env.gatewayToken;
      const runningToken = ocEnv?.OPENCLAW_GATEWAY_TOKEN;
      if (expectedToken && runningToken && runningToken !== expectedToken) {
        console.log(
          "OpenClaw port is listening but gateway token mismatch — not our instance",
        );
        openclawHealthy = false;
      } else {
        openclawHealthy = true;
      }
    }
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
    const preOccupier = await detectPortOccupier(effectivePorts.openclawPort);
    log(
      `[bootstrap] pre-findFreePort: openclawPort=${effectivePorts.openclawPort} occupier=${preOccupier ? `PID ${preOccupier.pid}` : "none"}`,
    );
    const freePort = await findFreePort(effectivePorts.openclawPort);
    if (freePort !== effectivePorts.openclawPort) {
      console.log(
        `OpenClaw port ${effectivePorts.openclawPort} occupied, using ${freePort}`,
      );
      effectivePorts.openclawPort = freePort;
    } else {
      log(
        `[bootstrap] openclawPort ${effectivePorts.openclawPort} appears free, keeping`,
      );
    }
  }

  // Build plistEnv with final resolved ports
  let plistEnv: PlistEnv = {
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
    console.log(`[bootstrap] ${type} installService begin label=${label}`);
    const plist = generatePlist(type, plistEnv);
    await launchd.installService(label, plist);
    console.log(`[bootstrap] ${type} installService done label=${label}`);
  };

  const ensureRunning = async (label: string, type: string) => {
    const status = await launchd.getServiceStatus(label);
    console.log(
      `[bootstrap] ${type} ensureRunning status=${status.status} pid=${status.pid ?? "none"} label=${label}`,
    );
    if (status.status !== "running") {
      await launchd.startService(label);
      const afterStatus = await launchd.getServiceStatus(label);
      console.log(
        `[bootstrap] ${type} kickstart done status=${afterStatus.status} pid=${afterStatus.pid ?? "none"} label=${label}`,
      );
    }
  };

  const formatControllerRecoveryFailure = (details: {
    originalPort: number;
    retryPort?: number;
    reason: ControllerStartupFailureReason;
    launchdStatus: ServiceStatus;
    probeUrl: string;
    probeStatus?: number;
  }): string => {
    const runtimePortsValue = JSON.stringify({
      controllerPort: details.retryPort ?? effectivePorts.controllerPort,
      openclawPort: effectivePorts.openclawPort,
      webPort: effectivePorts.webPort,
    });

    return [
      "Controller startup recovery failed",
      `originalPort=${details.originalPort}`,
      details.retryPort != null ? `retryPort=${details.retryPort}` : null,
      `reason=${details.reason}`,
      `launchdStatus=${details.launchdStatus.status}`,
      `launchdPid=${details.launchdStatus.pid ?? "none"}`,
      details.probeStatus != null ? `probeStatus=${details.probeStatus}` : null,
      `finalProbeUrl=${details.probeUrl}`,
      `runtimePortsValue=${runtimePortsValue}`,
    ]
      .filter(Boolean)
      .join(" ");
  };

  const validateOrRecoverController = async (): Promise<void> => {
    const originalPort = effectivePorts.controllerPort;
    const validation = await waitForControllerStartupValidation({
      launchd,
      label: labels.controller,
      port: effectivePorts.controllerPort,
      timeoutMs: env.controllerStartupValidationTimeoutMs ?? 30_000,
      probeTimeoutMs: 3000,
    });

    if (validation.ok) {
      return;
    }

    console.warn(
      `[bootstrap] controller post-start validation failed originalPort=${originalPort} reason=${validation.reason} launchdStatus=${validation.launchdStatus.status} launchdPid=${validation.launchdStatus.pid ?? "none"} probeUrl=${validation.probeUrl}${validation.probeStatus != null ? ` probeStatus=${validation.probeStatus}` : ""}`,
    );

    await launchd
      .bootoutAndWaitForExit(labels.controller, 5000)
      .catch(() => {});

    const retryStartPort = Math.min(originalPort + 1, 65535);
    const retryPort = await findFreePort(retryStartPort);
    effectivePorts.controllerPort = retryPort;
    plistEnv = {
      ...plistEnv,
      controllerPort: retryPort,
    };

    console.warn(
      `[bootstrap] retrying controller startup originalPort=${originalPort} retryPort=${retryPort}`,
    );

    const retryPlist = generatePlist("controller", plistEnv);
    await launchd.installService(labels.controller, retryPlist);
    await launchd.startService(labels.controller);
    await ensureRunning(labels.controller, "controller");

    const retryValidation = await waitForControllerStartupValidation({
      launchd,
      label: labels.controller,
      port: retryPort,
      timeoutMs: env.controllerStartupValidationTimeoutMs ?? 30_000,
      probeTimeoutMs: 3000,
    });
    if (retryValidation.ok) {
      return;
    }

    const message = formatControllerRecoveryFailure({
      originalPort,
      retryPort,
      reason: retryValidation.reason,
      launchdStatus: retryValidation.launchdStatus,
      probeUrl: retryValidation.probeUrl,
      probeStatus: retryValidation.probeStatus,
    });
    console.error(`[bootstrap] ${message}`);
    throw new Error(message);
  };

  if (!controllerHealthy) {
    await ensureService(labels.controller, "controller");
    await ensureRunning(labels.controller, "controller");
    await validateOrRecoverController();
  } else {
    console.log("[bootstrap] controller already healthy, skipping");
  }
  if (!openclawHealthy) {
    await ensureService(labels.openclaw, "openclaw");
    await ensureRunning(labels.openclaw, "openclaw");

    // Verify our openclaw actually owns the port. Another launchd service
    // (e.g. global `ai.openclaw.gateway` with KeepAlive=true) may have
    // raced us and grabbed the port first. If so, pick a new port and
    // re-bootstrap our service.
    // Wait briefly for the port to be bound (our openclaw needs time to start).
    await new Promise((r) => setTimeout(r, 2000));
    const occupier = await detectPortOccupier(effectivePorts.openclawPort);
    const ocStatus = await launchd.getServiceStatus(labels.openclaw);
    log(
      `[bootstrap] post-launch check: port=${effectivePorts.openclawPort} occupied=${!!occupier} ocStatus=${JSON.stringify({ pid: ocStatus.pid, status: ocStatus.status })}`,
    );
    // Port is stolen if someone is listening but our service crashed or
    // isn't running. We can't compare PIDs (lsof blocked by hardened
    // runtime), so check if our service is healthy instead.
    const portStolen =
      occupier && (ocStatus.pid == null || ocStatus.status !== "running");
    log(`[bootstrap] portStolen=${portStolen}`);
    if (portStolen) {
      log(
        `[bootstrap] OpenClaw port ${effectivePorts.openclawPort} stolen by PID ${occupier.pid} (ours is ${ocStatus.pid}), reassigning`,
      );
      // Bootout crashed openclaw and wait for launchd to fully release it.
      // Use bootoutAndWaitForExit which captures the PID before bootout
      // so waitForExit can SIGKILL if needed (plain waitForExit without
      // knownPid exits early on "unknown" status).
      await launchd
        .bootoutAndWaitForExit(labels.openclaw, 5000)
        .catch(() => {});

      const newPort = await findFreePort(effectivePorts.openclawPort + 1);
      effectivePorts.openclawPort = newPort;

      // Regenerate plists with new port for both openclaw and controller
      const retryPlistEnv: PlistEnv = {
        ...plistEnv,
        openclawPort: newPort,
      };

      // Re-bootstrap openclaw on new port
      const retryPlist = generatePlist("openclaw", retryPlistEnv);
      await launchd.installService(labels.openclaw, retryPlist);
      await launchd.startService(labels.openclaw);
      await ensureRunning(labels.openclaw, "openclaw");

      // Controller needs the new port — re-bootstrap it too
      await launchd
        .bootoutAndWaitForExit(labels.controller, 5000)
        .catch(() => {});
      const retryControllerPlist = generatePlist("controller", retryPlistEnv);
      await launchd.installService(labels.controller, retryControllerPlist);
      await launchd.startService(labels.controller);
      await ensureRunning(labels.controller, "controller");
      // Controller was restarted — must wait for readiness again even if
      // it was previously healthy (attach path sets needsControllerReady=false).
      needsControllerReady = true;
      log(
        `[bootstrap] OpenClaw reassigned to port ${newPort}, controller restarted`,
      );
    }
  } else {
    console.log("[bootstrap] openclaw already healthy, skipping");
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
  await writeRuntimePorts(plistDir, {
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
function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNexuProcessPatterns(): string[] {
  const repoRoot = getWorkspaceRoot();
  const slimclawRuntimeRoot = getSlimclawRuntimeRoot(repoRoot);
  const slimclawArtifacts = resolveSlimclawRuntimeArtifacts(
    slimclawRuntimeRoot,
    {
      requirePrepared: false,
    },
  );
  const nexuHome = path.join(os.homedir(), ".nexu");
  const patterns = new Set<string>([
    escapeRegexLiteral(
      path.join(nexuHome, "runtime", "controller-sidecar", "dist", "index.js"),
    ),
    "\\.nexu/(runtime/)?openclaw-sidecar",
    escapeRegexLiteral(
      path.join(repoRoot, "apps", "controller", "dist", "index.js"),
    ),
    escapeRegexLiteral(slimclawArtifacts.entryPath),
    ...getNexuOpenclawProcessPatterns(),
  ]);

  if (process.resourcesPath) {
    patterns.add(
      escapeRegexLiteral(
        path.join(
          process.resourcesPath,
          "runtime",
          "controller",
          "dist",
          "index.js",
        ),
      ),
    );
  }

  return Array.from(patterns);
}

function getNexuOpenclawProcessPatterns(): string[] {
  const repoRoot = getWorkspaceRoot();
  const slimclawRuntimeRoot = getSlimclawRuntimeRoot(repoRoot);
  const slimclawArtifacts = resolveSlimclawRuntimeArtifacts(
    slimclawRuntimeRoot,
    {
      requirePrepared: false,
    },
  );
  const patterns = new Set<string>([
    "\\.nexu/(runtime/)?openclaw-sidecar",
    "\\.nexu/(runtime/)?openclaw-sidecar/.*/openclaw(?:\\.cmd)?",
    escapeRegexLiteral(slimclawArtifacts.entryPath),
    escapeRegexLiteral(slimclawArtifacts.binPath),
  ]);

  if (process.resourcesPath) {
    patterns.add(
      escapeRegexLiteral(
        path.join(
          process.resourcesPath,
          "runtime",
          "openclaw",
          "node_modules",
          "openclaw",
          "openclaw.mjs",
        ),
      ),
    );
    patterns.add(
      escapeRegexLiteral(
        path.join(
          process.resourcesPath,
          "runtime",
          "openclaw",
          "bin",
          "openclaw",
        ),
      ),
    );
    patterns.add(
      escapeRegexLiteral(
        path.join(
          process.resourcesPath,
          "runtime",
          "openclaw",
          "bin",
          "openclaw.cmd",
        ),
      ),
    );
  }

  return Array.from(patterns);
}

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
    const recovered = await readRuntimePorts(plistDir);
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
async function findProcessPidsByPatterns(
  patterns: readonly string[],
  excludeProcessTree = false,
): Promise<number[]> {
  const allPids = new Set<number>();
  const excludePids = excludeProcessTree
    ? await getCurrentProcessTreePids()
    : new Set([process.pid]);

  for (const pattern of patterns) {
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

async function findNexuProcessPids(
  excludeProcessTree = false,
): Promise<number[]> {
  return findProcessPidsByPatterns(
    getNexuProcessPatterns(),
    excludeProcessTree,
  );
}

async function killOrphanOpenclawProcesses(opts: {
  registeredPid?: number;
  extraPids?: number[];
}): Promise<number[]> {
  const pids = await findProcessPidsByPatterns(
    getNexuOpenclawProcessPatterns(),
    true,
  );
  const candidatePids = new Set(pids);
  for (const pid of opts.extraPids ?? []) {
    if (pid > 0) {
      candidatePids.add(pid);
    }
  }
  const orphanPids = Array.from(candidatePids).filter(
    (pid) => pid !== opts.registeredPid,
  );

  for (const pid of orphanPids) {
    console.warn(`bootstrap: killing stale openclaw process pid=${pid}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ESRCH — already gone
    }
  }

  return orphanPids;
}

async function bootoutServicesAndWait(opts: {
  launchd: LaunchdManager;
  labels: { controller: string; openclaw: string };
  controllerRunning: boolean;
  openclawRunning: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  await Promise.allSettled([
    opts.controllerRunning
      ? opts.launchd.bootoutAndWaitForExit(opts.labels.controller, timeoutMs)
      : Promise.resolve(),
    opts.openclawRunning
      ? opts.launchd.bootoutAndWaitForExit(opts.labels.openclaw, timeoutMs)
      : Promise.resolve(),
  ]);
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

// ---------------------------------------------------------------------------
// External node runner — clone Electron binary + frameworks outside .app
// ---------------------------------------------------------------------------

/**
 * Safety guard: refuse to rm -rf paths that are too shallow.
 * Prevents catastrophic deletion if nexuHome is accidentally empty/root.
 */
function assertSafeRmTarget(targetPath: string): void {
  const segments = targetPath.split(path.sep).filter(Boolean);
  if (segments.length < 3) {
    throw new Error(
      `Refusing rm -rf on shallow path: ${targetPath} (need ≥3 segments)`,
    );
  }
}

/**
 * Read CFBundleExecutable from Info.plist to get the actual binary name.
 * Falls back to "Nexu" if the plist cannot be parsed.
 */
function readBundleExecutableName(appContentsPath: string): string {
  const fallback = "Nexu";
  try {
    const plistPath = path.join(appContentsPath, "Info.plist");
    const raw = readFileSync(plistPath, "utf8");
    const match = raw.match(
      /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/,
    );
    return match?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

function readBundleInfoValue(
  appContentsPath: string,
  key: string,
): string | null {
  try {
    const plistPath = path.join(appContentsPath, "Info.plist");
    const raw = readFileSync(plistPath, "utf8");
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(
      new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`),
    );
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function buildRuntimeExtractionStamp(
  appContentsPath: string,
  appVersion: string,
): string {
  const bundleVersion = readBundleInfoValue(appContentsPath, "CFBundleVersion");
  return JSON.stringify({
    appVersion,
    bundleVersion,
    // Mirrored in platforms/mac/launchd-paths.ts — both copies must agree.
    arch: process.arch,
  });
}

function readRuntimeExtractionStamp(stampPath: string): string | null {
  try {
    return readFileSync(stampPath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function shouldReplaceExtractedRuntime(opts: {
  entryPath: string;
  stampPath: string;
  expectedStamp: string;
}): boolean {
  const { entryPath, stampPath, expectedStamp } = opts;
  const hasExistingRuntime = existsSync(entryPath) || existsSync(stampPath);

  if (!hasExistingRuntime) {
    return false;
  }

  return readRuntimeExtractionStamp(stampPath) !== expectedStamp;
}

async function cleanupForPackagedRuntimeReplacement(
  log: (message: string) => void,
) {
  const launchd = new LaunchdManager({ log });
  const labels = {
    controller: SERVICE_LABELS.controller(false),
    openclaw: SERVICE_LABELS.openclaw(false),
  };
  const plistDir = getDefaultPlistDir(false);

  log(
    "packaged runtime identity changed; tearing down launchd services before runtime replacement",
  );
  await teardownLaunchdServices({
    launchd,
    labels,
    plistDir,
  });

  const { clean, remainingPids } = await ensureNexuProcessesDead({
    timeoutMs: 5_000,
    intervalMs: 200,
  });
  if (!clean) {
    log(
      `packaged runtime replacement proceeding with surviving pids=${remainingPids.join(",")}`,
    );
  }
}

/**
 * Ensure a standalone Electron-as-Node runner exists outside the .app bundle.
 *
 * Problem: launchd services that use the Electron binary from inside the .app
 * bundle cause macOS Finder to report "app is in use", blocking reinstall /
 * drag-and-drop updates. The Electron Framework (~250 MB) is mmap'd into the
 * process address space, holding file references to the bundle.
 *
 * Solution: clone the packaged app bundle to
 * `~/.nexu/runtime/nexu-runner.app/`. On APFS (all modern macOS), `cp -Rc`
 * creates copy-on-write clones that occupy near-zero additional disk space.
 * The launchd plist then references this external runner instead of
 * `/Applications/Nexu.app`.
 *
 * The runner is version-stamped so it re-clones when the app is updated.
 *
 * @returns The path to the external binary (the node runner).
 */
export async function ensureExternalNodeRunner(
  appContentsPath: string,
  nexuHome: string,
  appVersion: string,
): Promise<string> {
  const binaryName = readBundleExecutableName(appContentsPath);
  const extractionStamp = buildRuntimeExtractionStamp(
    appContentsPath,
    appVersion,
  );
  const runnerRoot = path.join(nexuHome, "runtime", "nexu-runner.app");
  const stagingRoot = `${runnerRoot}.staging`;
  const binaryPath = path.join(runnerRoot, "Contents", "MacOS", binaryName);
  // Version stamp lives OUTSIDE the .app bundle so it does not break the
  // code signature's sealed-resources check.  Writing any file into the
  // bundle root causes `codesign --verify` to fail with
  // "unsealed contents present in the bundle root".
  const stampPath = path.join(nexuHome, "runtime", ".nexu-runner-version");

  assertSafeRmTarget(runnerRoot);
  assertSafeRmTarget(stagingRoot);

  // Clean up leftover staging directory from an interrupted extraction
  if (existsSync(stagingRoot)) {
    assertSafeRmTarget(stagingRoot);
    await execFileAsync("rm", ["-rf", stagingRoot]).catch(() => {});
  }

  // Fast path: already extracted for this version
  try {
    if (
      existsSync(stampPath) &&
      existsSync(binaryPath) &&
      readFileSync(stampPath, "utf8").trim() === extractionStamp
    ) {
      return binaryPath;
    }
  } catch {
    // stamp unreadable — re-extract
  }

  console.log(
    `Extracting external node runner for runtime ${extractionStamp} to ${runnerRoot}`,
  );

  // Atomic extraction: build in staging directory, then rename into place.
  // If the process is killed mid-extraction, only the staging directory is
  // left behind and will be cleaned up on next startup (see above).
  const appBundlePath = path.dirname(appContentsPath);
  const stagingBinaryPath = path.join(
    stagingRoot,
    "Contents",
    "MacOS",
    binaryName,
  );
  await fs.mkdir(path.dirname(stagingRoot), { recursive: true });

  // Clone the full app bundle so the runner keeps a valid macOS app layout,
  // including signed resources like _CodeSignature and Resources.
  try {
    await execFileAsync("cp", ["-Rc", appBundlePath, stagingRoot]);
  } catch {
    // APFS clone unavailable (e.g. non-APFS volume) — regular copy
    console.warn(
      "APFS clone not available for runner bundle, falling back to regular copy",
    );
    await execFileAsync("cp", ["-R", appBundlePath, stagingRoot]);
  }

  if (!existsSync(stagingBinaryPath)) {
    throw new Error(
      `Runner extraction failed: ${stagingBinaryPath} not found after clone`,
    );
  }

  // Atomic swap: remove old directory, then rename staging into place.
  // mv (rename) is atomic on the same filesystem (POSIX guarantee).
  await execFileAsync("rm", ["-rf", runnerRoot]).catch(() => {});
  await fs.rename(stagingRoot, runnerRoot);

  // Write version stamp AFTER the swap so it is only visible when the
  // runner bundle is fully in place.  The stamp file is a sibling of the
  // .app bundle, not inside it, to preserve the code signature.
  writeFileSync(stampPath, extractionStamp, "utf8");

  console.log(`External node runner ready at ${binaryPath}`);
  return binaryPath;
}

// ---------------------------------------------------------------------------
// External controller sidecar — clone controller dist outside .app
// ---------------------------------------------------------------------------

/**
 * Ensure the controller sidecar is available outside the .app bundle.
 *
 * Clones `Contents/Resources/runtime/controller/` to
 * `~/.nexu/runtime/controller-sidecar/` so launchd services don't hold
 * file descriptors (native addons via dlopen, require'd modules) to files
 * inside the .app bundle.
 *
 * @returns The path to the external controller sidecar root.
 */
async function ensureExternalControllerSidecar(
  appContentsPath: string,
  nexuHome: string,
  appVersion: string,
): Promise<{ controllerRoot: string; entryPath: string }> {
  const extractionStamp = buildRuntimeExtractionStamp(
    appContentsPath,
    appVersion,
  );
  const controllerRoot = path.join(nexuHome, "runtime", "controller-sidecar");
  const stagingRoot = `${controllerRoot}.staging`;
  const entryPath = path.join(controllerRoot, "dist", "index.js");
  const stampPath = path.join(controllerRoot, ".version-stamp");

  // Clean up leftover staging directory from an interrupted extraction
  if (existsSync(stagingRoot)) {
    assertSafeRmTarget(stagingRoot);
    await execFileAsync("rm", ["-rf", stagingRoot]).catch(() => {});
  }

  // Fast path: already extracted for this version
  try {
    if (
      existsSync(stampPath) &&
      existsSync(entryPath) &&
      readFileSync(stampPath, "utf8").trim() === extractionStamp
    ) {
      return { controllerRoot, entryPath };
    }
  } catch {
    // stamp unreadable — re-extract
  }

  console.log(
    `Extracting controller sidecar for runtime ${extractionStamp} to ${controllerRoot}`,
  );

  const srcControllerDir = path.join(
    appContentsPath,
    "Resources",
    "runtime",
    "controller",
  );

  // Atomic extraction: clone to staging directory, then rename into place.
  // If the process is killed mid-extraction, only the staging directory is
  // left behind and will be cleaned up on next startup (see above).
  try {
    await execFileAsync("cp", ["-Rc", srcControllerDir, stagingRoot]);
  } catch {
    console.warn(
      "APFS clone not available for controller sidecar (~28MB), falling back to regular copy",
    );
    await execFileAsync("cp", ["-R", srcControllerDir, stagingRoot]);
  }

  // Verify critical entry point exists after clone
  const stagingEntryPath = path.join(stagingRoot, "dist", "index.js");
  if (!existsSync(stagingEntryPath)) {
    throw new Error(
      `Controller sidecar extraction failed: ${stagingEntryPath} not found after clone`,
    );
  }

  // Write version stamp inside staging directory
  const stagingStampPath = path.join(stagingRoot, ".version-stamp");
  writeFileSync(stagingStampPath, extractionStamp, "utf8");

  // Atomic swap: remove old directory, then rename staging into place.
  // mv (rename) is atomic on the same filesystem (POSIX guarantee).
  assertSafeRmTarget(controllerRoot);
  await execFileAsync("rm", ["-rf", controllerRoot]).catch(() => {});
  await fs.rename(stagingRoot, controllerRoot);

  return { controllerRoot, entryPath };
}

/**
 * Resolve paths for launchd bootstrap based on whether app is packaged.
 *
 * For packaged apps, all paths are resolved OUTSIDE the .app bundle so that
 * launchd services do not hold file references into the bundle. This allows
 * Finder to replace the .app during reinstall / drag-and-drop updates.
 */
export async function resolveLaunchdPaths(
  isPackaged: boolean,
  resourcesPath: string,
  appVersion?: string,
): Promise<{
  nodePath: string;
  controllerEntryPath: string;
  openclawPath: string;
  controllerCwd: string;
  openclawCwd: string;
  openclawBinPath: string;
  openclawExtensionsDir: string;
}> {
  if (isPackaged) {
    const runtimeDir = path.join(resourcesPath, "runtime");
    const nexuHome = path.join(os.homedir(), ".nexu");
    const version = appVersion ?? "unknown";
    const log = console.log;

    // Extract runner + controller sidecar outside .app so launchd services
    // don't lock the bundle. If extraction fails (disk full, permissions,
    // etc.), fall back to in-bundle paths — the app will work but Finder
    // will report "app is in use" during reinstall.
    const appContentsPath = path.dirname(resourcesPath); // .app/Contents
    const extractionStamp = buildRuntimeExtractionStamp(
      appContentsPath,
      version,
    );
    const runnerBinaryName = readBundleExecutableName(appContentsPath);
    const runnerBinaryPath = path.join(
      nexuHome,
      "runtime",
      "nexu-runner.app",
      "Contents",
      "MacOS",
      runnerBinaryName,
    );
    const runnerStampPath = path.join(
      nexuHome,
      "runtime",
      ".nexu-runner-version",
    );
    const controllerEntryPathExternal = path.join(
      nexuHome,
      "runtime",
      "controller-sidecar",
      "dist",
      "index.js",
    );
    const controllerStampPath = path.join(
      nexuHome,
      "runtime",
      "controller-sidecar",
      ".version-stamp",
    );
    const shouldReplaceRuntime =
      shouldReplaceExtractedRuntime({
        entryPath: runnerBinaryPath,
        stampPath: runnerStampPath,
        expectedStamp: extractionStamp,
      }) ||
      shouldReplaceExtractedRuntime({
        entryPath: controllerEntryPathExternal,
        stampPath: controllerStampPath,
        expectedStamp: extractionStamp,
      });

    if (shouldReplaceRuntime) {
      try {
        await cleanupForPackagedRuntimeReplacement(log);
      } catch (err) {
        console.warn(
          "Packaged runtime cleanup before replacement failed, continuing with extraction attempt.",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    let nodePath = process.execPath;
    let controllerEntryPath = path.join(
      runtimeDir,
      "controller",
      "dist",
      "index.js",
    );
    let controllerRoot = path.join(runtimeDir, "controller");

    try {
      // 1. Extract Electron runner outside .app (APFS clone, ~0 disk overhead)
      nodePath = await ensureExternalNodeRunner(
        appContentsPath,
        nexuHome,
        version,
      );

      // 2. Extract controller sidecar outside .app
      const result = await ensureExternalControllerSidecar(
        appContentsPath,
        nexuHome,
        version,
      );
      controllerEntryPath = result.entryPath;
      controllerRoot = result.controllerRoot;
    } catch (err) {
      console.error(
        "Failed to extract external runner/sidecar, falling back to in-bundle paths.",
        err instanceof Error ? err.message : String(err),
      );
    }

    // 3. OpenClaw sidecar is already extracted to ~/.nexu/ by existing logic
    const openclawSidecarRoot = ensurePackagedOpenclawSidecar(
      runtimeDir,
      nexuHome,
    );
    const openclawArtifacts = resolveSlimclawRuntimeArtifacts(
      openclawSidecarRoot,
      { requirePrepared: false },
    );

    return {
      nodePath,
      controllerEntryPath,
      openclawPath: openclawArtifacts.entryPath,
      // Use nexuHome as cwd instead of .app paths so launchd services
      // don't hold directory file-descriptors inside the bundle.
      controllerCwd: controllerRoot,
      openclawCwd: openclawSidecarRoot,
      openclawBinPath: openclawArtifacts.binPath,
      openclawExtensionsDir: openclawArtifacts.builtinExtensionsDir,
    };
  }

  // Development: use local paths
  const repoRoot = getWorkspaceRoot();
  const slimclawRuntimePaths = resolveSlimclawRuntimePaths({
    workspaceRoot: repoRoot,
    requirePrepared: false,
  });
  return {
    nodePath: process.execPath,
    controllerEntryPath: path.join(
      repoRoot,
      "apps",
      "controller",
      "dist",
      "index.js",
    ),
    openclawPath: slimclawRuntimePaths.entryPath,
    controllerCwd: path.join(repoRoot, "apps", "controller"),
    openclawCwd: slimclawRuntimePaths.runtimeRoot,
    openclawBinPath: slimclawRuntimePaths.binPath,
    openclawExtensionsDir: slimclawRuntimePaths.builtinExtensionsDir,
  };
}
