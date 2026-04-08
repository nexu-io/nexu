import { chmod, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourcePath = resolve(repoRoot, "scripts/pre-commit");
const hooksDir = resolve(repoRoot, ".git/hooks");
const targetPath = resolve(hooksDir, "pre-commit");

try {
  await copyFile(sourcePath, targetPath);
  await chmod(targetPath, 0o755);
} catch {
  // Skip silently when git metadata or source hook is unavailable.
}
