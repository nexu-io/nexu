import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const electronRoot = resolve(scriptDir, "../..");
export const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");

const runtimeSidecarRoot =
  process.env.NEXU_DESKTOP_SIDECAR_OUT_DIR ??
  resolve(repoRoot, ".tmp/sidecars");

export function getSidecarRoot(name) {
  return resolve(runtimeSidecarRoot, name);
}

export async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function resetDir(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export function shouldCopyRuntimeDependencies() {
  const value = process.env.NEXU_DESKTOP_COPY_RUNTIME_DEPS;
  return value === "1" || value?.toLowerCase() === "true";
}

export async function linkOrCopyDirectory(sourcePath, targetPath) {
  if (shouldCopyRuntimeDependencies()) {
    await cp(sourcePath, targetPath, {
      recursive: true,
      dereference: true,
      filter: (source) => basename(source) !== ".bin",
    });
    return;
  }

  await symlink(
    sourcePath,
    targetPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

export async function removePathIfExists(path) {
  await rm(path, { recursive: true, force: true });
}

function getPackagePathParts(packageName) {
  return packageName.startsWith("@") ? packageName.split("/") : [packageName];
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function resolveInstalledPackageRoot(packageRoot, packageName) {
  const requireFromPackage = createRequire(
    resolve(packageRoot, "package.json"),
  );
  const resolvedEntryPath = requireFromPackage.resolve(packageName);

  let currentPath = dirname(resolvedEntryPath);
  while (currentPath !== dirname(currentPath)) {
    if (await pathExists(resolve(currentPath, "package.json"))) {
      return realpath(currentPath);
    }
    currentPath = dirname(currentPath);
  }

  throw new Error(
    `Unable to locate package root for ${packageName} from ${packageRoot}.`,
  );
}

export async function copyRuntimeDependencyClosure({
  packageRoot,
  targetNodeModules,
  dependencyNames,
}) {
  await mkdir(targetNodeModules, { recursive: true });

  const rootPackageJson = await readJson(resolve(packageRoot, "package.json"));
  const pending = [
    ...(dependencyNames ?? Object.keys(rootPackageJson.dependencies ?? {})).map(
      (packageName) => ({ packageName, resolutionBaseRoot: packageRoot }),
    ),
    ...Object.keys(rootPackageJson.optionalDependencies ?? {}).map(
      (packageName) => ({ packageName, resolutionBaseRoot: packageRoot }),
    ),
  ];
  const seen = new Set();

  while (pending.length > 0) {
    const nextPackage = pending.pop();
    const packageName = nextPackage?.packageName;
    const resolutionBaseRoot = nextPackage?.resolutionBaseRoot;

    if (!packageName || !resolutionBaseRoot || seen.has(packageName)) {
      continue;
    }

    seen.add(packageName);

    const packagePathParts = getPackagePathParts(packageName);
    let sourcePackageRoot;
    try {
      sourcePackageRoot = await resolveInstalledPackageRoot(
        resolutionBaseRoot,
        packageName,
      );
    } catch {
      continue;
    }

    const targetPackageRoot = resolve(targetNodeModules, ...packagePathParts);
    await mkdir(dirname(targetPackageRoot), { recursive: true });
    await rm(targetPackageRoot, { recursive: true, force: true });
    await cp(sourcePackageRoot, targetPackageRoot, {
      recursive: true,
      dereference: true,
      filter: (source) => {
        if (basename(source) === ".bin") {
          return false;
        }

        const relativePath = relative(sourcePackageRoot, source);
        return (
          relativePath === "" ||
          (!relativePath.startsWith("node_modules/") &&
            relativePath !== "node_modules")
        );
      },
    });

    const packageJsonPath = resolve(sourcePackageRoot, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      continue;
    }

    const packageJson = await readJson(packageJsonPath);
    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      pending.push({
        packageName: dependencyName,
        resolutionBaseRoot: sourcePackageRoot,
      });
    }
    for (const dependencyName of Object.keys(
      packageJson.optionalDependencies ?? {},
    )) {
      pending.push({
        packageName: dependencyName,
        resolutionBaseRoot: sourcePackageRoot,
      });
    }
  }
}
