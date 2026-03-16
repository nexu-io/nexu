import { access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneTargets } from "./prune-runtime-paths.mjs";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes("--dry-run");

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

if (pruneTargets.length === 0) {
  console.log("No prune targets configured.");
  process.exit(0);
}

let removedCount = 0;

for (const relativePath of pruneTargets) {
  const absolutePath = path.resolve(runtimeDir, relativePath);
  const relativeDisplayPath = path.relative(runtimeDir, absolutePath) || ".";

  if (!absolutePath.startsWith(runtimeDir)) {
    throw new Error(
      `Refusing to prune outside runtime directory: ${relativePath}`,
    );
  }

  if (!(await exists(absolutePath))) {
    console.log(`Skip missing ${relativeDisplayPath}`);
    continue;
  }

  if (isDryRun) {
    console.log(`Would remove ${relativeDisplayPath}`);
    removedCount += 1;
    continue;
  }

  await rm(absolutePath, { recursive: true, force: true });
  console.log(`Removed ${relativeDisplayPath}`);
  removedCount += 1;
}

if (removedCount === 0) {
  console.log("No configured prune targets were present.");
  process.exit(0);
}

console.log(
  `${isDryRun ? "Would prune" : "Pruned"} ${removedCount} path${removedCount === 1 ? "" : "s"}.`,
);
