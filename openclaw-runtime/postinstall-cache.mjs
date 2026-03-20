import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { exists } from "./utils.mjs";

export const cacheInputs = [
  "package.json",
  "package-lock.json",
  "clean-node-modules.mjs",
  "postinstall.mjs",
  "postinstall-cache.mjs",
  "prune-runtime.mjs",
  "prune-runtime-paths.mjs",
  "utils.mjs",
];

export async function computeFingerprint(runtimeDir) {
  const hash = createHash("sha256");
  hash.update(process.version);
  hash.update("\0");

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
