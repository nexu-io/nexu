import { cp, lstat, mkdir, rm, symlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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
