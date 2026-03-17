import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  copyRuntimeDependencyClosure,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  repoRoot,
  resetDir,
  shouldCopyRuntimeDependencies,
} from "./lib/sidecar-paths.mjs";

const nexuRoot = repoRoot;
const apiRoot = resolve(nexuRoot, "apps/api");
const apiDistRoot = resolve(apiRoot, "dist");
const sharedRoot = resolve(nexuRoot, "packages/shared");
const sharedDistRoot = resolve(sharedRoot, "dist");
const sidecarRoot = getSidecarRoot("api");
const sidecarDistRoot = resolve(sidecarRoot, "dist");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const apiNodeModules = resolve(apiRoot, "node_modules");
const sidecarPackageJsonPath = resolve(sidecarRoot, "package.json");

async function ensureBuildArtifacts() {
  const missing = [];

  if (!(await pathExists(apiDistRoot))) {
    missing.push("apps/api/dist");
  }

  if (!(await pathExists(sharedDistRoot))) {
    missing.push("packages/shared/dist");
  }

  if (!(await pathExists(apiNodeModules))) {
    missing.push("apps/api/node_modules");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing API sidecar prerequisites: ${missing.join(", ")}. Build/install nexu first.`,
    );
  }
}

async function prepareApiSidecar() {
  await ensureBuildArtifacts();
  await resetDir(sidecarRoot);

  // Only the built server artifact is staged here. Runtime .env files are not copied into the
  // sidecar automatically, so desktop-specific env injection needs to happen from the manifest.
  await cp(apiDistRoot, sidecarDistRoot, { recursive: true });

  const apiPackageJson = JSON.parse(
    await readFile(resolve(apiRoot, "package.json"), "utf8"),
  );
  const sidecarPackageJson = {
    name: `${apiPackageJson.name}-sidecar`,
    private: true,
    type: apiPackageJson.type,
  };

  await writeFile(
    sidecarPackageJsonPath,
    `${JSON.stringify(sidecarPackageJson, null, 2)}\n`,
  );

  if (shouldCopyRuntimeDependencies()) {
    await copyRuntimeDependencyClosure({
      packageRoot: apiRoot,
      targetNodeModules: sidecarNodeModules,
    });
    return;
  }

  await linkOrCopyDirectory(apiNodeModules, sidecarNodeModules);
}

await prepareApiSidecar();
