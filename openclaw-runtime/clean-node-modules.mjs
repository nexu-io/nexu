import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists } from "./utils.mjs";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const nodeModulesDir = path.join(runtimeDir, "node_modules");
const isDryRun = process.argv.includes("--dry-run");

if (!(await exists(nodeModulesDir))) {
  console.log("node_modules does not exist, nothing to clean.");
  process.exit(0);
}

if (isDryRun) {
  console.log(`Would remove ${nodeModulesDir}`);
  process.exit(0);
}

await rm(nodeModulesDir, { recursive: true, force: true });
console.log(`Removed ${nodeModulesDir}`);
