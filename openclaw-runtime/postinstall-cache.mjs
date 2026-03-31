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

export const cacheEnvInputs = ["NEXU_OPENCLAW_PRUNE_DAVEY"];

export async function computeFingerprint(runtimeDir) {
  const hash = createHash("sha256");
  hash.update(process.platform);
  hash.update("\0");
  hash.update(process.arch);
  hash.update("\0");
  hash.update(process.version);
  hash.update("\0");

  for (const envName of cacheEnvInputs) {
    hash.update(envName);
    hash.update("\0");
    hash.update(process.env[envName] ?? "<unset>");
    hash.update("\0");
  }

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
