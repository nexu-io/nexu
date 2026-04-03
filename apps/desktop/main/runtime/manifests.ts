import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { getOpenclawSkillsDir } from "../../shared/desktop-paths";
import { buildChildProcessProxyEnv } from "../../shared/proxy-config";
import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import { resolveRuntimeManifestsRoots } from "../platforms/shared/runtime-roots";
import { createAsyncArchiveSidecarMaterializer } from "../platforms/shared/sidecar-materializer";
import type { RuntimeUnitManifest } from "./types";

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function resolveElectronNodeRunner(): string {
  return process.execPath;
}

function normalizeNodeCandidate(
  candidate: string | undefined,
): string | undefined {
  const trimmed = candidate?.trim();
  if (!trimmed || !existsSync(trimmed)) {
    return undefined;
  }

  return trimmed;
}

/**
 * Build a PATH prefix that puts a Node.js >= 22 binary first.
 * OpenClaw requires Node 22.12+; in dev mode the system `node` may be
 * older (e.g. nvm defaulting to v20).  We scan NVM_DIR for a v22 install
 * and, if found, prepend its bin directory to the inherited PATH.
 */
function buildNode22Path(): string | undefined {
  const nvmDir = process.env.NVM_DIR;
  if (!nvmDir) return undefined;
  try {
    const versionsDir = path.resolve(nvmDir, "versions/node");
    const dirs = readdirSync(versionsDir)
      .filter((d) => d.startsWith("v22."))
      .sort()
      .reverse();
    for (const d of dirs) {
      const binDir = path.resolve(versionsDir, d, "bin");
      if (existsSync(path.resolve(binDir, "node"))) {
        return `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
      }
    }
  } catch {
    /* nvm dir not present or unreadable */
  }
  return undefined;
}

function supportsOpenclawRuntime(
  nodeBinaryPath: string,
  openclawSidecarRoot: string,
): boolean {
  try {
    execFileSync(
      nodeBinaryPath,
      [
        "-e",
        'require(require("node:path").resolve(process.argv[1], "node_modules/@snazzah/davey"))',
        openclawSidecarRoot,
      ],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          NODE_PATH: "",
        },
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer the current session's Node binary when it can boot OpenClaw.
 * Fall back to the previous Node 22 heuristic for older dev shells.
 *
 * The desktop gateway used to force Node 22 because OpenClaw historically
 * required 22.12+. Some local sidecars are instead bound to the current
 * session's Node ABI (for example Node 24), so we should try that first.
 */
function buildOpenclawNodePath(
  openclawSidecarRoot: string,
): string | undefined {
  const currentPath = process.env.PATH ?? "";
  const candidates = [normalizeNodeCandidate(process.env.NODE)];

  try {
    candidates.push(
      normalizeNodeCandidate(
        execFileSync("which", ["node"], { encoding: "utf8" }),
      ),
    );
  } catch {
    /* current PATH may not expose node */
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!supportsOpenclawRuntime(candidate, openclawSidecarRoot)) {
      continue;
    }

    const candidateDir = path.dirname(candidate);
    const currentFirstPath = currentPath.split(path.delimiter)[0] ?? "";
    if (candidateDir === currentFirstPath) {
      return undefined;
    }

    return `${candidateDir}${path.delimiter}${currentPath}`;
  }

  return buildNode22Path();
}

export function buildSkillNodePath(
  electronRoot: string,
  isPackaged: boolean,
  inheritedNodePath = process.env.NODE_PATH,
): string {
  const bundledModulesPath = isPackaged
    ? path.resolve(electronRoot, "bundled-node-modules")
    : path.resolve(electronRoot, "node_modules");
  const inheritedEntries = (inheritedNodePath ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);

  return Array.from(new Set([bundledModulesPath, ...inheritedEntries])).join(
    path.delimiter,
  );
}

/**
 * Resolve the openclaw sidecar root path WITHOUT extracting.
 * Returns the path where the sidecar will live after extraction.
 * Used by createRuntimeUnitManifests to set up paths early without
 * blocking the main process on synchronous tar extraction.
 */
export function resolveOpenclawSidecarRoot(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");
  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  if (!existsSync(archivePath)) {
    return packagedSidecarRoot;
  }

  return path.resolve(runtimeRoot, "openclaw-sidecar");
}

export function ensurePackagedOpenclawSidecar(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");
  const packagedOpenclawEntry = path.resolve(
    packagedSidecarRoot,
    "node_modules/openclaw/openclaw.mjs",
  );

  if (existsSync(packagedOpenclawEntry)) {
    return packagedSidecarRoot;
  }

  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  if (!existsSync(archivePath)) {
    return packagedSidecarRoot;
  }

  const extractedSidecarRoot = ensureDir(
    path.resolve(runtimeRoot, "openclaw-sidecar"),
  );
  const stampPath = path.resolve(extractedSidecarRoot, ".archive-stamp");
  const archiveStat = statSync(archivePath);
  const archiveStamp = `${archiveStat.size}:${archiveStat.mtimeMs}`;
  const extractedOpenclawEntry = path.resolve(
    extractedSidecarRoot,
    "node_modules/openclaw/openclaw.mjs",
  );

  if (
    existsSync(stampPath) &&
    existsSync(extractedOpenclawEntry) &&
    readFileSync(stampPath, "utf8") === archiveStamp
  ) {
    return extractedSidecarRoot;
  }

  // Atomic extraction via staging directory: extract to a temporary location,
  // verify the critical entry point, then atomically swap into the final path.
  // This prevents half-extracted directories if the process is killed mid-extract.
  const stagingRoot = `${extractedSidecarRoot}.staging`;
  const MAX_RETRIES = 3;

  // Clean up any leftover staging directory from a previous interrupted attempt
  if (existsSync(stagingRoot)) {
    execFileSync("rm", ["-rf", stagingRoot]);
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (existsSync(stagingRoot)) {
        execFileSync("rm", ["-rf", stagingRoot]);
      }
      mkdirSync(stagingRoot, { recursive: true });
      execFileSync("tar", ["-xzf", archivePath, "-C", stagingRoot]);

      // Verify critical entry point exists in staging
      const stagingEntry = path.resolve(
        stagingRoot,
        "node_modules/openclaw/openclaw.mjs",
      );
      if (!existsSync(stagingEntry)) {
        throw new Error(
          `Extraction verification failed: ${stagingEntry} not found`,
        );
      }

      // Write stamp inside staging
      writeFileSync(path.resolve(stagingRoot, ".archive-stamp"), archiveStamp);

      // Atomic swap: remove old → rename staging to final
      if (existsSync(extractedSidecarRoot)) {
        execFileSync("rm", ["-rf", extractedSidecarRoot]);
      }
      execFileSync("mv", [stagingRoot, extractedSidecarRoot]);
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      // Brief pause before retry to let filesystem settle
      execFileSync("sleep", ["1"]);
    }
  }

  return extractedSidecarRoot;
}

/**
 * Check if the packaged openclaw sidecar archive needs extraction.
 * Fast, synchronous, filesystem-read-only.
 */
export function checkOpenclawExtractionNeeded(
  electronRoot: string,
  userDataPath: string,
  isPackaged: boolean,
): boolean {
  if (!isPackaged) return false;

  const runtimeSidecarBaseRoot = path.resolve(electronRoot, "runtime");
  const runtimeRoot = path.resolve(userDataPath, "runtime");
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");
  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  if (!existsSync(archivePath)) return false;

  const extractedSidecarRoot = path.resolve(runtimeRoot, "openclaw-sidecar");
  const stampPath = path.resolve(extractedSidecarRoot, ".archive-stamp");
  const extractedEntry = path.resolve(
    extractedSidecarRoot,
    "node_modules/openclaw/openclaw.mjs",
  );

  try {
    const archiveStat = statSync(archivePath);
    const archiveStamp = `${archiveStat.size}:${archiveStat.mtimeMs}`;
    return !(
      existsSync(stampPath) &&
      existsSync(extractedEntry) &&
      readFileSync(stampPath, "utf8") === archiveStamp
    );
  } catch {
    return true; // Can't verify — assume needs extraction
  }
}

/**
 * Extract the openclaw sidecar archive asynchronously with retries.
 * Uses staging dir + atomic rename to prevent half-extracted directories.
 * Must be called before the controller unit starts.
 */
export async function extractOpenclawSidecarAsync(
  electronRoot: string,
  userDataPath: string,
): Promise<void> {
  const runtimeSidecarBaseRoot = path.resolve(electronRoot, "runtime");
  const runtimeRoot = path.resolve(userDataPath, "runtime");
  const materializer = createAsyncArchiveSidecarMaterializer();
  await materializer.materializePackagedOpenclawSidecar({
    runtimeSidecarBaseRoot,
    runtimeRoot,
  });
}

export function createRuntimeUnitManifests(
  electronRoot: string,
  userDataPath: string,
  isPackaged: boolean,
  runtimeConfig: DesktopRuntimeConfig,
): RuntimeUnitManifest[] {
  const {
    runtimeSidecarBaseRoot,
    runtimeRoot,
    openclawSidecarRoot,
    openclawRuntimeRoot,
    openclawConfigDir,
    openclawStateDir,
    openclawTempDir,
    logsDir,
  } = resolveRuntimeManifestsRoots({
    app: { getPath: () => userDataPath, isPackaged } as never,
    electronRoot,
    runtimeConfig,
  });
  ensureDir(runtimeRoot);
  // Use the non-blocking path resolver for manifest creation. Actual
  // extraction happens later in extractOpenclawSidecarAsync() during
  // cold start. This avoids blocking the main process for 10-20s on
  // first install while tar extracts synchronously.
  const resolvedOpenclawSidecarRoot = isPackaged
    ? resolveOpenclawSidecarRoot(runtimeSidecarBaseRoot, runtimeRoot)
    : openclawSidecarRoot;
  ensureDir(logsDir);
  ensureDir(openclawRuntimeRoot);
  ensureDir(openclawConfigDir);
  ensureDir(openclawStateDir);
  ensureDir(openclawTempDir);
  ensureDir(
    isPackaged
      ? getOpenclawSkillsDir(userDataPath)
      : path.resolve(
          runtimeConfig.paths.nexuHome,
          "runtime/openclaw/state/skills",
        ),
  );
  ensureDir(path.resolve(openclawStateDir, "plugin-docs"));
  ensureDir(path.resolve(openclawStateDir, "agents"));
  const openclawPackageRoot = path.resolve(
    resolvedOpenclawSidecarRoot,
    "node_modules/openclaw",
  );
  const controllerSidecarRoot = path.resolve(
    runtimeSidecarBaseRoot,
    "controller",
  );
  const controllerModulePath = path.resolve(
    controllerSidecarRoot,
    "dist/index.js",
  );
  const webSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "web");
  const webModulePath = path.resolve(webSidecarRoot, "index.js");
  const openclawBinPath =
    process.env.NEXU_OPENCLAW_BIN ??
    path.resolve(
      resolvedOpenclawSidecarRoot,
      "node_modules/openclaw/openclaw.mjs",
    );
  const controllerPort = runtimeConfig.ports.controller;
  const webPort = runtimeConfig.ports.web;
  const webUrl = runtimeConfig.urls.web;
  const electronNodeRunner = resolveElectronNodeRunner();
  const openclawNodePath = buildOpenclawNodePath(resolvedOpenclawSidecarRoot);
  const skillNodePath = buildSkillNodePath(electronRoot, isPackaged);
  const childProcessProxyEnv = buildChildProcessProxyEnv(runtimeConfig.proxy);

  // Keep all default ports and local URLs defined from this one manifest factory. Other desktop
  // entry points still mirror a few of these defaults directly, so changes here should be treated
  // as contract changes until those call sites are centralized.

  return [
    {
      id: "web",
      label: "nexu Web Surface",
      kind: "surface",
      launchStrategy: "managed",
      runner: "spawn",
      command: electronNodeRunner,
      args: [webModulePath],
      cwd: webSidecarRoot,
      port: webPort,
      startupTimeoutMs: 10_000,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "web.log"),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        WEB_HOST: "127.0.0.1",
        WEB_PORT: String(webPort),
        WEB_API_ORIGIN: runtimeConfig.urls.controllerBase,
        ...childProcessProxyEnv,
      },
    },
    {
      id: "control-plane",
      label: "Desktop Control Plane",
      kind: "surface",
      launchStrategy: "embedded",
      port: null,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "control-plane.log"),
    },
    {
      id: "controller",
      label: "nexu Controller",
      kind: "service",
      launchStrategy: "managed",
      // Use spawn instead of utility-process due to Electron bugs:
      // - https://github.com/electron/electron/issues/43186
      //   Network requests fail with ECONNRESET after event loop blocking
      // - https://github.com/electron/electron/issues/44727
      //   Utility process uses hidden network context, not session.defaultSession
      runner: "spawn",
      command: electronNodeRunner,
      args: [controllerModulePath],
      cwd: controllerSidecarRoot,
      port: controllerPort,
      startupTimeoutMs: 20_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_CONTROLLER", true),
      logFilePath: path.resolve(logsDir, "controller.log"),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "1",
        PORT: String(controllerPort),
        HOST: "127.0.0.1",
        WEB_URL: webUrl,
        NEXU_HOME: runtimeConfig.paths.nexuHome,
        OPENCLAW_STATE_DIR: openclawStateDir,
        OPENCLAW_CONFIG_PATH: path.resolve(openclawConfigDir, "openclaw.json"),
        OPENCLAW_SKILLS_DIR: isPackaged
          ? getOpenclawSkillsDir(userDataPath)
          : ensureDir(
              path.resolve(
                runtimeConfig.paths.nexuHome,
                "runtime/openclaw/state/skills",
              ),
            ),
        SKILLHUB_STATIC_SKILLS_DIR: isPackaged
          ? path.resolve(electronRoot, "static/bundled-skills")
          : path.resolve(
              getWorkspaceRoot(),
              "apps/desktop/static/bundled-skills",
            ),
        PLATFORM_TEMPLATES_DIR: isPackaged
          ? path.resolve(electronRoot, "static/platform-templates")
          : path.resolve(
              getWorkspaceRoot(),
              "apps/controller/static/platform-templates",
            ),
        OPENCLAW_BIN: openclawBinPath,
        OPENCLAW_ELECTRON_EXECUTABLE: process.execPath,
        OPENCLAW_EXTENSIONS_DIR: path.resolve(
          openclawPackageRoot,
          "extensions",
        ),
        OPENCLAW_GATEWAY_PORT: String(
          new URL(runtimeConfig.urls.openclawBase).port || 18789,
        ),
        OPENCLAW_GATEWAY_TOKEN: runtimeConfig.tokens.gateway,
        NODE_PATH: skillNodePath,
        OPENCLAW_DISABLE_BONJOUR: "1",
        TMPDIR: openclawTempDir,
        RUNTIME_MANAGE_OPENCLAW_PROCESS: "true",
        RUNTIME_GATEWAY_PROBE_ENABLED: "false",
        ...(openclawNodePath ? { PATH: openclawNodePath } : {}),
        ...childProcessProxyEnv,
      },
    },
    {
      id: "openclaw",
      label: "OpenClaw Runtime",
      kind: "runtime",
      launchStrategy: "delegated",
      delegatedProcessMatch: "openclaw-gateway",
      binaryPath: openclawBinPath,
      port: null,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "openclaw.log"),
    },
  ];
}
