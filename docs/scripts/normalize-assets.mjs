import { normalizeAssets } from "./asset-normalizer.mjs";

const dryRun = process.argv.includes("--dry-run");

normalizeAssets({ dryRun }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
