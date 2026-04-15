import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneTargets } from "./prune-runtime-paths.mjs";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

function resolveDefaultRuntimeDir() {
  return path.resolve(packageRoot, ".dist-runtime", "openclaw");
}

export async function pruneRuntimeAt(runtimeDir, options = {}) {
  const isDryRun = options.dryRun === true;

  if (pruneTargets.length === 0) {
    console.log("No prune targets configured.");
    return;
  }

  let removedCount = 0;

  // Keep pruneTargets free of overlapping parent/child paths. This parallel removal
  // is safe for the current list because each target is independent.
  const pruneResults = await Promise.all(
    pruneTargets.map(async (relativePath) => {
      const absolutePath = path.resolve(runtimeDir, relativePath);
      const relativeDisplayPath =
        path.relative(runtimeDir, absolutePath) || ".";

      if (!absolutePath.startsWith(runtimeDir)) {
        throw new Error(
          `Refusing to prune outside runtime directory: ${relativePath}`,
        );
      }

      if (!(await exists(absolutePath))) {
        return { action: "skip", relativeDisplayPath };
      }

      if (isDryRun) {
        return { action: "dry-run", relativeDisplayPath };
      }

      await rm(absolutePath, { recursive: true, force: true });
      return { action: "removed", relativeDisplayPath };
    }),
  );

  for (const result of pruneResults) {
    if (result.action === "skip") {
      console.log(`Skip missing ${result.relativeDisplayPath}`);
      continue;
    }

    if (result.action === "dry-run") {
      console.log(`Would remove ${result.relativeDisplayPath}`);
      removedCount += 1;
      continue;
    }

    console.log(`Removed ${result.relativeDisplayPath}`);
    removedCount += 1;
  }

  if (removedCount === 0) {
    console.log("No configured prune targets were present.");
    return;
  }

  console.log(
    `${isDryRun ? "Would prune" : "Pruned"} ${removedCount} path${removedCount === 1 ? "" : "s"}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await pruneRuntimeAt(resolveDefaultRuntimeDir(), {
    dryRun: process.argv.includes("--dry-run"),
  });
}
