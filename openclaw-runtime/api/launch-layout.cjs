const path = require("node:path");

const {
  resolveRepoLocalOpenClawInstallLayout,
} = require("./install-layout.cjs");

function resolvePackagedOpenClawLaunchLayout(sidecarRoot) {
  return {
    openclawPath: path.join(
      sidecarRoot,
      "node_modules",
      "openclaw",
      "openclaw.mjs",
    ),
    openclawCwd: sidecarRoot,
    openclawBinPath: path.join(sidecarRoot, "bin", "openclaw"),
    openclawExtensionsDir: path.join(
      sidecarRoot,
      "node_modules",
      "openclaw",
      "extensions",
    ),
  };
}

function resolveRepoLocalOpenClawLaunchLayout(repoRoot) {
  const installLayout = resolveRepoLocalOpenClawInstallLayout(repoRoot);

  return {
    openclawPath: installLayout.runtimeEntryPath,
    openclawCwd: repoRoot,
    openclawBinPath: path.join(
      repoRoot,
      ".tmp",
      "sidecars",
      "openclaw",
      "bin",
      "openclaw",
    ),
    openclawExtensionsDir: path.join(
      repoRoot,
      ".tmp",
      "sidecars",
      "openclaw",
      "node_modules",
      "openclaw",
      "extensions",
    ),
  };
}

module.exports = {
  resolvePackagedOpenClawLaunchLayout,
  resolveRepoLocalOpenClawLaunchLayout,
};
