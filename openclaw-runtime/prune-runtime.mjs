import path from "node:path";
import { fileURLToPath } from "node:url";
import runtimeMaintenance from "./runtime-maintenance.cjs";
import runtimePolicy from "./runtime-policy.cjs";

const { pruneOpenClawRuntimePaths } = runtimeMaintenance;
const { pruneTargets } = runtimePolicy;

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes("--dry-run");

await pruneOpenClawRuntimePaths({
  runtimeDir,
  pruneTargets,
  dryRun: isDryRun,
  logger: console,
});
