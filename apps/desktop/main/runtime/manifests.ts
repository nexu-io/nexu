import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import {
  isPackagedOpenclawExtractionNeeded,
  resolvePackagedOpenclawArchivePath,
  resolvePackagedOpenclawExtractedSidecarRoot,
  resolvePackagedOpenclawSidecarRoot,
} from "@nexu/openclaw-runtime";
import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import { resolveRuntimeManifestsRoots } from "../platforms/shared/runtime-roots";
import { createAsyncArchiveSidecarMaterializer } from "../platforms/shared/sidecar-materializer";
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
  return [] as RuntimeUnitManifest[];
}
