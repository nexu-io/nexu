import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export type ResolveSlimclawRuntimePathsOptions = {
  workspaceRoot?: string;
  requirePrepared?: boolean;
};

function getDefaultWorkspaceRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..", "..");
}

export function getSlimclawRuntimeRoot(
  workspaceRoot = getDefaultWorkspaceRoot(),
): string {
  return path.resolve(workspaceRoot, "openclaw-runtime");
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
      binPath: path.join("bin", "openclaw"),
      builtinExtensionsDir: path.join("node_modules", "openclaw", "extensions"),
    },
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
  const entryPath = path.join(runtimeRoot, descriptor.paths.entryPath);
  const binPath = path.join(runtimeRoot, descriptor.paths.binPath);
  const builtinExtensionsDir = path.join(
    runtimeRoot,
    descriptor.paths.builtinExtensionsDir,
  );

  writeDescriptorFile(descriptorPath, descriptor);

  if (options.requirePrepared ?? true) {
    const requiredPaths: Array<[string, string]> = [
      ["entry", entryPath],
      ["bin", binPath],
      ["builtinExtensionsDir", builtinExtensionsDir],
    ];
    const missingPaths = requiredPaths.filter((entry) => !existsSync(entry[1]));

    if (missingPaths.length > 0) {
      const missingSummary = missingPaths
        .map(([label, targetPath]) => `${label}: ${targetPath}`)
        .join(", ");
      throw new Error(
        `Slimclaw runtime is not prepared. Missing ${missingSummary}. Run pnpm openclaw-runtime:install first.`,
      );
    }
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
