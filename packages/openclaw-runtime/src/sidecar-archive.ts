import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function ensureDir(dirPath: string): string {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function resolvePackagedOpenclawArchivePath(
  packagedSidecarRoot: string,
): string | undefined {
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");

  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  return existsSync(archivePath) ? archivePath : undefined;
}

export function resolvePackagedOpenclawExtractedSidecarRoot(
  runtimeRoot: string,
): string {
  return ensureDir(path.resolve(runtimeRoot, "openclaw-sidecar"));
}

export function isPackagedOpenclawExtractionNeeded(input: {
  extractedSidecarRoot: string;
  archivePath: string;
  archiveEntryPath: string;
  stampFileName?: string;
}): boolean {
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
