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
const controllerRoot = resolve(nexuRoot, "apps/controller");
const controllerDistRoot = resolve(controllerRoot, "dist");
const sharedRoot = resolve(nexuRoot, "packages/shared");
const sharedDistRoot = resolve(sharedRoot, "dist");
const sidecarRoot = getSidecarRoot("controller");
const sidecarDistRoot = resolve(sidecarRoot, "dist");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const controllerNodeModules = resolve(controllerRoot, "node_modules");
const sidecarPackageJsonPath = resolve(sidecarRoot, "package.json");

async function ensureBuildArtifacts() {
  const missing = [];

  if (!(await pathExists(controllerDistRoot))) {
    missing.push("apps/controller/dist");
  }

  if (!(await pathExists(sharedDistRoot))) {
    missing.push("packages/shared/dist");
  }

  if (!(await pathExists(controllerNodeModules))) {
    missing.push("apps/controller/node_modules");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing controller sidecar prerequisites: ${missing.join(", ")}. Build/install nexu first.`,
    );
  }
}

async function prepareControllerSidecar() {
  await ensureBuildArtifacts();
  await resetDir(sidecarRoot);

  await cp(controllerDistRoot, sidecarDistRoot, { recursive: true });

  const controllerPackageJson = JSON.parse(
    await readFile(resolve(controllerRoot, "package.json"), "utf8"),
  );
  const sidecarPackageJson = {
    name: `${controllerPackageJson.name}-sidecar`,
    private: true,
    type: controllerPackageJson.type,
  };

  await writeFile(
    sidecarPackageJsonPath,
    `${JSON.stringify(sidecarPackageJson, null, 2)}\n`,
  );

  if (shouldCopyRuntimeDependencies()) {
    await copyRuntimeDependencyClosure({
      packageRoot: controllerRoot,
      targetNodeModules: sidecarNodeModules,
    });
    return;
  }

  await linkOrCopyDirectory(controllerNodeModules, sidecarNodeModules);
}

await prepareControllerSidecar();
