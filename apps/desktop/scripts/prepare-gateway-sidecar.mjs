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
const gatewayRoot = resolve(nexuRoot, "apps/gateway");
const gatewayDistRoot = resolve(gatewayRoot, "dist");
const sharedRoot = resolve(nexuRoot, "packages/shared");
const sharedDistRoot = resolve(sharedRoot, "dist");
const sidecarRoot = getSidecarRoot("gateway");
const sidecarDistRoot = resolve(sidecarRoot, "dist");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const gatewayNodeModules = resolve(gatewayRoot, "node_modules");
const sidecarPackageJsonPath = resolve(sidecarRoot, "package.json");

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
  await resetDir(sidecarRoot);

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

  if (shouldCopyRuntimeDependencies()) {
    await copyRuntimeDependencyClosure({
      packageRoot: gatewayRoot,
      targetNodeModules: sidecarNodeModules,
    });
    return;
  }

  await linkOrCopyDirectory(gatewayNodeModules, sidecarNodeModules);
}

await prepareGatewaySidecar();
