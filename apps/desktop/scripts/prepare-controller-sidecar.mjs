import { cp, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  copyDirectoryTree,
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
const controllerStaticRoot = resolve(controllerRoot, "static");
const sidecarRoot = getSidecarRoot("controller");
const sidecarDistRoot = resolve(sidecarRoot, "dist");
const sidecarStaticRoot = resolve(sidecarRoot, "static");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const controllerNodeModules = resolve(controllerRoot, "node_modules");
const sidecarPackageJsonPath = resolve(sidecarRoot, "package.json");

async function runTimedStep(label, action) {
  const startedAt = Date.now();
  console.log(`[controller-sidecar] step:start ${label}`);
  try {
    const result = await action();
    console.log(
      `[controller-sidecar] step:done ${label} durationMs=${Date.now() - startedAt}`,
    );
    return result;
  } catch (error) {
    console.log(
      `[controller-sidecar] step:fail ${label} durationMs=${Date.now() - startedAt}`,
    );
    throw error;
  }
}

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
  await runTimedStep("prepare_controller_sidecar", async () => {
    await ensureBuildArtifacts();
    await resetDir(sidecarRoot);

    await cp(controllerDistRoot, sidecarDistRoot, { recursive: true });

    if (await pathExists(controllerStaticRoot)) {
      await copyDirectoryTree(controllerStaticRoot, sidecarStaticRoot, {
        filter: ({ sourcePath }) => basename(sourcePath) !== ".bin",
      });
    }

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
  });
}

await prepareControllerSidecar();
