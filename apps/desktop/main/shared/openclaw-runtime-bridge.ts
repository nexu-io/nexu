import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OpenClawInstallLayout = {
  runtimePackageRoot: string;
  runtimeNodeModulesPath: string;
  runtimeEntryPath: string;
  runtimeBinPath: string;
  runtimeGatewayBinPath: string;
  runtimePackageJsonPath: string;
  runtimeLockfilePath: string;
  runtimePostinstallCachePath: string;
  criticalRuntimePaths: string[];
};

export type OpenClawLaunchLayout = {
  openclawPath: string;
  openclawCwd: string;
  openclawBinPath: string;
  openclawExtensionsDir: string;
};

type LaunchLayoutBridgeModule = {
  resolvePackagedOpenClawLaunchLayout: (
    sidecarRoot: string,
  ) => OpenClawLaunchLayout;
  resolveRepoLocalOpenClawLaunchLayout: (
    repoRoot: string,
  ) => OpenClawLaunchLayout;
};

type InstallLayoutBridgeModule = {
  resolveRepoLocalOpenClawInstallLayout: (
    workspaceRoot?: string,
  ) => OpenClawInstallLayout;
};

type SidecarArchiveBridgeModule = {
  resolvePackagedOpenclawExtractedSidecarRoot: (runtimeRoot: string) => string;
};

type SidecarLayoutBridgeModule = {
  resolvePackagedOpenclawSidecarRoot: (
    runtimeSidecarBaseRoot: string,
    runtimeRoot: string,
  ) => string;
};

const require = createRequire(import.meta.url);
const bridgeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../openclaw-runtime/api",
);
const launchLayoutBridge = require(
  path.join(bridgeRoot, "launch-layout.cjs"),
) as LaunchLayoutBridgeModule;
const installLayoutBridge = require(
  path.join(bridgeRoot, "install-layout.cjs"),
) as InstallLayoutBridgeModule;
export const resolvePackagedOpenclawExtractedSidecarRoot = ((
  runtimeRoot: string,
): string => {
  const extractedRoot = path.resolve(runtimeRoot, "openclaw-sidecar");
  mkdirSync(extractedRoot, { recursive: true });
  return extractedRoot;
}) satisfies SidecarArchiveBridgeModule["resolvePackagedOpenclawExtractedSidecarRoot"];
export const resolvePackagedOpenClawLaunchLayout =
  launchLayoutBridge.resolvePackagedOpenClawLaunchLayout;
export const resolveRepoLocalOpenClawInstallLayout =
  installLayoutBridge.resolveRepoLocalOpenClawInstallLayout;
export const resolveRepoLocalOpenClawLaunchLayout =
  launchLayoutBridge.resolveRepoLocalOpenClawLaunchLayout;

export const resolvePackagedOpenclawSidecarRoot = ((
  runtimeSidecarBaseRoot: string,
  runtimeRoot: string,
): string => {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archivePath = resolvePackagedOpenclawArchivePath(packagedSidecarRoot);

  if (!archivePath) {
    return packagedSidecarRoot;
  }

  return resolvePackagedOpenclawExtractedSidecarRoot(runtimeRoot);
}) satisfies SidecarLayoutBridgeModule["resolvePackagedOpenclawSidecarRoot"];

export function resolvePackagedOpenclawArchivePath(
  packagedSidecarRoot: string,
): string | undefined {
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");
  const archivePath = existsSync(archiveMetadataPath)
    ? path.resolve(
        packagedSidecarRoot,
        JSON.parse(readFileSync(archiveMetadataPath, "utf8")).path,
      )
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");

  return existsSync(archivePath) ? archivePath : undefined;
}

export function isPackagedOpenclawExtractionNeeded(input: {
  extractedSidecarRoot: string;
  archivePath: string;
  archiveEntryPath: string;
  stampFileName?: string;
}): boolean {
  const stampPath = path.resolve(
    input.extractedSidecarRoot,
    input.stampFileName ?? ".archive-stamp",
  );
  const extractedOpenclawEntry = path.resolve(
    input.extractedSidecarRoot,
    input.archiveEntryPath,
  );

  if (!existsSync(stampPath) || !existsSync(extractedOpenclawEntry)) {
    return true;
  }

  const archiveStat = statSync(input.archivePath);
  const archiveStamp = `${archiveStat.size}:${archiveStat.mtimeMs}`;

  return readFileSync(stampPath, "utf8") !== archiveStamp;
}
