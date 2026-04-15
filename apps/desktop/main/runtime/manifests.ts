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
import { resolveWindowsPackagedOpenclawSidecarRoot } from "../platforms/win/slimclaw-runtime-locator";
import type { RuntimeUnitManifest } from "./types";

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function extractPackagedOpenclawSidecar(input: {
  extractedSidecarRoot: string;
  archivePath: string;
  archiveEntryPath: string;
  stampFileName?: string;
}): string {
  const stampFileName = input.stampFileName ?? ".archive-stamp";
  const archiveStat = statSync(input.archivePath);
  const archiveStamp = `${archiveStat.size}:${archiveStat.mtimeMs}`;
  const stagingRoot = `${input.extractedSidecarRoot}.staging`;
  const maxRetries = 3;

  if (existsSync(stagingRoot)) {
    execFileSync("rm", ["-rf", stagingRoot]);
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (existsSync(stagingRoot)) {
        execFileSync("rm", ["-rf", stagingRoot]);
      }

      mkdirSync(stagingRoot, { recursive: true });
      execFileSync("tar", ["-xzf", input.archivePath, "-C", stagingRoot]);

      const stagingEntry = path.resolve(stagingRoot, input.archiveEntryPath);
      if (!existsSync(stagingEntry)) {
        throw new Error(
          `Extraction verification failed: ${stagingEntry} not found`,
        );
      }

      writeFileSync(path.resolve(stagingRoot, stampFileName), archiveStamp);

      if (existsSync(input.extractedSidecarRoot)) {
        execFileSync("rm", ["-rf", input.extractedSidecarRoot]);
      }

      execFileSync("mv", [stagingRoot, input.extractedSidecarRoot]);
      return input.extractedSidecarRoot;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error;
      }

      if (existsSync(stagingRoot)) {
        execFileSync("rm", ["-rf", stagingRoot]);
      }
    }
  }

  return input.extractedSidecarRoot;
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
      { stdio: "ignore", env: { ...process.env, NODE_PATH: "" } },
    );
    return true;
  } catch {
    return false;
  }
}

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
    if (!candidate) continue;

    if (!supportsOpenclawRuntime(candidate, openclawSidecarRoot)) continue;

    const candidateDir = path.dirname(candidate);
    const currentFirstPath = currentPath.split(path.delimiter)[0] ?? "";
    if (candidateDir === currentFirstPath) {
      return undefined;
    }

    return `${candidateDir}${path.delimiter}${currentPath}`;
  }

  return buildNode22Path();
}

function resolvePackagedOpenclawArchivePath(
  packagedSidecarRoot: string,
): string | undefined {
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");
  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  return existsSync(archivePath) ? archivePath : undefined;
}

function resolvePackagedOpenclawExtractedSidecarRoot(
  runtimeRoot: string,
): string {
  const extractedRoot = path.resolve(runtimeRoot, "openclaw-sidecar");
  mkdirSync(extractedRoot, { recursive: true });
  return extractedRoot;
}

function resolvePackagedOpenclawSidecarRoot(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archivePath = resolvePackagedOpenclawArchivePath(packagedSidecarRoot);

  if (!archivePath) {
    return packagedSidecarRoot;
  }

  return resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot);
}

function isPackagedOpenclawExtractionNeeded(input: {
  extractedSidecarRoot: string;
  archivePath: string;
  archiveEntryPath: string;
  stampFileName?: string;
}): boolean {
  const stampPath = path.resolve(
    input.extractedSidecarRoot,
    input.stampFileName ?? ".archive-stamp",
  );
  const extractedOpenclawEntry = path.resolve(
    input.extractedSidecarRoot,
    input.archiveEntryPath,
  );

  if (!existsSync(stampPath) || !existsSync(extractedOpenclawEntry)) {
    return true;
  }

  const archiveStat = statSync(input.archivePath);
  const archiveStamp = `${archiveStat.size}:${archiveStat.mtimeMs}`;

  return readFileSync(stampPath, "utf8") !== archiveStamp;
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

export function resolveOpenclawSidecarRoot(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  return resolvePackagedOpenclawSidecarRoot(
    runtimeSidecarBaseRoot,
    runtimeRoot,
  );
}

export function ensurePackagedOpenclawSidecar(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const packagedOpenclawEntry = path.resolve(
    packagedSidecarRoot,
    "node_modules/openclaw/openclaw.mjs",
  );

  if (existsSync(packagedOpenclawEntry)) {
    return packagedSidecarRoot;
  }

  const archivePath = resolvePackagedOpenclawArchivePath(packagedSidecarRoot);
  if (!archivePath) {
    return packagedSidecarRoot;
  }

  const extractedSidecarRoot =
    resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot);
  if (
    !isPackagedOpenclawExtractionNeeded({
      extractedSidecarRoot,
      archivePath,
      archiveEntryPath: "node_modules/openclaw/openclaw.mjs",
    })
  ) {
    return extractedSidecarRoot;
  }

  return extractPackagedOpenclawSidecar({
    extractedSidecarRoot,
    archivePath,
    archiveEntryPath: "node_modules/openclaw/openclaw.mjs",
  });
}

export function checkOpenclawExtractionNeeded(
  electronRoot: string,
  userDataPath: string,
  isPackaged: boolean,
): boolean {
  if (!isPackaged) return false;

  const runtimeSidecarBaseRoot = path.resolve(electronRoot, "runtime");
  const runtimeRoot = path.resolve(userDataPath, "runtime");
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archivePath = resolvePackagedOpenclawArchivePath(packagedSidecarRoot);

  if (!archivePath) return false;

  const extractedSidecarRoot = path.resolve(runtimeRoot, "openclaw-sidecar");
  return isPackagedOpenclawExtractionNeeded({
    extractedSidecarRoot,
    archivePath,
    archiveEntryPath: "node_modules/openclaw/openclaw.mjs",
  });
}

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
    openclawConfigDir,
    openclawStateDir,
    openclawTempDir,
    logsDir,
  } = resolveRuntimeManifestsRoots({
    app: { getPath: () => userDataPath, isPackaged } as never,
    electronRoot,
    runtimeConfig,
  });
  const repoRoot = getWorkspaceRoot();
  const controllerRoot = isPackaged
    ? path.resolve(runtimeSidecarBaseRoot, "controller")
    : path.resolve(repoRoot, "apps", "controller");
  const controllerEntryPath = path.resolve(controllerRoot, "dist", "index.js");
  const webRoot = isPackaged
    ? path.resolve(runtimeSidecarBaseRoot, "web")
    : path.resolve(repoRoot, "apps", "desktop", "sidecars", "web");
  const webEntryPath = path.resolve(webRoot, "index.js");
  const packagedOpenclawRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const packagedOpenclawArchive =
    resolvePackagedOpenclawArchivePath(packagedOpenclawRoot);
  const extractedOpenclawRoot =
    resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot);
  const effectiveOpenclawSidecarRoot = isPackaged
    ? process.platform === "win32"
      ? resolveWindowsPackagedOpenclawSidecarRoot({
          packagedSidecarRoot: packagedOpenclawRoot,
          extractedSidecarRoot: extractedOpenclawRoot,
          packagedArchivePath: packagedOpenclawArchive ?? null,
        })
      : extractedOpenclawRoot
    : openclawSidecarRoot;
  const effectiveOpenclawBinPath = path.resolve(
    effectiveOpenclawSidecarRoot,
    "bin",
    process.platform === "win32" ? "openclaw.cmd" : "openclaw",
  );
  const openclawNodePath = buildOpenclawNodePath(openclawSidecarRoot);
  const openclawPort = Number(
    new URL(runtimeConfig.urls.openclawBase).port || 18789,
  );
  const skillNodePath = buildSkillNodePath(electronRoot, isPackaged);
  const proxyEnv = buildChildProcessProxyEnv(runtimeConfig.proxy);
  const langfuseEnv = {
    ...(process.env.LANGFUSE_PUBLIC_KEY
      ? { LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY }
      : {}),
    ...(process.env.LANGFUSE_SECRET_KEY
      ? { LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY }
      : {}),
    ...(process.env.LANGFUSE_BASE_URL
      ? { LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL }
      : {}),
  };
  const openclawSkillsDir = getOpenclawSkillsDir(userDataPath);
  const openclawMdnsHostname = "openclaw";
  const skillhubStaticSkillsDir = isPackaged
    ? path.resolve(electronRoot, "static", "bundled-skills")
    : path.resolve(repoRoot, "apps", "desktop", "static", "bundled-skills");
  const platformTemplatesDir = isPackaged
    ? path.resolve(electronRoot, "static", "platform-templates")
    : path.resolve(
        repoRoot,
        "apps",
        "controller",
        "static",
        "platform-templates",
      );

  ensureDir(runtimeRoot);
  ensureDir(logsDir);
  ensureDir(openclawConfigDir);
  ensureDir(openclawStateDir);
  ensureDir(openclawTempDir);

  const controllerManifest: RuntimeUnitManifest = {
    id: "controller",
    label: "Controller",
    kind: "service",
    launchStrategy: "managed",
    command: resolveElectronNodeRunner(),
    args: [controllerEntryPath],
    cwd: controllerRoot,
    port: runtimeConfig.ports.controller,
    startupTimeoutMs: 30_000,
    autoStart: false,
    logFilePath: path.resolve(logsDir, "controller.log"),
    dependents: ["web"],
    env: {
      ...proxyEnv,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: isPackaged ? "production" : "development",
      PORT: String(runtimeConfig.ports.controller),
      HOST: "127.0.0.1",
      ...(process.env.CI ? { CI: process.env.CI } : {}),
      WEB_URL: runtimeConfig.urls.web,
      NEXU_HOME: runtimeConfig.paths.nexuHome,
      NEXU_CONTROLLER_OPENCLAW_MODE: "internal",
      RUNTIME_MANAGE_OPENCLAW_PROCESS: "true",
      RUNTIME_GATEWAY_PROBE_ENABLED: "true",
      OPENCLAW_GATEWAY_PORT: String(openclawPort),
      OPENCLAW_GATEWAY_TOKEN: runtimeConfig.tokens.gateway,
      OPENCLAW_BASE_URL: runtimeConfig.urls.openclawBase,
      OPENCLAW_MDNS_HOSTNAME: openclawMdnsHostname,
      ...(process.env.CI ? { OPENCLAW_DISABLE_BONJOUR: "1" } : {}),
      OPENCLAW_STATE_DIR: openclawStateDir,
      OPENCLAW_CONFIG_PATH: path.resolve(openclawStateDir, "openclaw.json"),
      OPENCLAW_LOG_DIR: path.resolve(
        runtimeConfig.paths.nexuHome,
        "logs",
        "openclaw",
      ),
      OPENCLAW_SKILLS_DIR: openclawSkillsDir,
      SKILLHUB_STATIC_SKILLS_DIR: skillhubStaticSkillsDir,
      PLATFORM_TEMPLATES_DIR: platformTemplatesDir,
      OPENCLAW_BIN: effectiveOpenclawBinPath,
      ...(isPackaged
        ? { OPENCLAW_ELECTRON_EXECUTABLE: resolveElectronNodeRunner() }
        : {}),
      OPENCLAW_EXTENSIONS_DIR: path.resolve(
        effectiveOpenclawSidecarRoot,
        "node_modules",
        "openclaw",
        "extensions",
      ),
      NODE_PATH: skillNodePath,
      TMPDIR: openclawTempDir,
      ...(runtimeConfig.posthogApiKey
        ? { POSTHOG_API_KEY: runtimeConfig.posthogApiKey }
        : {}),
      ...(runtimeConfig.posthogHost
        ? { POSTHOG_HOST: runtimeConfig.posthogHost }
        : {}),
      ...langfuseEnv,
    },
  };

  const webManifest: RuntimeUnitManifest = {
    id: "web",
    label: "Web",
    kind: "surface",
    launchStrategy: "managed",
    command: resolveElectronNodeRunner(),
    args: [webEntryPath],
    cwd: webRoot,
    port: runtimeConfig.ports.web,
    startupTimeoutMs: 15_000,
    autoStart: false,
    logFilePath: path.resolve(logsDir, "web.log"),
    env: {
      ...proxyEnv,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: isPackaged ? "production" : "development",
      WEB_HOST: "127.0.0.1",
      WEB_PORT: String(runtimeConfig.ports.web),
      WEB_API_ORIGIN: runtimeConfig.urls.controllerBase,
    },
  };

  const openclawManifest: RuntimeUnitManifest = {
    id: "openclaw",
    label: "OpenClaw",
    kind: "runtime",
    launchStrategy: "external",
    port: openclawPort,
    autoStart: false,
    logFilePath: path.resolve(logsDir, "openclaw.log"),
    env: {
      ...(openclawNodePath ? { NODE_PATH: openclawNodePath } : {}),
      OPENCLAW_CONFIG_PATH: path.resolve(openclawStateDir, "openclaw.json"),
      OPENCLAW_MDNS_HOSTNAME: openclawMdnsHostname,
      ...(process.env.CI ? { OPENCLAW_DISABLE_BONJOUR: "1" } : {}),
      OPENCLAW_STATE_DIR: openclawStateDir,
      ...langfuseEnv,
    },
  };

  return [controllerManifest, webManifest, openclawManifest];
}
