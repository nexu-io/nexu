import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const slimclawDistEntry = path.join(
  repoRoot,
  "packages",
  "slimclaw",
  "dist",
  "index.js",
);

let resolveSlimclawRuntimePaths;

try {
  ({ resolveSlimclawRuntimePaths } = await import(
    pathToFileURL(slimclawDistEntry).href
  ));
} catch (error) {
  const details = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Slimclaw runtime resolver is unavailable at ${slimclawDistEntry}. Run pnpm slimclaw:prepare first. ${details}`,
  );
}

const { entryPath } = resolveSlimclawRuntimePaths({
  workspaceRoot: repoRoot,
  requirePrepared: false,
});

try {
  await access(entryPath);
} catch {
  throw new Error(
    `Slimclaw runtime entry is unavailable at ${entryPath}. Run pnpm slimclaw:prepare first.`,
  );
}

process.stdout.write(`${entryPath}\n`);
