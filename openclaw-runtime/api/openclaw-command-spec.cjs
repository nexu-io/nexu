const { existsSync } = require("node:fs");
const path = require("node:path");

const {
  resolveRepoLocalOpenClawInstallLayout,
} = require("./install-layout.cjs");

function logOpenClawRuntimeResolution(message, details) {
  console.info(`[openclaw-runtime] ${message}`, details);
}

function findWorkspaceRoot(startDir) {
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

function resolveOpenclawEntryFromBin(binPath) {
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

function resolveOpenClawEntryPath(input) {
  const workspaceRoot =
    input.workspaceRoot?.trim() || findWorkspaceRoot(process.cwd());
  const runtimeEntryPath = workspaceRoot
    ? resolveRepoLocalOpenClawInstallLayout(workspaceRoot).runtimeEntryPath
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

function getOpenClawCommandSpec(input) {
  const workspaceRoot =
    input.workspaceRoot?.trim() || findWorkspaceRoot(process.cwd());
  const runtimeEntryPath = workspaceRoot
    ? resolveRepoLocalOpenClawInstallLayout(workspaceRoot).runtimeEntryPath
    : null;

  if (input.openclawElectronExecutable) {
    const entry = resolveOpenClawEntryPath({
      openclawBin: input.openclawBin,
      workspaceRoot: input.workspaceRoot,
    });
    if (!entry) {
      throw new Error(
        "Unable to resolve OpenClaw entry point from OPENCLAW_BIN",
      );
    }
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

module.exports = {
  getOpenClawCommandSpec,
  resolveOpenClawEntryPath,
};
