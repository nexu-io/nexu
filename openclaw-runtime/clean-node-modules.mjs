import path from "node:path";
import { fileURLToPath } from "node:url";
import runtimeMaintenance from "./runtime-maintenance.cjs";

const { cleanRepoLocalOpenClawRuntimeNodeModules } = runtimeMaintenance;

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes("--dry-run");

await cleanRepoLocalOpenClawRuntimeNodeModules({
  runtimeDir,
  dryRun: isDryRun,
  logger: console,
});
