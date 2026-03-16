import {
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const nexuRoot = repoRoot;
const apiRoot = resolve(nexuRoot, "apps/api");
const apiDistRoot = resolve(apiRoot, "dist");
const sharedRoot = resolve(nexuRoot, "packages/shared");
const sharedDistRoot = resolve(sharedRoot, "dist");
const sidecarRoot = resolve(repoRoot, ".tmp/sidecars/api");
const sidecarDistRoot = resolve(sidecarRoot, "dist");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const apiNodeModules = resolve(apiRoot, "node_modules");
const sidecarPackageJsonPath = resolve(sidecarRoot, "package.json");

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

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
  await rm(sidecarRoot, { recursive: true, force: true });
  await mkdir(sidecarRoot, { recursive: true });

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
  await symlink(
    apiNodeModules,
    sidecarNodeModules,
    process.platform === "win32" ? "junction" : "dir",
  );
}

await prepareApiSidecar();
