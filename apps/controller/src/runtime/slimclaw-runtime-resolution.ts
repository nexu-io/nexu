import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export type ArtifactBackedOpenClawRuntimeResolution = {
  mode: "explicit-env";
  binPath: string;
  entryPath: string;
  builtinExtensionsDir: string;
  packageDir: string;
};

export type ExternalBinOnlyOpenClawRuntimeResolution = {
  mode: "external-bin-only";
  binPath: string;
  entryPath: null;
  builtinExtensionsDir: null;
  packageDir: null;
};

export type OpenClawRuntimeResolution =
  | ArtifactBackedOpenClawRuntimeResolution
  | ExternalBinOnlyOpenClawRuntimeResolution;

export type OpenClawCommandSpec = {
  command: string;
  argsPrefix: string[];
  extraEnv: Record<string, string>;
  runtime: OpenClawRuntimeResolution;
};

function resolveOpenClawEntryFromBin(binPath: string): string | null {
  const trimmedPath = binPath.trim();
  if (trimmedPath.length === 0) {
    return null;
  }

  const resolvedBinPath = path.resolve(trimmedPath);
  if (resolvedBinPath.endsWith(".mjs")) {
    return resolvedBinPath;
  }

  return path.resolve(
    path.dirname(resolvedBinPath),
    "..",
    "node_modules",
    "openclaw",
    "openclaw.mjs",
  );
}

function resolveExplicitEnvRuntime(
  env: ControllerEnv,
): ArtifactBackedOpenClawRuntimeResolution | null {
  if (!env.openclawBuiltinExtensionsDir) {
    return null;
  }

  const packageDir = path.dirname(env.openclawBuiltinExtensionsDir);
  const entryPath =
    resolveOpenClawEntryFromBin(env.openclawBin) ??
    path.join(packageDir, "openclaw.mjs");

  return {
    mode: "explicit-env",
    binPath: env.openclawBin,
    entryPath,
    builtinExtensionsDir: env.openclawBuiltinExtensionsDir,
    packageDir,
  };
}

export function resolveControllerOpenClawRuntime(
  env: ControllerEnv,
): OpenClawRuntimeResolution {
  const explicitRuntime = resolveExplicitEnvRuntime(env);
  if (explicitRuntime) {
    return explicitRuntime;
  }

  if (!env.manageOpenclawProcess) {
    return {
      mode: "external-bin-only",
      binPath: env.openclawBin,
      entryPath: null,
      builtinExtensionsDir: null,
      packageDir: null,
    };
  }

  throw new Error(
    "Controller-managed OpenClaw requires OPENCLAW_BIN and OPENCLAW_EXTENSIONS_DIR from the launcher.",
  );
}

export function getOpenClawCommandSpec(
  env: ControllerEnv,
): OpenClawCommandSpec {
  const runtime = resolveControllerOpenClawRuntime(env);
  const electronExec = process.env.OPENCLAW_ELECTRON_EXECUTABLE?.trim();

  if (electronExec) {
    if (!runtime.entryPath) {
      throw new Error(
        "OPENCLAW_ELECTRON_EXECUTABLE requires an artifact-backed OpenClaw runtime entry path",
      );
    }

    return {
      command: electronExec,
      argsPrefix: [runtime.entryPath],
      extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
      runtime,
    };
  }

  return {
    command: runtime.binPath,
    argsPrefix: [],
    extraEnv: {},
    runtime,
  };
}

export function requireArtifactBackedOpenClawRuntime(
  env: ControllerEnv,
): ArtifactBackedOpenClawRuntimeResolution {
  const runtime = resolveControllerOpenClawRuntime(env);
  if (runtime.mode === "external-bin-only") {
    throw new Error(
      "This operation requires an artifact-backed OpenClaw runtime with builtin extensions available",
    );
  }

  return runtime;
}
