import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePnpmCommand } from "./platforms/filesystem-compat.mjs";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";
import { createPlatformCommandSpec } from "./platforms/process-compat.mjs";
import {
  createDesktopBuildContext,
  getSharedBuildSteps,
} from "./platforms/shared/build-capabilities.mjs";
import { createWindowsBuildCapabilities } from "./platforms/win/build-capabilities.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const desktopPackageJsonPath = resolve(electronRoot, "package.json");
const require = createRequire(import.meta.url);
const buildTargetPlatform = resolveBuildTargetPlatform({
  env: process.env,
  platform: process.platform,
});
const pnpmCommand = resolvePnpmCommand({
  env: process.env,
  platform: process.platform,
});
const diagnosticsEnabled =
  process.env.NEXU_DESKTOP_DIST_DIAGNOSTICS === "1" ||
  process.env.NEXU_DESKTOP_DIST_DIAGNOSTICS?.toLowerCase() === "true";
const defaultDiagnosticStepTimeoutMs = diagnosticsEnabled ? 10 * 60 * 1000 : 0;
const stopAfterStep = process.env.NEXU_DESKTOP_DIST_STOP_AFTER_STEP ?? null;
class StopAfterStepSignal extends Error {
  constructor(stepName) {
    super(`[dist:win] stopping after requested step ${stepName}`);
    this.name = "StopAfterStepSignal";
    this.stepName = stepName;
  }
}

const rmWithRetriesOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
};

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

function getStepTimeoutMs(stepName) {
  const timeoutEnvName = `NEXU_DESKTOP_DIST_TIMEOUT_${stepName
    .replace(/[^A-Z0-9]/giu, "_")
    .toUpperCase()}`;
  const timeoutMs = Number(process.env[timeoutEnvName]);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return diagnosticsEnabled ? defaultDiagnosticStepTimeoutMs : 0;
}

async function timedStep(stepName, fn, timings) {
  const startedAt = performance.now();
  const stepTimeoutMs = getStepTimeoutMs(stepName);
  console.log(
    `[dist:win][step] start ${stepName} pid=${process.pid} cwd=${process.cwd()} diagnostics=${diagnosticsEnabled ? "on" : "off"} timeoutMs=${stepTimeoutMs || 0}`,
  );
  let stepTimeoutHandle = null;
  try {
    const result = await (stepTimeoutMs > 0
      ? Promise.race([
          fn(),
          new Promise((_, reject) => {
            stepTimeoutHandle = setTimeout(() => {
              reject(
                new Error(
                  `[dist:win] step ${stepName} timed out after ${stepTimeoutMs}ms`,
                ),
              );
            }, stepTimeoutMs);
          }),
        ])
      : fn());
    if (stopAfterStep === stepName) {
      throw new StopAfterStepSignal(stepName);
    }
    return result;
  } finally {
    if (stepTimeoutHandle) {
      clearTimeout(stepTimeoutHandle);
    }
    const durationMs = performance.now() - startedAt;
    timings.push({ stepName, durationMs });
    console.log(
      `[dist:win][step] done ${stepName} pid=${process.pid} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

async function ensureExistingPath(path, label) {
  try {
    await lstat(path);
  } catch {
    throw new Error(`[dist:win] Missing ${label}: ${path}`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectDirectoryStats(rootPath) {
  let fileCount = 0;
  let totalBytes = 0;
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      const childStats = await collectDirectoryStats(entryPath);
      fileCount += childStats.fileCount;
      totalBytes += childStats.totalBytes;
      continue;
    }

    if (entry.isFile()) {
      const entryStats = await stat(entryPath);
      fileCount += 1;
      totalBytes += entryStats.size;
    }
  }

  return { fileCount, totalBytes };
}

async function collectReleaseArtifacts(rootPath, predicate) {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const artifacts = [];
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      artifacts.push(...(await collectReleaseArtifacts(entryPath, predicate)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!predicate(entryPath)) {
      continue;
    }

    const entryStats = await stat(entryPath);
    artifacts.push({
      path: entryPath,
      size: entryStats.size,
      mtimeMs: entryStats.mtimeMs,
    });
  }

  return artifacts;
}

function createWindowsBuilderPhaseObserver(options) {
  const startedAt = performance.now();
  const logPath = resolve(
    options.releaseRoot,
    ".cache",
    "dist-win",
    "electron-builder-phase.jsonl",
  );
  const state = {
    winUnpackedReady: null,
    finalWinUnpacked: null,
    firstNsis7z: null,
    finalNsis7z: null,
    installerExe: null,
  };
  let pollHandle = null;
  let writeChain = Promise.resolve();

  const toRelativePath = (targetPath) =>
    targetPath.replace(`${options.releaseRoot}\\`, "");

  const writeEvent = (event, fields = {}) => {
    const payload = {
      scope: "electron-builder-phase",
      event,
      ts: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - startedAt),
      targetPlatform: buildTargetPlatform,
      dirOnly: options.dirOnly,
      nsisFromExistingDir: options.nsisFromExistingDir,
      ...fields,
    };
    const line = `${JSON.stringify(payload)}\n`;
    console.log(`[dist:win][builder-phase] ${line.trim()}`);
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, line, "utf8");
    });
    return writeChain;
  };

  const observeOnce = async () => {
    const winUnpackedPath = resolve(options.releaseRoot, "win-unpacked");
    if (!state.winUnpackedReady && (await pathExists(winUnpackedPath))) {
      const winUnpackedStats = await collectDirectoryStats(
        winUnpackedPath,
      ).catch(() => null);
      if (winUnpackedStats && winUnpackedStats.fileCount > 0) {
        state.winUnpackedReady = {
          path: winUnpackedPath,
          fileCount: winUnpackedStats.fileCount,
          totalBytes: winUnpackedStats.totalBytes,
        };
        await writeEvent("win-unpacked-ready", {
          path: toRelativePath(winUnpackedPath),
          fileCount: winUnpackedStats.fileCount,
          totalBytes: winUnpackedStats.totalBytes,
        });
      }
    }

    const nsisArtifacts = await collectReleaseArtifacts(
      options.releaseRoot,
      (artifactPath) => artifactPath.endsWith(".nsis.7z"),
    );
    const latestNsisArtifact = nsisArtifacts.sort(
      (left, right) => right.mtimeMs - left.mtimeMs,
    )[0];
    if (latestNsisArtifact && !state.firstNsis7z) {
      state.firstNsis7z = latestNsisArtifact;
      await writeEvent("nsis-intermediate-first-seen", {
        path: toRelativePath(latestNsisArtifact.path),
        bytes: latestNsisArtifact.size,
        mtimeMs: Math.round(latestNsisArtifact.mtimeMs),
      });
    }
    if (
      latestNsisArtifact &&
      (!state.finalNsis7z ||
        state.finalNsis7z.path !== latestNsisArtifact.path ||
        state.finalNsis7z.size !== latestNsisArtifact.size ||
        Math.round(state.finalNsis7z.mtimeMs) !==
          Math.round(latestNsisArtifact.mtimeMs))
    ) {
      state.finalNsis7z = latestNsisArtifact;
      await writeEvent("nsis-intermediate-update", {
        path: toRelativePath(latestNsisArtifact.path),
        bytes: latestNsisArtifact.size,
        mtimeMs: Math.round(latestNsisArtifact.mtimeMs),
      });
    }

    const installerArtifacts = await collectReleaseArtifacts(
      options.releaseRoot,
      (artifactPath) => {
        const relativePath = toRelativePath(artifactPath);
        return (
          artifactPath.endsWith(".exe") &&
          !relativePath.includes("win-unpacked\\") &&
          !artifactPath.endsWith(".__uninstaller.exe")
        );
      },
    );
    const latestInstallerArtifact = installerArtifacts.sort(
      (left, right) => right.mtimeMs - left.mtimeMs,
    )[0];
    if (
      latestInstallerArtifact &&
      (!state.installerExe ||
        state.installerExe.path !== latestInstallerArtifact.path ||
        state.installerExe.size !== latestInstallerArtifact.size ||
        Math.round(state.installerExe.mtimeMs) !==
          Math.round(latestInstallerArtifact.mtimeMs))
    ) {
      state.installerExe = latestInstallerArtifact;
      await writeEvent("installer-exe-update", {
        path: toRelativePath(latestInstallerArtifact.path),
        bytes: latestInstallerArtifact.size,
        mtimeMs: Math.round(latestInstallerArtifact.mtimeMs),
      });
    }
  };

  return {
    async start() {
      await writeEvent("start", {
        releaseRoot: options.releaseRoot,
        logPath,
      });
      await observeOnce();
      pollHandle = setInterval(() => {
        void observeOnce();
      }, 1000);
      pollHandle.unref?.();
    },
    async stop(status) {
      if (pollHandle) {
        clearInterval(pollHandle);
      }
      await observeOnce();
      const winUnpackedPath = resolve(options.releaseRoot, "win-unpacked");
      const finalWinUnpacked =
        (await pathExists(winUnpackedPath)) && state.winUnpackedReady
          ? await collectDirectoryStats(winUnpackedPath).catch(() => null)
          : null;
      state.finalWinUnpacked = finalWinUnpacked;
      await writeEvent("complete", {
        status,
        winUnpackedReady: state.winUnpackedReady
          ? {
              path: toRelativePath(state.winUnpackedReady.path),
              fileCount: state.winUnpackedReady.fileCount,
              totalBytes: state.winUnpackedReady.totalBytes,
            }
          : null,
        finalWinUnpacked: finalWinUnpacked,
        firstNsis7z: state.firstNsis7z
          ? {
              path: toRelativePath(state.firstNsis7z.path),
              bytes: state.firstNsis7z.size,
              mtimeMs: Math.round(state.firstNsis7z.mtimeMs),
            }
          : null,
        finalNsis7z: state.finalNsis7z
          ? {
              path: toRelativePath(state.finalNsis7z.path),
              bytes: state.finalNsis7z.size,
              mtimeMs: Math.round(state.finalNsis7z.mtimeMs),
            }
          : null,
        installerExe: state.installerExe
          ? {
              path: toRelativePath(state.installerExe.path),
              bytes: state.installerExe.size,
              mtimeMs: Math.round(state.installerExe.mtimeMs),
            }
          : null,
        logPath,
      });
    },
  };
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(path) {
  return hashString(await readFile(path, "utf8"));
}

async function createWinUnpackedManifest(releaseRoot) {
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );
  return {
    platform: "win",
    mode: "dir-only",
    version:
      typeof desktopPackage.version === "string" ? desktopPackage.version : "",
    outputPath: resolve(releaseRoot, "win-unpacked"),
    packageJsonHash: await hashFile(desktopPackageJsonPath),
    lockfileHash: await hashFile(resolve(repoRoot, "pnpm-lock.yaml")),
    scriptHash: await hashFile(resolve(scriptDir, "dist-win.mjs")),
  };
}

async function writeWinUnpackedManifest(releaseRoot) {
  const winUnpackedManifestDir = resolve(releaseRoot, ".cache", "dist-win");
  const winUnpackedManifestPath = resolve(
    winUnpackedManifestDir,
    "win-unpacked-manifest.json",
  );
  await mkdir(winUnpackedManifestDir, { recursive: true });
  const manifest = await createWinUnpackedManifest(releaseRoot);
  await writeFile(
    winUnpackedManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function validateWinUnpackedReuse(releaseRoot) {
  const winUnpackedManifestDir = resolve(releaseRoot, ".cache", "dist-win");
  const winUnpackedManifestPath = resolve(
    winUnpackedManifestDir,
    "win-unpacked-manifest.json",
  );
  const outputPath = resolve(releaseRoot, "win-unpacked");
  if (!(await pathExists(outputPath))) {
    return { valid: false, reason: "win-unpacked output missing" };
  }
  if (!(await pathExists(winUnpackedManifestPath))) {
    return { valid: false, reason: "win-unpacked manifest missing" };
  }
  try {
    const manifest = JSON.parse(
      await readFile(winUnpackedManifestPath, "utf8"),
    );
    const expected = await createWinUnpackedManifest(releaseRoot);
    const mismatches = [];
    for (const key of [
      "platform",
      "mode",
      "version",
      "outputPath",
      "packageJsonHash",
      "lockfileHash",
      "scriptHash",
    ]) {
      if (manifest[key] !== expected[key]) {
        mismatches.push(key);
      }
    }
    if (mismatches.length > 0) {
      return {
        valid: false,
        reason: `manifest mismatch: ${mismatches.join(", ")}`,
      };
    }
    return { valid: true, reason: "valid" };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function validatePackagedQqbotDependencies(releaseRoot) {
  const winUnpackedRoot = resolve(releaseRoot, "win-unpacked");
  const qqbotPluginRoot = resolve(
    winUnpackedRoot,
    "resources",
    "runtime",
    "controller",
    "plugins",
    "openclaw-qqbot",
  );
  const silkWasmPackagePath = resolve(
    qqbotPluginRoot,
    "node_modules",
    "silk-wasm",
    "package.json",
  );

  if (!(await pathExists(qqbotPluginRoot))) {
    throw new Error(
      `[dist:win] packaged app is missing openclaw-qqbot: ${qqbotPluginRoot}`,
    );
  }

  if (!(await pathExists(silkWasmPackagePath))) {
    throw new Error(
      `[dist:win] packaged app is missing openclaw-qqbot dependency silk-wasm: ${silkWasmPackagePath}`,
    );
  }
}

async function ensureExistingBuildArtifacts() {
  await Promise.all([
    ensureExistingPath(
      resolve(repoRoot, "packages/dev-utils/dist"),
      "dev-utils build",
    ),
    ensureExistingPath(
      resolve(repoRoot, "packages/shared/dist"),
      "shared build",
    ),
    ensureExistingPath(
      resolve(repoRoot, "apps/controller/dist"),
      "controller build",
    ),
    ensureExistingPath(resolve(repoRoot, "apps/web/dist"), "web build"),
    ensureExistingPath(resolve(electronRoot, "dist"), "desktop renderer build"),
    ensureExistingPath(
      resolve(electronRoot, "dist-electron/main"),
      "desktop main build",
    ),
    ensureExistingPath(
      resolve(electronRoot, "dist-electron/preload"),
      "desktop preload build",
    ),
  ]);
}

async function ensureExistingRuntimeInstall() {
  const runtimePackageRoot = resolve(repoRoot, "openclaw-runtime");
  const runtimeNodeModulesPath = resolve(runtimePackageRoot, "node_modules");
  const runtimePostinstallCachePath = resolve(
    runtimePackageRoot,
    ".postinstall-cache.json",
  );

  await Promise.all([
    ensureExistingPath(runtimeNodeModulesPath, "openclaw-runtime install"),
    ensureExistingPath(runtimePostinstallCachePath, "openclaw-runtime cache"),
  ]);
}

async function ensureExistingOpenclawSidecar(runtimeDistRoot, options = {}) {
  const openclawSidecarRoot = resolve(runtimeDistRoot, "openclaw");

  try {
    await ensureExistingPath(
      resolve(openclawSidecarRoot, "archive.json"),
      "openclaw sidecar archive metadata",
    );
    return;
  } catch (error) {
    if (!options.allowUnarchived) {
      throw error;
    }
  }

  await Promise.all([
    ensureExistingPath(
      resolve(openclawSidecarRoot, "package.json"),
      "openclaw sidecar package",
    ),
    ensureExistingPath(
      resolve(openclawSidecarRoot, "node_modules", "openclaw", "openclaw.mjs"),
      "openclaw sidecar entry",
    ),
  ]);
}

async function ensureExistingSidecars(runtimeDistRoot, options = {}) {
  await Promise.all([
    ensureExistingPath(
      resolve(runtimeDistRoot, "controller", "package.json"),
      "controller sidecar",
    ),
    ensureExistingOpenclawSidecar(runtimeDistRoot, {
      allowUnarchived: options.allowUnarchivedOpenclaw,
    }),
    ensureExistingPath(
      resolve(runtimeDistRoot, "web", "package.json"),
      "web sidecar",
    ),
  ]);
}

async function dereferencePnpmSymlinks() {
  const sharpPath = resolve(electronRoot, "node_modules/sharp");
  const imgPath = resolve(electronRoot, "node_modules/@img");
  let pnpmImgPath = null;

  const sharpStat = await lstat(sharpPath).catch((error) => {
    throw new Error(
      `[dist:win] Missing required sharp dependency at ${sharpPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (sharpStat.isSymbolicLink()) {
    const realSharpPath = await realpath(sharpPath);
    pnpmImgPath = resolve(dirname(realSharpPath), "@img");
    console.log(
      `[dist:win] dereferencing pnpm symlink: ${sharpPath} -> ${realSharpPath}`,
    );
    await rm(sharpPath, rmWithRetriesOptions);
    await cp(realSharpPath, sharpPath, {
      recursive: true,
      dereference: true,
    });
  }

  const sharpImgPath = pnpmImgPath ?? resolve(sharpPath, "node_modules/@img");
  const sharpImgStat = await lstat(sharpImgPath).catch(() => null);

  if (!sharpImgStat) {
    const existingImgStat = await lstat(imgPath).catch(() => null);

    if (existingImgStat) {
      console.log(
        `[dist:win] reusing existing top-level @img dependency at ${imgPath}`,
      );
      return;
    }

    throw new Error(
      `[dist:win] Missing required @img dependency at ${sharpImgPath} and top-level fallback ${imgPath}`,
    );
  }

  if (sharpImgStat) {
    console.log(
      `[dist:win] copying @img from sharp's node_modules: ${sharpImgPath} -> ${imgPath}`,
    );
    await rm(imgPath, rmWithRetriesOptions);
    await cp(sharpImgPath, imgPath, { recursive: true, dereference: true });
  }
}

function redactBuildConfigForLog(config) {
  return {
    NEXU_CLOUD_URL: config.NEXU_CLOUD_URL,
    NEXU_LINK_URL: config.NEXU_LINK_URL,
    NEXU_DESKTOP_APP_VERSION: config.NEXU_DESKTOP_APP_VERSION,
    NEXU_DESKTOP_AUTO_UPDATE_ENABLED: config.NEXU_DESKTOP_AUTO_UPDATE_ENABLED,
    NEXU_DESKTOP_BUILD_SOURCE: config.NEXU_DESKTOP_BUILD_SOURCE,
    NEXU_DESKTOP_BUILD_BRANCH: config.NEXU_DESKTOP_BUILD_BRANCH,
    NEXU_DESKTOP_BUILD_COMMIT: config.NEXU_DESKTOP_BUILD_COMMIT,
    NEXU_DESKTOP_BUILD_TIME: config.NEXU_DESKTOP_BUILD_TIME,
    hasSentryDsn: typeof config.NEXU_DESKTOP_SENTRY_DSN === "string",
    hasUpdateFeedUrl: typeof config.NEXU_UPDATE_FEED_URL === "string",
  };
}

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function getGitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const commandSpec = createPlatformCommandSpec({
      command,
      args,
      env: options.env ?? process.env,
      platform: buildTargetPlatform === "win" ? "win32" : process.platform,
    });
    const cwd = options.cwd ?? repoRoot;
    const timeoutMs = options.timeoutMs ?? 0;
    const label =
      options.label ?? `${commandSpec.command} ${commandSpec.args.join(" ")}`;
    const startedAt = performance.now();
    console.log(
      `[dist:win][command] start label=${JSON.stringify(label)} pid=pending cwd=${JSON.stringify(cwd)} timeoutMs=${timeoutMs || 0} command=${JSON.stringify(commandSpec.command)} args=${JSON.stringify(commandSpec.args)}`,
    );
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    console.log(
      `[dist:win][command] spawned label=${JSON.stringify(label)} pid=${child.pid ?? "unknown"}`,
    );

    let settled = false;
    let killTimeoutHandle = null;
    let forceKillTimeoutHandle = null;

    const clearTimers = () => {
      if (killTimeoutHandle) {
        clearTimeout(killTimeoutHandle);
      }
      if (forceKillTimeoutHandle) {
        clearTimeout(forceKillTimeoutHandle);
      }
    };

    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      rejectRun(error);
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      resolveRun();
    };

    if (timeoutMs > 0) {
      killTimeoutHandle = setTimeout(() => {
        console.log(
          `[dist:win][command] timeout label=${JSON.stringify(label)} pid=${child.pid ?? "unknown"} timeoutMs=${timeoutMs}`,
        );
        try {
          child.kill();
        } catch {}
        forceKillTimeoutHandle = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            try {
              child.kill("SIGKILL");
            } catch {}
          }
        }, 5000);
        rejectOnce(
          new Error(
            `[dist:win] command timed out after ${timeoutMs}ms: ${label}`,
          ),
        );
      }, timeoutMs);
    }

    child.once("error", (error) => {
      console.log(
        `[dist:win][command] error label=${JSON.stringify(label)} pid=${child.pid ?? "unknown"} duration=${formatDurationMs(performance.now() - startedAt)} message=${JSON.stringify(error.message)}`,
      );
      rejectOnce(error);
    });
    child.once("exit", (code) => {
      console.log(
        `[dist:win][command] exit label=${JSON.stringify(label)} pid=${child.pid ?? "unknown"} code=${code ?? "null"} duration=${formatDurationMs(performance.now() - startedAt)}`,
      );
      if (code === 0) {
        resolveOnce();
        return;
      }
      rejectOnce(
        new Error(
          `${commandSpec.command} ${commandSpec.args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function runElectronBuilder(args, options = {}) {
  const electronBuilderCli = require.resolve("electron-builder/cli.js", {
    paths: [electronRoot, repoRoot],
  });
  await run(process.execPath, [electronBuilderCli, ...args], {
    ...options,
    label: options.label ?? "electron-builder",
  });
}

async function ensureWindowsPwdShim() {
  if (buildTargetPlatform !== "win") {
    return null;
  }

  const shimDir = resolve(repoRoot, ".cache", "nexu-dev", "bin");
  const shimPath = resolve(shimDir, "pwd.cmd");
  await mkdir(shimDir, { recursive: true });
  await writeFile(shimPath, "@echo off\r\necho %CD%\r\n", "utf8");
  return shimDir;
}

async function ensureBuildConfig() {
  const configPath = resolve(electronRoot, "build-config.json");
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );
  const envPath = resolve(electronRoot, ".env");
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(await readFile(envPath, "utf8"));
  } catch {}

  const merged = { ...fileEnv, ...process.env };
  const gitBranch = getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const gitCommit = getGitValue(["rev-parse", "HEAD"]);

  const config = {
    NEXU_CLOUD_URL: merged.NEXU_CLOUD_URL ?? "https://nexu.io",
    NEXU_LINK_URL: merged.NEXU_LINK_URL ?? null,
    ...(merged.NEXU_DESKTOP_UPDATE_CHANNEL
      ? {
          NEXU_DESKTOP_UPDATE_CHANNEL: merged.NEXU_DESKTOP_UPDATE_CHANNEL,
        }
      : {}),
    NEXU_DESKTOP_APP_VERSION:
      merged.NEXU_DESKTOP_APP_VERSION ??
      (typeof desktopPackage.version === "string"
        ? desktopPackage.version
        : undefined) ??
      merged.npm_package_version ??
      undefined,
    ...(merged.NEXU_DESKTOP_SENTRY_DSN
      ? { NEXU_DESKTOP_SENTRY_DSN: merged.NEXU_DESKTOP_SENTRY_DSN }
      : {}),
    ...(merged.NEXU_UPDATE_FEED_URL
      ? { NEXU_UPDATE_FEED_URL: merged.NEXU_UPDATE_FEED_URL }
      : {}),
    ...(merged.NEXU_DESKTOP_AUTO_UPDATE_ENABLED
      ? {
          NEXU_DESKTOP_AUTO_UPDATE_ENABLED:
            merged.NEXU_DESKTOP_AUTO_UPDATE_ENABLED,
        }
      : {}),
    NEXU_DESKTOP_BUILD_SOURCE: merged.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dist",
    ...((merged.NEXU_DESKTOP_BUILD_BRANCH ?? gitBranch)
      ? {
          NEXU_DESKTOP_BUILD_BRANCH:
            merged.NEXU_DESKTOP_BUILD_BRANCH ?? gitBranch,
        }
      : {}),
    ...((merged.NEXU_DESKTOP_BUILD_COMMIT ?? gitCommit)
      ? {
          NEXU_DESKTOP_BUILD_COMMIT:
            merged.NEXU_DESKTOP_BUILD_COMMIT ?? gitCommit,
        }
      : {}),
    NEXU_DESKTOP_BUILD_TIME:
      merged.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(
    "[dist:win] generated build-config.json from env:",
    JSON.stringify(redactBuildConfigForLog(config)),
  );
}

async function getElectronVersion() {
  const electronPackageJsonPath = require.resolve("electron/package.json", {
    paths: [electronRoot, repoRoot],
  });
  const electronPackageJson = JSON.parse(
    await readFile(electronPackageJsonPath, "utf8"),
  );
  if (typeof electronPackageJson.version !== "string") {
    throw new Error(
      `Unable to determine Electron version from ${electronPackageJsonPath}.`,
    );
  }
  return electronPackageJson.version;
}

async function getWindowsBuildVersion() {
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );
  const rawVersion =
    typeof desktopPackage.version === "string"
      ? desktopPackage.version
      : process.env.npm_package_version;

  if (typeof rawVersion !== "string" || rawVersion.trim().length === 0) {
    return "0.0.0.0";
  }

  const numericParts = rawVersion
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  while (numericParts.length < 4) {
    numericParts.push(0);
  }

  return numericParts.slice(0, 4).join(".");
}

async function cleanupReleaseIntermediates(releaseRoot) {
  const entries = await readdir(releaseRoot, { withFileTypes: true });
  const removableNames = entries
    .filter((entry) => {
      if (entry.isDirectory()) {
        return false;
      }

      return (
        entry.name === "builder-debug.yml" ||
        entry.name.endsWith(".__uninstaller.exe") ||
        entry.name.endsWith(".nsis.7z")
      );
    })
    .map((entry) => entry.name);

  await Promise.all(
    removableNames.map((name) =>
      rm(resolve(releaseRoot, name), rmWithRetriesOptions),
    ),
  );

  if (removableNames.length > 0) {
    console.log(
      `[dist:win] removed release intermediates: ${removableNames.join(", ")}`,
    );
  }
}

async function runWindowsElectronBuilderStage({
  buildCapabilities,
  dirOnly,
  electronBuilderEnv,
  electronVersion,
  buildVersion,
  extraArgs = [],
  releaseRoot,
  stageName,
  targets,
  prepackagedPath = null,
  windowsPwdShimDir,
}) {
  const electronBuilderArgs = [
    ...buildCapabilities.createElectronBuilderArgs({
      electronVersion,
      buildVersion,
      dirOnly,
      targets,
    }),
    ...(prepackagedPath ? [`--prepackaged=${prepackagedPath}`] : []),
    ...extraArgs,
  ];
  const builderPhaseObserver =
    buildTargetPlatform === "win"
      ? createWindowsBuilderPhaseObserver({
          releaseRoot,
          dirOnly,
          nsisFromExistingDir: prepackagedPath !== null,
        })
      : null;

  await builderPhaseObserver?.start();

  try {
    await runElectronBuilder(electronBuilderArgs, {
      cwd: electronRoot,
      timeoutMs: diagnosticsEnabled
        ? getStepTimeoutMs("run electron-builder")
        : 0,
      label: `electron-builder:${stageName} ${electronBuilderArgs.join(" ")}`,
      env: {
        ...electronBuilderEnv,
        DEBUG:
          electronBuilderEnv.DEBUG ?? "electron-builder,electron-builder:*",
        ...(windowsPwdShimDir
          ? {
              PATH: `${windowsPwdShimDir};${electronBuilderEnv.PATH ?? process.env.PATH ?? ""}`,
            }
          : {}),
      },
    });
    await builderPhaseObserver?.stop("success");
  } catch (error) {
    await builderPhaseObserver?.stop("error");
    throw error;
  }
}

async function main() {
  const rawArgs = new Set(process.argv.slice(2));
  const localMode = rawArgs.has("--local");
  const dirOnly =
    localMode || rawArgs.has("--dir-only") || rawArgs.has("--target=dir");
  const nsisFromExistingDir = rawArgs.has("--nsis-from-existing-dir");
  const timings = [];
  if (buildTargetPlatform !== "win") {
    throw new Error(
      `[dist:win] Windows packaging must run with target platform "win": host=${process.platform}, target=${buildTargetPlatform}.`,
    );
  }
  const buildContext = createDesktopBuildContext({
    electronRoot,
    repoRoot,
    processEnv: process.env,
  });
  const env = buildContext.env;
  const releaseRoot = buildContext.resolveReleaseRoot();
  const buildCapabilities = createWindowsBuildCapabilities({
    env,
    releaseRoot,
    processPlatform: process.platform,
  });
  const runtimeDistRoot = buildContext.resolveRuntimeDistRoot();
  const electronBuilderEnv = buildCapabilities.createElectronBuilderEnv();
  const windowsPwdShimDir = await ensureWindowsPwdShim();
  const useUnarchivedOpenclawSidecar = buildTargetPlatform === "win";
  const allowUnarchivedOpenclawSidecar = useUnarchivedOpenclawSidecar;
  const shouldReuseExistingBuildArtifacts = false;
  const shouldReuseExistingRuntimeInstall = false;
  const shouldReuseExistingSidecars = false;
  const shouldReuseExistingWinUnpacked = nsisFromExistingDir;

  if (localMode) {
    console.log(
      `[dist:win] local mode enabled dirOnly=${dirOnly} reuseBuilds=false reuseRuntimeInstall=false reuseSidecars=false`,
    );
  }
  if (nsisFromExistingDir) {
    const reuseCheck = await validateWinUnpackedReuse(releaseRoot);
    if (!reuseCheck.valid) {
      throw new Error(
        `[dist:win] --nsis-from-existing-dir requires a valid win-unpacked stage: ${reuseCheck.reason}`,
      );
    }
  }

  await timedStep(
    "clean release directories",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] preserving release directory for --nsis-from-existing-dir",
        );
        return;
      }
      await rm(releaseRoot, rmWithRetriesOptions);
      if (!shouldReuseExistingSidecars) {
        await rm(runtimeDistRoot, rmWithRetriesOptions);
      }
    },
    timings,
  );

  await timedStep(
    "build shared workspace steps",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping shared workspace steps for --nsis-from-existing-dir",
        );
        return;
      }
      if (
        shouldReuseExistingBuildArtifacts &&
        shouldReuseExistingRuntimeInstall
      ) {
        await ensureExistingBuildArtifacts();
        await ensureExistingRuntimeInstall();
        console.log(
          "[dist:win] reusing existing workspace builds and runtime install",
        );
        return;
      }

      for (const [command, args] of getSharedBuildSteps({ repoRoot })) {
        const isBuildStep =
          args.includes("build") &&
          (args.includes("@nexu/dev-utils") ||
            args.includes("@nexu/shared") ||
            args.includes("@nexu/controller"));
        const isRuntimeInstallStep = args.includes("openclaw-runtime:install");

        if (isBuildStep && shouldReuseExistingBuildArtifacts) {
          console.log(
            `[dist:win] skipping shared build step due to reuse: ${args.join(" ")}`,
          );
          continue;
        }

        if (isRuntimeInstallStep && shouldReuseExistingRuntimeInstall) {
          console.log(
            `[dist:win] skipping runtime install step due to reuse: ${args.join(" ")}`,
          );
          continue;
        }

        await run(command === "pnpm" ? pnpmCommand : command, args, {
          env,
          timeoutMs: diagnosticsEnabled
            ? getStepTimeoutMs("build shared workspace steps")
            : 0,
          label: `shared workspace: ${args.join(" ")}`,
        });
      }
    },
    timings,
  );
  await timedStep(
    "build @nexu/web",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping @nexu/web build for --nsis-from-existing-dir",
        );
        return;
      }
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await timedStep(
        "build @nexu/web:tsc",
        async () => {
          await run(
            pnpmCommand,
            ["--dir", repoRoot, "--filter", "@nexu/web", "exec", "tsc", "-b"],
            {
              env: buildCapabilities.webBuildEnv,
              timeoutMs: diagnosticsEnabled
                ? getStepTimeoutMs("build @nexu/web:tsc")
                : 0,
              label: "build @nexu/web:tsc",
            },
          );
        },
        timings,
      );
      await timedStep(
        "build @nexu/web:vite",
        async () => {
          await run(
            pnpmCommand,
            [
              "--dir",
              repoRoot,
              "--filter",
              "@nexu/web",
              "exec",
              "vite",
              "build",
            ],
            {
              env: buildCapabilities.webBuildEnv,
              timeoutMs: diagnosticsEnabled
                ? getStepTimeoutMs("build @nexu/web:vite")
                : 0,
              label: "build @nexu/web:vite",
            },
          );
        },
        timings,
      );
    },
    timings,
  );
  await timedStep(
    "build @nexu/desktop",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping @nexu/desktop build for --nsis-from-existing-dir",
        );
        return;
      }
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await run(pnpmCommand, ["run", "build"], {
        cwd: electronRoot,
        env,
        timeoutMs: diagnosticsEnabled
          ? getStepTimeoutMs("build @nexu/desktop")
          : 0,
        label: "build @nexu/desktop",
      });
    },
    timings,
  );
  await timedStep(
    "prepare runtime sidecars",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping runtime sidecar preparation for --nsis-from-existing-dir",
        );
        return;
      }
      if (shouldReuseExistingSidecars) {
        await ensureExistingSidecars(runtimeDistRoot, {
          allowUnarchivedOpenclaw: allowUnarchivedOpenclawSidecar,
        });
        console.log("[dist:win] reusing existing prepared runtime sidecars");
        return;
      }

      await run(
        "node",
        [resolve(scriptDir, "prepare-runtime-sidecars.mjs"), "--release"],
        {
          cwd: electronRoot,
          timeoutMs: diagnosticsEnabled
            ? getStepTimeoutMs("prepare runtime sidecars")
            : 0,
          label: "prepare runtime sidecars",
          env: {
            ...buildCapabilities.sidecarReleaseEnv,
            ...(useUnarchivedOpenclawSidecar
              ? {
                  NEXU_DESKTOP_ARCHIVE_OPENCLAW_SIDECAR: "false",
                }
              : {}),
          },
        },
      );
    },
    timings,
  );
  await timedStep(
    "generate build config",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping build config generation for --nsis-from-existing-dir",
        );
        return;
      }
      await ensureBuildConfig();
    },
    timings,
  );
  await timedStep(
    "dereference pnpm symlinks",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping pnpm symlink dereference for --nsis-from-existing-dir",
        );
        return;
      }
      await dereferencePnpmSymlinks();
    },
    timings,
  );

  const electronVersion = await timedStep(
    "resolve electron version",
    async () => getElectronVersion(),
    timings,
  );
  const buildVersion = await timedStep(
    "resolve windows build version",
    async () => getWindowsBuildVersion(),
    timings,
  );

  await timedStep(
    "stage win-unpacked payload",
    async () => {
      if (shouldReuseExistingWinUnpacked) {
        const reuseCheck = await validateWinUnpackedReuse(releaseRoot);
        if (reuseCheck.valid) {
          console.log("[dist:win] reusing existing win-unpacked stage");
          if (dirOnly) {
            return;
          }
        } else if (dirOnly) {
          console.log(
            `[dist:win] win-unpacked reuse unavailable, rebuilding: ${reuseCheck.reason}`,
          );
        } else {
          throw new Error(
            `[dist:win] expected reusable win-unpacked stage before NSIS packaging: ${reuseCheck.reason}`,
          );
        }
      }

      if (shouldReuseExistingWinUnpacked) {
        return;
      }

      await runWindowsElectronBuilderStage({
        buildCapabilities,
        dirOnly: true,
        electronBuilderEnv,
        electronVersion,
        buildVersion,
        extraArgs: localMode
          ? ["--config.npmRebuild=false", "--config.nodeGypRebuild=false"]
          : [],
        releaseRoot,
        stageName: "dir",
        targets: ["dir"],
        windowsPwdShimDir,
      });
      await writeWinUnpackedManifest(releaseRoot);
    },
    timings,
  );
  await timedStep(
    "validate packaged qqbot dependencies",
    async () => validatePackagedQqbotDependencies(releaseRoot),
    timings,
  );

  if (!dirOnly) {
    await timedStep(
      "build nsis installer from win-unpacked",
      async () => {
        const reuseCheck = await validateWinUnpackedReuse(releaseRoot);
        if (!reuseCheck.valid) {
          throw new Error(
            `[dist:win] NSIS packaging requires a valid win-unpacked stage: ${reuseCheck.reason}`,
          );
        }

        await runWindowsElectronBuilderStage({
          buildCapabilities,
          dirOnly: false,
          electronBuilderEnv,
          electronVersion,
          buildVersion,
          releaseRoot,
          stageName: "nsis-from-win-unpacked",
          targets: ["nsis"],
          prepackagedPath: resolve(releaseRoot, "win-unpacked"),
          windowsPwdShimDir,
        });
      },
      timings,
    );
  }
  await timedStep(
    "clean release intermediates",
    async () => {
      if (nsisFromExistingDir) {
        console.log(
          "[dist:win] skipping release intermediate cleanup for --nsis-from-existing-dir",
        );
        return;
      }
      await cleanupReleaseIntermediates(releaseRoot);
    },
    timings,
  );

  console.log("[dist:win][timing] summary");
  for (const timing of timings) {
    console.log(
      `[dist:win][timing] ${timing.stepName}=${formatDurationMs(timing.durationMs)}`,
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof StopAfterStepSignal) {
    console.log(error.message);
  } else {
    throw error;
  }
}
