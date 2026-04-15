import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const runtimeSeedRoot = path.resolve(packageRoot, "runtime-seed");

export const cacheInputs = [
  path.join(runtimeSeedRoot, "package.json"),
  path.join(runtimeSeedRoot, "package-lock.json"),
  path.join(runtimeSeedRoot, "clean-node-modules.mjs"),
  path.join(packageRoot, "prepare-runtime.mjs"),
  path.join(packageRoot, "install-runtime.mjs"),
  path.join(packageRoot, "postinstall-cache.mjs"),
  path.join(packageRoot, "prune-runtime.mjs"),
  path.join(packageRoot, "prune-runtime-paths.mjs"),
  path.join(packageRoot, "utils.mjs"),
];

export const cacheEnvInputs = ["NEXU_OPENCLAW_PRUNE_DAVEY"];

export async function computeFingerprint(_runtimeDir) {
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
    hash.update(path.relative(repoRoot, relativePath));
    hash.update("\0");

    if (await exists(relativePath)) {
      hash.update(await readFile(relativePath));
    } else {
      hash.update("<missing>");
    }

    hash.update("\0");
  }

  return hash.digest("hex");
}
