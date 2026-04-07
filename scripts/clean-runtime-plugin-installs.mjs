import { lstat, readdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

const repoRoot = process.cwd();
const runtimePluginsRoot = resolve(
  repoRoot,
  "apps/controller/static/runtime-plugins",
);

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function listPluginRoots() {
  if (!(await pathExists(runtimePluginsRoot))) {
    return [];
  }

  const entries = await readdir(runtimePluginsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(runtimePluginsRoot, entry.name));
}

async function removeIfPresent(path) {
  if (!(await pathExists(path))) {
    return false;
  }

  await rm(path, { recursive: true, force: true });
  return true;
}

async function main() {
  const pluginRoots = await listPluginRoots();

  for (const pluginRoot of pluginRoots) {
    const pluginName = basename(pluginRoot);
    const nestedRepoPackageRoot = resolve(pluginRoot, "node_modules", "nexu");
    const removedNestedRepoPackage = await removeIfPresent(
      nestedRepoPackageRoot,
    );

    if (removedNestedRepoPackage) {
      console.log(
        `[runtime-plugin-cleanup] removed unexpected nested package from ${pluginName}: ${nestedRepoPackageRoot}`,
      );
    }
  }
}

await main();
