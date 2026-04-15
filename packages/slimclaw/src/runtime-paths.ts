import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type PrepareSlimclawRuntimeStageResult as PrepareSlimclawRuntimeStageResultInternal,
  computeSlimclawRuntimeStageFingerprint as computeSlimclawRuntimeStageFingerprintInternal,
  prepareSlimclawRuntimeStageInternal,
} from "./runtime-stage.js";

type OpenclawRuntimeCache = {
  fingerprint?: string;
  updatedAt?: string;
};

type OpenclawRuntimePackage = {
  dependencies?: {
    openclaw?: string;
  };
};

export type SlimclawRuntimeDescriptor = {
  version: 1;
  fingerprint: string;
  preparedAt: string;
  openclawVersion: string;
  relativeTo: "runtimeRoot";
  paths: {
    entryPath: string;
    binPath: string;
    builtinExtensionsDir: string;
  };
};

export type SlimclawRuntimePaths = {
  runtimeRoot: string;
  entryPath: string;
  binPath: string;
  builtinExtensionsDir: string;
  descriptorPath: string;
  descriptor: SlimclawRuntimeDescriptor;
};

export type SlimclawRuntimeArtifactPaths = {
  entryPath: string;
  binPath: string;
  builtinExtensionsDir: string;
};

export type ResolveSlimclawRuntimePathsOptions = {
  workspaceRoot?: string;
  requirePrepared?: boolean;
};

export type ResolveSlimclawRuntimeArtifactsOptions = {
  requirePrepared?: boolean;
};

export type PrepareSlimclawRuntimeStageOptions = {
  targetStageRoot: string;
  log?: (message: string) => void;
};

export type PrepareSlimclawRuntimeStageResult =
  PrepareSlimclawRuntimeStageResultInternal;

function getDefaultWorkspaceRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..", "..");
}

export function getSlimclawRuntimeRoot(
  workspaceRoot = getDefaultWorkspaceRoot(),
): string {
  const slimclawPackageRoot = path.resolve(
    workspaceRoot,
    "packages",
    "slimclaw",
  );
  return path.resolve(slimclawPackageRoot, ".dist-runtime", "openclaw");
}

export function getSlimclawDescriptorPath(
  workspaceRoot = getDefaultWorkspaceRoot(),
): string {
  return path.join(
    workspaceRoot,
    ".tmp",
    "slimclaw",
    "runtime-descriptor.json",
  );
}

export function getSlimclawRuntimePatchesRoot(
  workspaceRoot = getDefaultWorkspaceRoot(),
): string {
  return path.join(workspaceRoot, "packages", "slimclaw", "runtime-patches");
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function computeFallbackFingerprint(
  runtimeRoot: string,
  openclawVersion: string,
): string {
  return createHash("sha256")
    .update(runtimeRoot)
    .update("\0")
    .update(openclawVersion)
    .update("\0")
    .update(process.platform)
    .update("\0")
    .update(process.arch)
    .digest("hex");
}

function buildDescriptor(runtimeRoot: string): SlimclawRuntimeDescriptor {
  const runtimePackage = readJsonFile<OpenclawRuntimePackage>(
    path.join(runtimeRoot, "package.json"),
  );
  const cache = readJsonFile<OpenclawRuntimeCache>(
    path.join(runtimeRoot, ".postinstall-cache.json"),
  );
  const openclawVersion = runtimePackage?.dependencies?.openclaw ?? "unknown";

  return {
    version: 1,
    fingerprint:
      cache?.fingerprint ??
      computeFallbackFingerprint(runtimeRoot, openclawVersion),
    preparedAt: cache?.updatedAt ?? new Date(0).toISOString(),
    openclawVersion,
    relativeTo: "runtimeRoot",
    paths: {
      entryPath: path.join("node_modules", "openclaw", "openclaw.mjs"),
      binPath: path.join(
        "bin",
        process.platform === "win32" ? "openclaw.cmd" : "openclaw",
      ),
      builtinExtensionsDir: path.join("node_modules", "openclaw", "extensions"),
    },
  };
}

function assertRequiredRuntimePaths(
  requiredPaths: Array<[string, string]>,
): void {
  const missingPaths = requiredPaths.filter((entry) => !existsSync(entry[1]));

  if (missingPaths.length === 0) {
    return;
  }

  const missingSummary = missingPaths
    .map(([label, targetPath]) => `${label}: ${targetPath}`)
    .join(", ");
  throw new Error(
    `Slimclaw runtime is not prepared. Missing ${missingSummary}. Run pnpm slimclaw:prepare first.`,
  );
}

function getSlimclawRuntimeBinFileName(): string {
  return process.platform === "win32" ? "openclaw.cmd" : "openclaw";
}

export function resolveSlimclawRuntimeArtifacts(
  runtimeRoot: string,
  options: ResolveSlimclawRuntimeArtifactsOptions = {},
): SlimclawRuntimeArtifactPaths {
  const entryPath = path.join(
    runtimeRoot,
    "node_modules",
    "openclaw",
    "openclaw.mjs",
  );
  const binPath = path.join(
    runtimeRoot,
    "bin",
    getSlimclawRuntimeBinFileName(),
  );
  const builtinExtensionsDir = path.join(
    runtimeRoot,
    "node_modules",
    "openclaw",
    "extensions",
  );

  if (options.requirePrepared ?? true) {
    assertRequiredRuntimePaths([
      ["entry", entryPath],
      ["bin", binPath],
      ["builtinExtensionsDir", builtinExtensionsDir],
    ]);
  }

  return {
    entryPath,
    binPath,
    builtinExtensionsDir,
  };
}

function writeDescriptorFile(
  descriptorPath: string,
  descriptor: SlimclawRuntimeDescriptor,
): void {
  mkdirSync(path.dirname(descriptorPath), { recursive: true });
  const serialized = `${JSON.stringify(descriptor, null, 2)}\n`;
  const currentSerialized = existsSync(descriptorPath)
    ? readFileSync(descriptorPath, "utf8")
    : null;

  if (currentSerialized === serialized) {
    return;
  }

  writeFileSync(descriptorPath, serialized, "utf8");
}

export function resolveSlimclawRuntimePaths(
  options: ResolveSlimclawRuntimePathsOptions = {},
): SlimclawRuntimePaths {
  const workspaceRoot = options.workspaceRoot ?? getDefaultWorkspaceRoot();
  const runtimeRoot = getSlimclawRuntimeRoot(workspaceRoot);
  const descriptor = buildDescriptor(runtimeRoot);
  const descriptorPath = getSlimclawDescriptorPath(workspaceRoot);
  const { entryPath, binPath, builtinExtensionsDir } =
    resolveSlimclawRuntimeArtifacts(runtimeRoot, {
      requirePrepared: options.requirePrepared,
    });

  if (options.requirePrepared ?? true) {
    writeDescriptorFile(descriptorPath, descriptor);
  }

  return {
    runtimeRoot,
    entryPath,
    binPath,
    builtinExtensionsDir,
    descriptorPath,
    descriptor,
  };
}

export async function prepareSlimclawRuntimeStage(
  options: PrepareSlimclawRuntimeStageOptions,
): Promise<PrepareSlimclawRuntimeStageResult> {
  const workspaceRoot = getDefaultWorkspaceRoot();
  const runtimePaths = resolveSlimclawRuntimePaths({
    workspaceRoot,
    requirePrepared: true,
  });

  return prepareSlimclawRuntimeStageInternal({
    sourceOpenclawRoot: path.dirname(runtimePaths.entryPath),
    patchRoot: getSlimclawRuntimePatchesRoot(workspaceRoot),
    targetStageRoot: options.targetStageRoot,
    log: options.log,
  });
}

export async function computeSlimclawRuntimeStageFingerprint(): Promise<string> {
  const workspaceRoot = getDefaultWorkspaceRoot();
  const runtimePaths = resolveSlimclawRuntimePaths({
    workspaceRoot,
    requirePrepared: true,
  });

  return computeSlimclawRuntimeStageFingerprintInternal({
    sourceOpenclawRoot: path.dirname(runtimePaths.entryPath),
    patchRoot: getSlimclawRuntimePatchesRoot(workspaceRoot),
  });
}
