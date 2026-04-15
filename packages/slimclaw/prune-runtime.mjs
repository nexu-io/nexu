import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pruneTargets } from "./prune-runtime-paths.mjs";
import { exists } from "./utils.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

function resolveDefaultRuntimeDir() {
  return path.resolve(packageRoot, ".dist-runtime", "openclaw");
}

export async function pruneRuntimeAt(runtimeDir, options = {}) {
  const isDryRun = options.dryRun === true;
  const startedAt = performance.now();

  if (pruneTargets.length === 0) {
    console.log("No prune targets configured.");
    return;
  }

  let removedCount = 0;

  // Keep pruneTargets free of overlapping parent/child paths. This parallel removal
  // is safe for the current list because each target is independent.
  const pruneResults = await Promise.all(
    pruneTargets.map(async (relativePath) => {
      const targetStartedAt = performance.now();
      const absolutePath = path.resolve(runtimeDir, relativePath);
      const relativeDisplayPath =
        path.relative(runtimeDir, absolutePath) || ".";

      if (!absolutePath.startsWith(runtimeDir)) {
        throw new Error(
          `Refusing to prune outside runtime directory: ${relativePath}`,
        );
      }

      if (!(await exists(absolutePath))) {
        return {
          action: "skip",
          relativeDisplayPath,
          durationMs: performance.now() - targetStartedAt,
        };
      }

      if (isDryRun) {
        return {
          action: "dry-run",
          relativeDisplayPath,
          durationMs: performance.now() - targetStartedAt,
        };
      }

      await rm(absolutePath, { recursive: true, force: true });
      return {
        action: "removed",
        relativeDisplayPath,
        durationMs: performance.now() - targetStartedAt,
      };
    }),
  );

  let skippedCount = 0;
  const slowestPresentTargets = [];

  for (const result of pruneResults) {
    if (result.action === "skip") {
      skippedCount += 1;
      console.log(`Skip missing ${result.relativeDisplayPath}`);
      continue;
    }

    if (result.action === "dry-run") {
      console.log(`Would remove ${result.relativeDisplayPath}`);
      removedCount += 1;
      slowestPresentTargets.push(result);
      continue;
    }

    console.log(`Removed ${result.relativeDisplayPath}`);
    removedCount += 1;
    slowestPresentTargets.push(result);
  }

  if (removedCount === 0) {
    console.log("No configured prune targets were present.");
    return;
  }

  console.log(
    `${isDryRun ? "Would prune" : "Pruned"} ${removedCount} path${removedCount === 1 ? "" : "s"}.`,
  );
  const totalDurationMs = performance.now() - startedAt;
  const slowestSummary = slowestPresentTargets
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5)
    .map(
      (entry) =>
        `${entry.relativeDisplayPath}:${formatDurationMs(entry.durationMs)}`,
    )
    .join(",");
  console.log(
    `[slimclaw:prune][timing] summary total=${formatDurationMs(totalDurationMs)} removed=${removedCount} skipped=${skippedCount}${slowestSummary ? ` slowest=[${slowestSummary}]` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await pruneRuntimeAt(resolveDefaultRuntimeDir(), {
    dryRun: process.argv.includes("--dry-run"),
  });
}
