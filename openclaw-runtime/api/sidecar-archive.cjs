const { existsSync, mkdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function resolvePackagedOpenclawArchivePath(packagedSidecarRoot) {
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");

  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  return existsSync(archivePath) ? archivePath : undefined;
}

function resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot) {
  return ensureDir(path.resolve(runtimeRoot, "openclaw-sidecar"));
}

function isPackagedOpenclawExtractionNeeded(input) {
  const stampPath = path.resolve(
    input.extractedSidecarRoot,
    input.stampFileName ?? ".archive-stamp",
  );
  const extractedOpenclawEntry = path.resolve(
    input.extractedSidecarRoot,
    input.archiveEntryPath,
  );

  if (!existsSync(stampPath) || !existsSync(extractedOpenclawEntry)) {
    return true;
  }

  const archiveStat = statSync(input.archivePath);
  const archiveStamp = `${archiveStat.size}:${archiveStat.mtimeMs}`;

  return readFileSync(stampPath, "utf8") !== archiveStamp;
}

module.exports = {
  isPackagedOpenclawExtractionNeeded,
  resolvePackagedOpenclawArchivePath,
  resolvePackagedOpenclawExtractedSidecarRoot,
};
