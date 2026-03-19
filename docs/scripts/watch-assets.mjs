import fs from "node:fs";
import path from "node:path";
import {
  assetsDir,
  isRelevantAssetPath,
  normalizeAssets,
} from "./asset-normalizer.mjs";

let isRunning = false;
let rerunRequested = false;
let pendingTimer = null;

async function runNormalization(triggerLabel) {
  if (isRunning) {
    rerunRequested = true;
    return;
  }

  isRunning = true;

  try {
    console.log(`[assets:watch] normalizing after ${triggerLabel}`);
    await normalizeAssets();
  } catch (error) {
    console.error("[assets:watch] normalization failed");
    console.error(error);
  } finally {
    isRunning = false;
  }

  if (rerunRequested) {
    rerunRequested = false;
    await runNormalization("queued changes");
  }
}

function scheduleNormalization(triggerLabel) {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
  }

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void runNormalization(triggerLabel);
  }, 250);
}

await runNormalization("startup");

console.log(`[assets:watch] watching ${assetsDir}`);

const watcher = fs.watch(
  assetsDir,
  { recursive: true },
  (_eventType, filename) => {
    if (typeof filename !== "string") {
      scheduleNormalization("asset change");
      return;
    }

    const filePath = path.join(assetsDir, filename);

    if (!isRelevantAssetPath(filePath)) {
      return;
    }

    scheduleNormalization(filename);
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    watcher.close();
    process.exit(0);
  });
}
