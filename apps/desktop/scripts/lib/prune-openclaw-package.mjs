import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathExists, removePathIfExists } from "./sidecar-paths.mjs";

export async function pruneOpenclawPackage(nodeModulesRoot) {
  const packagedOpenclawRoot = resolve(nodeModulesRoot, "openclaw");
  const extensionsRoot = resolve(packagedOpenclawRoot, "extensions");

  await removePathIfExists(resolve(packagedOpenclawRoot, "docs"));

  if (!(await pathExists(extensionsRoot))) {
    return;
  }

  const extensions = await readdir(extensionsRoot, { withFileTypes: true });

  for (const extension of extensions) {
    if (!extension.isDirectory()) {
      continue;
    }

    await removePathIfExists(resolve(extensionsRoot, extension.name, "src"));
  }
}
