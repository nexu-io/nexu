const path = require("node:path");

const {
  resolvePackagedOpenclawArchivePath,
  resolvePackagedOpenclawExtractedSidecarRoot,
} = require("./sidecar-archive.cjs");

function resolvePackagedOpenclawSidecarRoot(
  runtimeSidecarBaseRoot,
  runtimeRoot,
) {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archivePath = resolvePackagedOpenclawArchivePath(packagedSidecarRoot);

  if (!archivePath) {
    return packagedSidecarRoot;
  }

  return resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot);
}

module.exports = {
  resolvePackagedOpenclawSidecarRoot,
};
