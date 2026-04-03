import { existsSync } from "node:fs";
import path from "node:path";

export interface OpenClawCommandSpecInput {
  openclawBin: string;
  openclawElectronExecutable?: string | null;
  workspaceRoot?: string | null;
}

export interface OpenClawEntryResolutionInput {
  openclawBin: string;
  workspaceRoot?: string | null;
}

export interface OpenClawCommandSpec {
  command: string;
  argsPrefix: string[];
  extraEnv: Record<string, string>;
}

function logOpenClawRuntimeResolution(
  message: string,
  details: Record<string, unknown>,
): void {
  console.info(`[openclaw-runtime] ${message}`, details);
}

function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  for (let index = 0; index < 10; index += 1) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return null;
}

function resolveOpenclawEntryFromBin(binPath: string): string | null {
  const resolvedBinPath = path.resolve(binPath.trim());
  if (resolvedBinPath.endsWith(".mjs") && existsSync(resolvedBinPath)) {
    return resolvedBinPath;
  }
  const entry = path.resolve(
    path.dirname(resolvedBinPath),
    "..",
    "node_modules/openclaw/openclaw.mjs",
  );
  return existsSync(entry) ? entry : null;
}

export function resolveOpenClawEntryPath(
  input: OpenClawEntryResolutionInput,
): string | null {
  const workspaceRoot =
    input.workspaceRoot?.trim() || findWorkspaceRoot(process.cwd());
  const runtimeEntryPath = workspaceRoot
    ? path.join(
        workspaceRoot,
        "openclaw-runtime",
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      )
    : null;

  const openclawEntryFromBin = resolveOpenclawEntryFromBin(input.openclawBin);
  if (openclawEntryFromBin) {
    logOpenClawRuntimeResolution("resolved entry from openclaw bin", {
      openclawBin: input.openclawBin,
      workspaceRoot,
      resolvedEntryPath: openclawEntryFromBin,
    });
    return openclawEntryFromBin;
  }

  if (runtimeEntryPath && existsSync(runtimeEntryPath)) {
    logOpenClawRuntimeResolution("resolved entry from runtime package", {
      openclawBin: input.openclawBin,
      workspaceRoot,
      resolvedEntryPath: runtimeEntryPath,
    });
    return runtimeEntryPath;
  }

  return null;
}

export function getOpenClawCommandSpec(
  input: OpenClawCommandSpecInput,
): OpenClawCommandSpec {
  const workspaceRoot =
    input.workspaceRoot?.trim() || findWorkspaceRoot(process.cwd());
  const runtimeEntryPath = workspaceRoot
    ? path.join(
        workspaceRoot,
        "openclaw-runtime",
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      )
    : null;

  if (input.openclawElectronExecutable) {
    const entry = resolveOpenClawEntryPath({
      openclawBin: input.openclawBin,
      workspaceRoot: input.workspaceRoot,
    });
    if (!entry)
      throw new Error(
        "Unable to resolve OpenClaw entry point from OPENCLAW_BIN",
      );
    return {
      command: input.openclawElectronExecutable,
      argsPrefix: [entry],
      extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  if (
    path.isAbsolute(input.openclawBin) ||
    input.openclawBin.includes(path.sep)
  ) {
    return { command: input.openclawBin, argsPrefix: [], extraEnv: {} };
  }

  if (workspaceRoot) {
    if (runtimeEntryPath && existsSync(runtimeEntryPath)) {
      logOpenClawRuntimeResolution("selected runtime package command spec", {
        openclawBin: input.openclawBin,
        workspaceRoot,
        command: process.execPath,
        argsPrefix: [runtimeEntryPath],
      });
      return {
        command: process.execPath,
        argsPrefix: [runtimeEntryPath],
        extraEnv: {},
      };
    }
    const wrapperPath = path.join(workspaceRoot, "openclaw-wrapper");
    if (existsSync(wrapperPath)) {
      logOpenClawRuntimeResolution("selected wrapper command spec", {
        openclawBin: input.openclawBin,
        workspaceRoot,
        command: wrapperPath,
      });
      return { command: wrapperPath, argsPrefix: [], extraEnv: {} };
    }
  }

  logOpenClawRuntimeResolution("fell back to configured openclaw bin", {
    openclawBin: input.openclawBin,
    workspaceRoot,
  });
  return { command: input.openclawBin, argsPrefix: [], extraEnv: {} };
}
