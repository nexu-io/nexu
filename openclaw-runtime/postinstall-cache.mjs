import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const cacheInputs = [
  "package.json",
  "package-lock.json",
  "clean-node-modules.mjs",
  "postinstall.mjs",
  "postinstall-cache.mjs",
  "prune-runtime.mjs",
  "prune-runtime-paths.mjs",
];

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function computeFingerprint(runtimeDir) {
  const hash = createHash("sha256");

  for (const relativePath of cacheInputs) {
    const absolutePath = path.join(runtimeDir, relativePath);
    hash.update(relativePath);
    hash.update("\0");

    if (await exists(absolutePath)) {
      hash.update(await readFile(absolutePath));
    } else {
      hash.update("<missing>");
    }

    hash.update("\0");
  }

  return hash.digest("hex");
}
