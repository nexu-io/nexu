import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import {
  getOpenclawCuratedSkillsDir,
  getOpenclawSkillsDir,
} from "../../shared/desktop-paths";
import {
  type DesktopRuntimeConfig,
  getDesktopRuntimeConfig,
} from "../../shared/runtime-config";
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import type { RuntimeUnitManifest } from "./types";

/**
 * Returns a stable 32-byte hex encryption key for the desktop API sidecar.
 * Generated once and persisted to disk so encrypted data survives restarts.
 */
function ensureEncryptionKey(runtimeRoot: string): string {
  const keyPath = path.resolve(runtimeRoot, ".encryption-key");
  try {
    const existing = readFileSync(keyPath, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(existing)) return existing;
  } catch {
    // Generate new key
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function resetDir(path: string): string {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  return path;
}

const PGLITE_STATE_VERSION = "0.4.0";

function readPgliteStateVersion(runtimeRoot: string): string | null {
  const versionPath = path.resolve(runtimeRoot, "pglite-version.txt");

  try {
    return readFileSync(versionPath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function writePgliteStateVersion(runtimeRoot: string, version: string): void {
  const versionPath = path.resolve(runtimeRoot, "pglite-version.txt");
  writeFileSync(versionPath, `${version}\n`);
}

function ensurePgliteDataDir(runtimeRoot: string): string {
  const pgliteDataPath = path.resolve(runtimeRoot, "pglite");
  const existingVersion = readPgliteStateVersion(runtimeRoot);

  if (existingVersion !== PGLITE_STATE_VERSION) {
    resetDir(pgliteDataPath);
    writePgliteStateVersion(runtimeRoot, PGLITE_STATE_VERSION);
    return pgliteDataPath;
  }

  return ensureDir(pgliteDataPath);
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

function ensurePackagedOpenclawSidecar(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archivePath = path.resolve(packagedSidecarRoot, "payload.tar.gz");

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

  rmSync(extractedSidecarRoot, { recursive: true, force: true });
  mkdirSync(extractedSidecarRoot, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", extractedSidecarRoot]);
  writeFileSync(stampPath, archiveStamp);

  return extractedSidecarRoot;
}

export function createRuntimeUnitManifests(
  electronRoot: string,
  userDataPath: string,
  isPackaged: boolean,
): RuntimeUnitManifest[] {
  const repoRoot = getWorkspaceRoot();
  const _nexuRoot = repoRoot;
  const runtimeSidecarBaseRoot = isPackaged
    ? path.resolve(electronRoot, "runtime")
    : path.resolve(repoRoot, ".tmp/sidecars");
  const runtimeRoot = ensureDir(path.resolve(userDataPath, "runtime"));
  const openclawSidecarRoot = isPackaged
    ? ensurePackagedOpenclawSidecar(runtimeSidecarBaseRoot, runtimeRoot)
    : path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const runtimeConfig: DesktopRuntimeConfig = getDesktopRuntimeConfig(
    process.env,
    {
      openclawBinPath: path.resolve(openclawSidecarRoot, "bin/openclaw"),
      resourcesPath: isPackaged ? electronRoot : undefined,
    },
  );
  const logsDir = ensureDir(
    path.resolve(userDataPath, "../logs/runtime-units"),
  );
  const pgliteDataPath = ensurePgliteDataDir(runtimeRoot);
  const openclawRuntimeRoot = ensureDir(path.resolve(runtimeRoot, "openclaw"));
  const openclawConfigDir = ensureDir(
    path.resolve(openclawRuntimeRoot, "config"),
  );
  const openclawStateDir = ensureDir(
    path.resolve(openclawRuntimeRoot, "state"),
  );
  const openclawTempDir = ensureDir(path.resolve(openclawRuntimeRoot, "tmp"));
  ensureDir(getOpenclawSkillsDir(userDataPath));
  ensureDir(getOpenclawCuratedSkillsDir(userDataPath));
  ensureDir(path.resolve(openclawStateDir, "plugin-docs"));
  ensureDir(path.resolve(openclawStateDir, "agents"));
  const openclawPackageRoot = path.resolve(
    openclawSidecarRoot,
    "node_modules/openclaw",
  );
  const apiSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "api");
  const apiModulePath = path.resolve(apiSidecarRoot, "dist/index.js");
  const gatewaySidecarRoot = path.resolve(runtimeSidecarBaseRoot, "gateway");
  const gatewayModulePath = path.resolve(gatewaySidecarRoot, "dist/index.js");
  const pgliteSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "pglite");
  const pgliteModulePath = path.resolve(pgliteSidecarRoot, "index.js");
  const migrationsDir = path.resolve(pgliteSidecarRoot, "migrations");
  const webSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "web");
  const webModulePath = path.resolve(webSidecarRoot, "index.js");
  const apiPort = runtimeConfig.ports.api;
  const pglitePort = runtimeConfig.ports.pglite;
  const webPort = runtimeConfig.ports.web;
  const internalApiToken = runtimeConfig.tokens.internalApi;
  const skillApiToken = runtimeConfig.tokens.skill;
  const gatewayPoolId = runtimeConfig.gateway.poolId;
  const webUrl = runtimeConfig.urls.web;
  const authUrl = runtimeConfig.urls.auth;
  const electronNodeRunner = resolveElectronNodeRunner();
  const openclawNodePath = buildOpenclawNodePath(openclawSidecarRoot);

  // Keep all default ports and local URLs defined from this one manifest factory. Other desktop
  // entry points still mirror a few of these defaults directly, so changes here should be treated
  // as contract changes until those call sites are centralized.

  return [
    {
      id: "web",
      label: "Nexu Web Surface",
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
        WEB_API_ORIGIN: runtimeConfig.urls.apiBase,
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
      id: "pglite",
      label: "PGlite Socket",
      kind: "service",
      launchStrategy: "managed",
      runner: "utility-process",
      modulePath: pgliteModulePath,
      cwd: pgliteSidecarRoot,
      port: pglitePort,
      startupTimeoutMs: 10_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_PGLITE", true),
      logFilePath: path.resolve(logsDir, "pglite.log"),
      // API depends on PGlite - restart API when PGlite restarts
      dependents: ["api"],
      env: {
        PGLITE_DATA_DIR: pgliteDataPath,
        PGLITE_HOST: "127.0.0.1",
        PGLITE_PORT: String(pglitePort),
        PGLITE_MIGRATIONS_DIR: migrationsDir,
      },
    },
    {
      id: "api",
      label: "Nexu API",
      kind: "service",
      launchStrategy: "managed",
      // Use spawn instead of utility-process due to Electron bugs:
      // - https://github.com/electron/electron/issues/43186
      //   Network requests fail with ECONNRESET after event loop blocking
      // - https://github.com/electron/electron/issues/44727
      //   Utility process uses hidden network context, not session.defaultSession
      runner: "spawn",
      command: electronNodeRunner,
      args: [apiModulePath],
      cwd: apiSidecarRoot,
      port: apiPort,
      startupTimeoutMs: 20_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_API", true),
      logFilePath: path.resolve(logsDir, "api.log"),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "1",
        PORT: String(apiPort),
        DATABASE_URL: runtimeConfig.database.pgliteUrl,
        BETTER_AUTH_URL: authUrl,
        WEB_URL: webUrl,
        INTERNAL_API_TOKEN: internalApiToken,
        SKILL_API_TOKEN: skillApiToken,
        ENCRYPTION_KEY: ensureEncryptionKey(runtimeRoot),
        NEXU_DESKTOP_MODE: "true",
        NEXU_CLOUD_URL: runtimeConfig.urls.nexuCloud,
        ...(runtimeConfig.urls.nexuLink
          ? { NEXU_LINK_URL: runtimeConfig.urls.nexuLink }
          : {}),
        OPENCLAW_STATE_DIR: openclawStateDir,
        SKILLHUB_CACHE_DIR: path.resolve(runtimeRoot, "skillhub-cache"),
        OPENCLAW_SKILLS_DIR: getOpenclawSkillsDir(userDataPath),
        OPENCLAW_CURATED_SKILLS_DIR: getOpenclawCuratedSkillsDir(userDataPath),
      },
    },
    {
      id: "gateway",
      label: "Nexu Gateway",
      kind: "service",
      launchStrategy: "managed",
      // Use spawn instead of utility-process due to Electron bugs:
      // - https://github.com/electron/electron/issues/43186
      //   Network requests fail with ECONNRESET after event loop blocking
      // - https://github.com/electron/electron/issues/44727
      //   Utility process uses hidden network context, not session.defaultSession
      runner: "spawn",
      command: electronNodeRunner,
      args: [gatewayModulePath],
      cwd: gatewaySidecarRoot,
      port: null,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_GATEWAY", true),
      logFilePath: path.resolve(logsDir, "gateway.log"),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "1",
        NODE_ENV: "development",
        RUNTIME_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        RUNTIME_POOL_ID: gatewayPoolId,
        INTERNAL_API_TOKEN: internalApiToken,
        SKILL_API_TOKEN: skillApiToken,
        OPENCLAW_STATE_DIR: openclawStateDir,
        OPENCLAW_CONFIG_PATH: path.resolve(openclawConfigDir, "openclaw.json"),
        OPENCLAW_SKILLS_DIR: getOpenclawSkillsDir(userDataPath),
        OPENCLAW_CURATED_SKILLS_DIR: getOpenclawCuratedSkillsDir(userDataPath),
        OPENCLAW_BIN: runtimeConfig.paths.openclawBin,
        OPENCLAW_ELECTRON_EXECUTABLE: electronNodeRunner,
        OPENCLAW_EXTENSIONS_DIR: path.resolve(
          openclawPackageRoot,
          "extensions",
        ),
        OPENCLAW_DISABLE_BONJOUR: "1",
        TMPDIR: openclawTempDir,
        RUNTIME_MANAGE_OPENCLAW_PROCESS: "true",
        RUNTIME_GATEWAY_PROBE_ENABLED: "false",
        ...(openclawNodePath ? { PATH: openclawNodePath } : {}),
      },
    },
    {
      id: "openclaw",
      label: "OpenClaw Runtime",
      kind: "runtime",
      launchStrategy: "delegated",
      delegatedProcessMatch: "openclaw-gateway",
      binaryPath: runtimeConfig.paths.openclawBin,
      port: null,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "openclaw.log"),
    },
  ];
}
