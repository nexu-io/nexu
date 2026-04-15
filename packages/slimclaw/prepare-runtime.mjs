import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installRuntimeAt } from "./install-runtime.mjs";
import { computeFingerprint } from "./postinstall-cache.mjs";
import { pruneRuntimeAt } from "./prune-runtime.mjs";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(packageRoot, ".dist-runtime", "openclaw");
const nodeModulesDir = path.join(runtimeDir, "node_modules");
const cacheFilePath = path.join(runtimeDir, ".postinstall-cache.json");
const criticalRuntimeFiles = [
  path.join("node_modules", "openclaw", "dist"),
  path.join("node_modules", "@whiskeysockets", "baileys", "lib", "index.js"),
  path.join(
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "WAProto",
    "index.js",
  ),
  path.join("node_modules", "@whiskeysockets", "baileys", "package.json"),
];

async function readCachedFingerprint() {
  if (!(await exists(cacheFilePath))) {
    return null;
  }

  try {
    const content = await readFile(cacheFilePath, "utf8");
    const parsed = JSON.parse(content);
    return typeof parsed.fingerprint === "string" ? parsed.fingerprint : null;
  } catch {
    return null;
  }
}

async function hasCompleteRuntimeInstall() {
  for (const relativePath of criticalRuntimeFiles) {
    if (!(await exists(path.join(runtimeDir, relativePath)))) {
      return false;
    }
  }

  return true;
}

export async function prepareSlimclawOwnedRuntimeInstall() {
  const fingerprint = await computeFingerprint(runtimeDir);
  const cachedFingerprint = await readCachedFingerprint();
  const hasNodeModules = await exists(nodeModulesDir);
  const hasCompleteRuntime = hasNodeModules
    ? await hasCompleteRuntimeInstall()
    : false;

  if (
    hasNodeModules &&
    hasCompleteRuntime &&
    cachedFingerprint === fingerprint
  ) {
    console.log("slimclaw runtime unchanged, skipping install:pruned.");
    return;
  }

  if (!hasNodeModules) {
    console.log(
      "slimclaw runtime node_modules missing, running install:pruned.",
    );
  } else if (!hasCompleteRuntime) {
    console.log(
      "slimclaw runtime critical files missing, running install:pruned.",
    );
  } else if (cachedFingerprint === null) {
    console.log("slimclaw runtime cache missing, running install:pruned.");
  } else {
    console.log("slimclaw runtime inputs changed, running install:pruned.");
  }

  await installRuntimeAt(runtimeDir, "pruned");
  await pruneRuntimeAt(runtimeDir);

  await writeFile(
    cacheFilePath,
    `${JSON.stringify(
      {
        fingerprint,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log("slimclaw runtime cache updated.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await prepareSlimclawOwnedRuntimeInstall();
  } catch (error) {
    console.error("slimclaw-owned runtime prepare failed.");
    throw error;
  }
}
