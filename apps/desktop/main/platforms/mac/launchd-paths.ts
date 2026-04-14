import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  resolveSlimclawRuntimeArtifacts,
  resolveSlimclawRuntimePaths,
} from "@nexu/slimclaw";
import { getWorkspaceRoot } from "../../../shared/workspace-paths";
import { ensurePackagedOpenclawSidecar } from "../../runtime/manifests";

const execFileAsync = promisify(execFile);

function assertSafeRmTarget(targetPath: string): void {
  const segments = targetPath.split(path.sep).filter(Boolean);
  if (segments.length < 3) {
    throw new Error(
      `Refusing rm -rf on shallow path: ${targetPath} (need >=3 segments)`,
    );
  }
}

function readBundleExecutableName(appContentsPath: string): string {
  const fallback = "Nexu";
  try {
    const plistPath = path.join(appContentsPath, "Info.plist");
    const raw = readFileSync(plistPath, "utf8");
    const match = raw.match(
      /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/,
    );
    return match?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

function readBundleInfoValue(
  appContentsPath: string,
  key: string,
): string | null {
  try {
    const plistPath = path.join(appContentsPath, "Info.plist");
    const raw = readFileSync(plistPath, "utf8");
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(
      new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`),
    );
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function buildRuntimeExtractionStamp(
  appContentsPath: string,
  appVersion: string,
): string {
  const bundleVersion = readBundleInfoValue(appContentsPath, "CFBundleVersion");
  return JSON.stringify({
    appVersion,
    bundleVersion,
    // Forces a re-clone on x64 ↔ arm64 reinstalls of the same version,
    // otherwise cached native bindings mismatch the running Electron.
    arch: process.arch,
  });
}

export async function ensureExternalNodeRunner(
  appContentsPath: string,
  nexuHome: string,
  appVersion: string,
): Promise<string> {
  const binaryName = readBundleExecutableName(appContentsPath);
  const extractionStamp = buildRuntimeExtractionStamp(
    appContentsPath,
    appVersion,
  );
  const runnerRoot = path.join(nexuHome, "runtime", "nexu-runner.app");
  const stagingRoot = `${runnerRoot}.staging`;
  const binaryPath = path.join(runnerRoot, "Contents", "MacOS", binaryName);
  const stampPath = path.join(nexuHome, "runtime", ".nexu-runner-version");

  assertSafeRmTarget(runnerRoot);
  assertSafeRmTarget(stagingRoot);

  if (existsSync(stagingRoot)) {
    assertSafeRmTarget(stagingRoot);
    await execFileAsync("rm", ["-rf", stagingRoot]).catch(() => {});
  }

  try {
    if (
      existsSync(stampPath) &&
      existsSync(binaryPath) &&
      readFileSync(stampPath, "utf8").trim() === extractionStamp
    ) {
      return binaryPath;
    }
  } catch {
    // stamp unreadable - re-extract
  }

  console.log(
    `Extracting external node runner for runtime ${extractionStamp} to ${runnerRoot}`,
  );

  const appBundlePath = path.dirname(appContentsPath);
  const stagingBinaryPath = path.join(
    stagingRoot,
    "Contents",
    "MacOS",
    binaryName,
  );

  await fs.mkdir(path.dirname(stagingRoot), { recursive: true });

  try {
    await execFileAsync("cp", ["-Rc", appBundlePath, stagingRoot]);
  } catch {
    console.warn(
      "APFS clone not available for runner bundle, falling back to regular copy",
    );
    await execFileAsync("cp", ["-R", appBundlePath, stagingRoot]);
  }

  if (!existsSync(stagingBinaryPath)) {
    throw new Error(
      `Runner extraction failed: ${stagingBinaryPath} not found after clone`,
    );
  }

  await execFileAsync("rm", ["-rf", runnerRoot]).catch(() => {});
  await fs.rename(stagingRoot, runnerRoot);
  writeFileSync(stampPath, extractionStamp, "utf8");

  console.log(`External node runner ready at ${binaryPath}`);
  return binaryPath;
}

async function ensureExternalControllerSidecar(
  appContentsPath: string,
  nexuHome: string,
  appVersion: string,
): Promise<{ controllerRoot: string; entryPath: string }> {
  const extractionStamp = buildRuntimeExtractionStamp(
    appContentsPath,
    appVersion,
  );
  const controllerRoot = path.join(nexuHome, "runtime", "controller-sidecar");
  const stagingRoot = `${controllerRoot}.staging`;
  const entryPath = path.join(controllerRoot, "dist", "index.js");
  const stampPath = path.join(controllerRoot, ".version-stamp");

  if (existsSync(stagingRoot)) {
    assertSafeRmTarget(stagingRoot);
    await execFileAsync("rm", ["-rf", stagingRoot]).catch(() => {});
  }

  try {
    if (
      existsSync(stampPath) &&
      existsSync(entryPath) &&
      readFileSync(stampPath, "utf8").trim() === extractionStamp
    ) {
      return { controllerRoot, entryPath };
    }
  } catch {
    // stamp unreadable - re-extract
  }

  console.log(
    `Extracting controller sidecar for runtime ${extractionStamp} to ${controllerRoot}`,
  );

  const srcControllerDir = path.join(
    appContentsPath,
    "Resources",
    "runtime",
    "controller",
  );

  await fs.mkdir(path.dirname(stagingRoot), { recursive: true });

  try {
    await execFileAsync("cp", ["-Rc", srcControllerDir, stagingRoot]);
  } catch {
    console.warn(
      "APFS clone not available for controller sidecar (~28MB), falling back to regular copy",
    );
    await execFileAsync("cp", ["-R", srcControllerDir, stagingRoot]);
  }

  const stagingEntryPath = path.join(stagingRoot, "dist", "index.js");
  if (!existsSync(stagingEntryPath)) {
    throw new Error(
      `Controller sidecar extraction failed: ${stagingEntryPath} not found after clone`,
    );
  }

  writeFileSync(
    path.join(stagingRoot, ".version-stamp"),
    extractionStamp,
    "utf8",
  );
  assertSafeRmTarget(controllerRoot);
  await execFileAsync("rm", ["-rf", controllerRoot]).catch(() => {});
  await fs.rename(stagingRoot, controllerRoot);

  return { controllerRoot, entryPath };
}

export async function resolveLaunchdPaths(
  isPackaged: boolean,
  resourcesPath: string,
  appVersion?: string,
): Promise<{
  nodePath: string;
  controllerEntryPath: string;
  openclawPath: string;
  controllerCwd: string;
  openclawCwd: string;
  openclawBinPath: string;
  openclawExtensionsDir: string;
}> {
  if (isPackaged) {
    const runtimeDir = path.join(resourcesPath, "runtime");
    const nexuHome = path.join(os.homedir(), ".nexu");
    const version = appVersion ?? "unknown";
    const appContentsPath = path.dirname(resourcesPath);
    let nodePath = process.execPath;
    let controllerEntryPath = path.join(
      runtimeDir,
      "controller",
      "dist",
      "index.js",
    );
    let controllerRoot = path.join(runtimeDir, "controller");

    try {
      nodePath = await ensureExternalNodeRunner(
        appContentsPath,
        nexuHome,
        version,
      );
      const result = await ensureExternalControllerSidecar(
        appContentsPath,
        nexuHome,
        version,
      );
      controllerEntryPath = result.entryPath;
      controllerRoot = result.controllerRoot;
    } catch (err) {
      console.error(
        "Failed to extract external runner/sidecar, falling back to in-bundle paths.",
        err instanceof Error ? err.message : String(err),
      );
    }

    const openclawSidecarRoot = ensurePackagedOpenclawSidecar(
      runtimeDir,
      nexuHome,
    );
    const openclawArtifacts = resolveSlimclawRuntimeArtifacts(
      openclawSidecarRoot,
      { requirePrepared: false },
    );

    return {
      nodePath,
      controllerEntryPath,
      openclawPath: openclawArtifacts.entryPath,
      controllerCwd: controllerRoot,
      openclawCwd: openclawSidecarRoot,
      openclawBinPath: openclawArtifacts.binPath,
      openclawExtensionsDir: openclawArtifacts.builtinExtensionsDir,
    };
  }

  const repoRoot = getWorkspaceRoot();
  const slimclawRuntimePaths = resolveSlimclawRuntimePaths({
    workspaceRoot: repoRoot,
    requirePrepared: false,
  });
  return {
    nodePath: process.execPath,
    controllerEntryPath: path.join(
      repoRoot,
      "apps",
      "controller",
      "dist",
      "index.js",
    ),
    openclawPath: slimclawRuntimePaths.entryPath,
    controllerCwd: path.join(repoRoot, "apps", "controller"),
    openclawCwd: slimclawRuntimePaths.runtimeRoot,
    openclawBinPath: slimclawRuntimePaths.binPath,
    openclawExtensionsDir: slimclawRuntimePaths.builtinExtensionsDir,
  };
}
