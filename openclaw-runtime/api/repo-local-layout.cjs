const path = require("node:path");

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveOpenClawRepoLocalLayout(input = {}) {
  const repoRoot = getRepoRoot();
  const runtimeRoot = path.join(repoRoot, "openclaw-runtime");
  const openclawEntryPath =
    input.openclawEntryPath ??
    path.join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs");

  return {
    openclawPackageRootPath: runtimeRoot,
    openclawEntryPath,
    openclawBuiltinExtensionsDir: path.join(
      path.dirname(openclawEntryPath),
      "extensions",
    ),
    openclawStageSourceRootPath: path.join(
      runtimeRoot,
      "node_modules",
      "openclaw",
    ),
    openclawPatchRootPath: path.join(repoRoot, "openclaw-runtime-patches"),
    openclawSidecarRootPath: path.join(runtimeRoot, "openclaw"),
  };
}

module.exports = {
  resolveOpenClawRepoLocalLayout,
};
