import { execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  getOpenclawCuratedSkillsDir,
  getOpenclawSkillsDir,
} from "../../shared/desktop-paths";
import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import type { RuntimeUnitManifest } from "./types";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl") as {
  open: (
    path: string,
    options: { lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: YauzlZipFile) => void,
  ) => void;
};

type YauzlEntry = {
  fileName: string;
  externalFileAttributes?: number;
};

type YauzlZipFile = {
  readEntry: () => void;
  on: (event: "entry", listener: (entry: YauzlEntry) => void) => void;
  once: (
    event: "end" | "error",
    listener: (() => void) | ((error: Error) => void),
  ) => void;
  openReadStream: (
    entry: YauzlEntry,
    callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void,
  ) => void;
  close: () => void;
};

type PackagedArchiveMetadata = {
  format: string;
  path: string;
  version?: string;
};

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

function resolveArchiveStamp(
  archivePath: string,
  archiveMetadata: PackagedArchiveMetadata | null,
): string {
  if (archiveMetadata?.version) {
    return archiveMetadata.version;
  }

  const archiveStat = statSync(archivePath);
  return `${archiveStat.size}:${archiveStat.mtimeMs}`;
}

function readPackagedArchiveMetadata(
  packagedSidecarRoot: string,
): PackagedArchiveMetadata | null {
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");

  if (!existsSync(archiveMetadataPath)) {
    return null;
  }

  return JSON.parse(
    readFileSync(archiveMetadataPath, "utf8"),
  ) as PackagedArchiveMetadata;
}

async function extractZipArchive(
  archivePath: string,
  destinationRoot: string,
): Promise<void> {
  await new Promise<void>((resolveExtract, rejectExtract) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        rejectExtract(
          openError ?? new Error(`Unable to open zip archive ${archivePath}`),
        );
        return;
      }

      const closeWithError = (error: Error) => {
        zipFile.close();
        rejectExtract(error);
      };

      zipFile.once("error", closeWithError);
      zipFile.once("end", () => {
        zipFile.close();
        resolveExtract();
      });
      zipFile.on("entry", (entry) => {
        void (async () => {
          const normalizedPath = entry.fileName.replace(/\\/gu, "/");
          if (!normalizedPath || normalizedPath === ".") {
            zipFile.readEntry();
            return;
          }

          const destinationPath = path.resolve(destinationRoot, normalizedPath);
          const relativePath = path.relative(destinationRoot, destinationPath);
          if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            throw new Error(
              `Refusing to extract path outside destination: ${entry.fileName}`,
            );
          }

          if (normalizedPath.endsWith("/")) {
            await mkdir(destinationPath, { recursive: true });
            zipFile.readEntry();
            return;
          }

          await mkdir(path.dirname(destinationPath), { recursive: true });
          zipFile.openReadStream(entry, async (streamError, readStream) => {
            if (streamError || !readStream) {
              closeWithError(
                streamError ??
                  new Error(`Unable to read zip entry ${entry.fileName}`),
              );
              return;
            }

            try {
              await pipeline(readStream, createWriteStream(destinationPath));
              if (process.platform !== "win32") {
                const entryMode = entry.externalFileAttributes
                  ? (entry.externalFileAttributes >>> 16) & 0o777
                  : 0;
                if (entryMode > 0) {
                  await chmod(destinationPath, entryMode);
                }
              }
              zipFile.readEntry();
            } catch (error) {
              closeWithError(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          });
        })().catch((error) => {
          closeWithError(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      });

      zipFile.readEntry();
    });
  });
}

async function ensurePackagedOpenclawSidecar(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): Promise<string> {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archiveMetadata = readPackagedArchiveMetadata(packagedSidecarRoot);
  const archivePath = archiveMetadata
    ? path.resolve(packagedSidecarRoot, archiveMetadata.path)
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  if (!existsSync(archivePath)) {
    return packagedSidecarRoot;
  }

  const extractedSidecarRoot = ensureDir(
    path.resolve(runtimeRoot, "openclaw-sidecar"),
  );
  const stampPath = path.resolve(extractedSidecarRoot, ".archive-stamp");
  const archiveStamp = resolveArchiveStamp(archivePath, archiveMetadata);
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

  const tempExtractedSidecarRoot = path.resolve(
    runtimeRoot,
    "openclaw-sidecar.extracting",
  );
  await rm(tempExtractedSidecarRoot, { recursive: true, force: true });
  await mkdir(tempExtractedSidecarRoot, { recursive: true });

  if (!archiveMetadata || archiveMetadata.format === "tar.gz") {
    execFileSync("tar", ["-xzf", archivePath, "-C", tempExtractedSidecarRoot]);
  } else if (archiveMetadata.format === "zip") {
    await extractZipArchive(archivePath, tempExtractedSidecarRoot);
  } else {
    throw new Error(
      `Unsupported packaged archive format: ${archiveMetadata.format}`,
    );
  }

  if (process.platform !== "win32") {
    await chmod(
      path.resolve(tempExtractedSidecarRoot, "bin/openclaw"),
      0o755,
    ).catch(() => null);
  }

  rmSync(extractedSidecarRoot, { recursive: true, force: true });
  await rename(tempExtractedSidecarRoot, extractedSidecarRoot);
  writeFileSync(stampPath, archiveStamp);

  return extractedSidecarRoot;
}

export async function createRuntimeUnitManifests(
  electronRoot: string,
  userDataPath: string,
  isPackaged: boolean,
  runtimeConfig: DesktopRuntimeConfig,
): Promise<RuntimeUnitManifest[]> {
  const repoRoot = getWorkspaceRoot();
  const _nexuRoot = repoRoot;
  const runtimeSidecarBaseRoot = isPackaged
    ? path.resolve(electronRoot, "runtime")
    : path.resolve(repoRoot, ".tmp/sidecars");
  const runtimeRoot = ensureDir(path.resolve(userDataPath, "runtime"));
  const openclawSidecarRoot = isPackaged
    ? await ensurePackagedOpenclawSidecar(runtimeSidecarBaseRoot, runtimeRoot)
    : path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const logsDir = ensureDir(path.resolve(userDataPath, "logs/runtime-units"));
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
    path.resolve(openclawSidecarRoot, "bin/openclaw");
  const controllerPort = runtimeConfig.ports.controller;
  const webPort = runtimeConfig.ports.web;
  const webUrl = runtimeConfig.urls.web;
  const electronNodeRunner = resolveElectronNodeRunner();
  const openclawNodePath = buildOpenclawNodePath(openclawSidecarRoot);
  const skillNodePath = buildSkillNodePath(electronRoot, isPackaged);

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
        WEB_API_ORIGIN: runtimeConfig.urls.controllerBase,
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
      label: "Nexu Controller",
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
        NEXU_CLOUD_URL: runtimeConfig.urls.nexuCloud,
        ...(runtimeConfig.urls.nexuLink
          ? { NEXU_LINK_URL: runtimeConfig.urls.nexuLink }
          : {}),
        OPENCLAW_STATE_DIR: openclawStateDir,
        OPENCLAW_CONFIG_PATH: path.resolve(openclawConfigDir, "openclaw.json"),
        OPENCLAW_SKILLS_DIR: getOpenclawSkillsDir(userDataPath),
        OPENCLAW_CURATED_SKILLS_DIR: getOpenclawCuratedSkillsDir(userDataPath),
        SKILLHUB_STATIC_SKILLS_DIR: isPackaged
          ? path.resolve(electronRoot, "static/bundled-skills")
          : path.resolve(repoRoot, "apps/desktop/static/bundled-skills"),
        PLATFORM_TEMPLATES_DIR: isPackaged
          ? path.resolve(electronRoot, "static/platform-templates")
          : path.resolve(repoRoot, "apps/controller/static/platform-templates"),
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
