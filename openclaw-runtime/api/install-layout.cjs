const path = require("node:path");

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveRepoLocalOpenClawInstallLayout(workspaceRoot = getRepoRoot()) {
  const runtimePackageRoot = path.join(workspaceRoot, "openclaw-runtime");
  const runtimeNodeModulesPath = path.join(runtimePackageRoot, "node_modules");

  return {
    runtimePackageRoot,
    runtimeNodeModulesPath,
    runtimeEntryPath: path.join(
      runtimeNodeModulesPath,
      "openclaw",
      "openclaw.mjs",
    ),
    runtimeBinPath: path.join(runtimePackageRoot, "bin", "openclaw"),
    runtimeGatewayBinPath: path.join(
      runtimePackageRoot,
      "bin",
      "openclaw-gateway",
    ),
    runtimePackageJsonPath: path.join(runtimePackageRoot, "package.json"),
    runtimeLockfilePath: path.join(runtimePackageRoot, "package-lock.json"),
    runtimePostinstallCachePath: path.join(
      runtimePackageRoot,
      ".postinstall-cache.json",
    ),
    criticalRuntimePaths: [
      path.join(runtimeNodeModulesPath, "openclaw", "dist"),
      path.join(
        runtimeNodeModulesPath,
        "@whiskeysockets",
        "baileys",
        "lib",
        "index.js",
      ),
      path.join(
        runtimeNodeModulesPath,
        "@whiskeysockets",
        "baileys",
        "WAProto",
        "index.js",
      ),
      path.join(
        runtimeNodeModulesPath,
        "@whiskeysockets",
        "baileys",
        "package.json",
      ),
    ],
  };
}

module.exports = {
  resolveRepoLocalOpenClawInstallLayout,
};
