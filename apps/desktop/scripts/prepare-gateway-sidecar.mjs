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
const gatewayRoot = resolve(nexuRoot, "apps/gateway");
const gatewayDistRoot = resolve(gatewayRoot, "dist");
const sharedRoot = resolve(nexuRoot, "packages/shared");
const sharedDistRoot = resolve(sharedRoot, "dist");
const sidecarRoot = resolve(repoRoot, ".tmp/sidecars/gateway");
const sidecarDistRoot = resolve(sidecarRoot, "dist");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const gatewayNodeModules = resolve(gatewayRoot, "node_modules");
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

  if (!(await pathExists(gatewayDistRoot))) {
    missing.push("apps/gateway/dist");
  }

  if (!(await pathExists(sharedDistRoot))) {
    missing.push("packages/shared/dist");
  }

  if (!(await pathExists(gatewayNodeModules))) {
    missing.push("apps/gateway/node_modules");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing gateway sidecar prerequisites: ${missing.join(", ")}. Build/install nexu first.`,
    );
  }
}

async function prepareGatewaySidecar() {
  await ensureBuildArtifacts();
  await rm(sidecarRoot, { recursive: true, force: true });
  await mkdir(sidecarRoot, { recursive: true });

  // Like the API sidecar, this stages compiled output only. Any runtime secrets or .env-backed
  // settings must be provided explicitly by the desktop runtime manifest.
  await cp(gatewayDistRoot, sidecarDistRoot, { recursive: true });

  const gatewayPackageJson = JSON.parse(
    await readFile(resolve(gatewayRoot, "package.json"), "utf8"),
  );
  const sidecarPackageJson = {
    name: `${gatewayPackageJson.name}-sidecar`,
    private: true,
    type: gatewayPackageJson.type,
  };

  await writeFile(
    sidecarPackageJsonPath,
    `${JSON.stringify(sidecarPackageJson, null, 2)}\n`,
  );
  await symlink(
    gatewayNodeModules,
    sidecarNodeModules,
    process.platform === "win32" ? "junction" : "dir",
  );
}

await prepareGatewaySidecar();
