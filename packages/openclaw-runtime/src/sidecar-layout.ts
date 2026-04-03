import path from "node:path";

import {
  resolvePackagedOpenclawArchivePath,
  resolvePackagedOpenclawExtractedSidecarRoot,
} from "./sidecar-archive.js";

export function resolvePackagedOpenclawSidecarRoot(
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archivePath = resolvePackagedOpenclawArchivePath(packagedSidecarRoot);

  if (!archivePath) {
    return packagedSidecarRoot;
  }

  return resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot);
}
