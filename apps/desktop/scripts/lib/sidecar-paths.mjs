import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
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

export async function linkOrCopyDirectory(
  sourcePath,
  targetPath,
  options = {},
) {
  const excludeNames = new Set(options.excludeNames ?? []);

  if (shouldCopyRuntimeDependencies()) {
    await cp(sourcePath, targetPath, {
      recursive: true,
      dereference: true,
      filter: (source) => {
        const name = basename(source);
        return name !== ".bin" && !excludeNames.has(name);
      },
    });
    return;
  }

  if (excludeNames.size === 0) {
    await symlink(
      sourcePath,
      targetPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    return;
  }

  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourcePath);

  for (const entry of entries) {
    if (entry === ".bin" || excludeNames.has(entry)) {
      continue;
    }

    const sourceEntryPath = resolve(sourcePath, entry);
    const sourceEntryStats = await lstat(sourceEntryPath);

    await symlink(
      sourceEntryPath,
      resolve(targetPath, entry),
      process.platform === "win32"
        ? sourceEntryStats.isDirectory()
          ? "junction"
          : "file"
        : undefined,
    );
  }
}

export async function removePathIfExists(path) {
  await rm(path, { recursive: true, force: true });
}

function getPackagePathParts(packageName) {
  return packageName.startsWith("@") ? packageName.split("/") : [packageName];
}

function getRootPackageName(packageName) {
  const packagePathParts = getPackagePathParts(packageName);
  return packagePathParts.length === 1
    ? packagePathParts[0]
    : `${packagePathParts[0]}/${packagePathParts[1]}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function resolveInstalledPackageRoot(packageRoot, packageName) {
  const requireFromPackage = createRequire(
    resolve(packageRoot, "package.json"),
  );
  let resolvedEntryPath;
  try {
    resolvedEntryPath = requireFromPackage.resolve(packageName);
  } catch {
    resolvedEntryPath = requireFromPackage.resolve(
      `${packageName}/package.json`,
    );
  }
  const rootPackageName = getRootPackageName(packageName);

  let currentPath = dirname(resolvedEntryPath);
  while (currentPath !== dirname(currentPath)) {
    const packageJsonPath = resolve(currentPath, "package.json");
    if (await pathExists(packageJsonPath)) {
      const packageJson = await readJson(packageJsonPath);
      if (packageJson.name === rootPackageName) {
        return realpath(currentPath);
      }
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
  const seen = new Set();

  async function copyDependencyTree({
    dependencyName,
    resolutionBaseRoot,
    destinationNodeModules,
  }) {
    const packagePathParts = getPackagePathParts(dependencyName);
    let sourcePackageRoot;
    try {
      sourcePackageRoot = await resolveInstalledPackageRoot(
        resolutionBaseRoot,
        dependencyName,
      );
    } catch {
      return;
    }

    const targetPackageRoot = resolve(
      destinationNodeModules,
      ...packagePathParts,
    );
    const seenKey = `${sourcePackageRoot}:${targetPackageRoot}`;
    if (seen.has(seenKey)) {
      return;
    }
    seen.add(seenKey);

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
      return;
    }

    const packageJson = await readJson(packageJsonPath);
    const childDependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
    ];

    for (const childDependencyName of childDependencyNames) {
      await copyDependencyTree({
        dependencyName: childDependencyName,
        resolutionBaseRoot: sourcePackageRoot,
        destinationNodeModules: resolve(targetPackageRoot, "node_modules"),
      });
    }
  }

  const rootDependencyNames = [
    ...(dependencyNames ?? Object.keys(rootPackageJson.dependencies ?? {})),
    ...Object.keys(rootPackageJson.optionalDependencies ?? {}),
  ];

  for (const dependencyName of rootDependencyNames) {
    await copyDependencyTree({
      dependencyName,
      resolutionBaseRoot: packageRoot,
      destinationNodeModules: targetNodeModules,
    });
  }
}
