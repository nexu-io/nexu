import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const desktopPackageJsonPath = resolve(electronRoot, "package.json");
const require = createRequire(import.meta.url);
const isUnsigned =
  process.argv.includes("--unsigned") ||
  process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
  process.env.NEXU_DESKTOP_MAC_UNSIGNED?.toLowerCase() === "true";
const targetMacArch = resolveTargetMacArch();
const macTargets = resolveMacTargets();
const buildTargetPlatform = resolveBuildTargetPlatform({
  env: process.env,
  platform: process.platform,
});
const dmgBuilderReleaseName = "dmg-builder@1.2.0";
const dmgBuilderReleaseVersion = "75c8a6c";
const dmgBuilderArch = targetMacArch === "arm64" ? "arm64" : "x86_64";
const dmgBuilderArchiveName = `dmgbuild-bundle-${dmgBuilderArch}-${dmgBuilderReleaseVersion}.tar.gz`;
const dmgBuilderChecksum = {
  arm64: "a785f2a385c8c31996a089ef8e26361904b40c772d5ea65a36001212f1fc25e0",
  x86_64: "87b3bb72148b11451ee90ede79cc8d59305c9173b68b0f2b50a3bea51fc4a4e2",
}[dmgBuilderArch];

const rmWithRetriesOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
};

const shouldReuseExistingBuildArtifacts =
  process.env.NEXU_DESKTOP_USE_EXISTING_BUILDS === "1" ||
  process.env.NEXU_DESKTOP_USE_EXISTING_BUILDS?.toLowerCase() === "true";
const shouldReuseExistingRuntimeInstall =
  process.env.NEXU_DESKTOP_USE_EXISTING_RUNTIME_INSTALL === "1" ||
  process.env.NEXU_DESKTOP_USE_EXISTING_RUNTIME_INSTALL?.toLowerCase() ===
    "true";
const isFastCiMode =
  process.env.NEXU_DESKTOP_ELECTRON_BUILDER_FAST_MODE === "1" ||
  process.env.NEXU_DESKTOP_ELECTRON_BUILDER_FAST_MODE?.toLowerCase() === "true";

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

async function appendTimingSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!summaryPath) {
    return;
  }

  await writeFile(summaryPath, `${lines.join("\n")}\n`, { flag: "a" });
}

async function ensureExistingPath(path, label) {
  try {
    await lstat(path);
  } catch {
    throw new Error(`[dist:mac] Missing ${label}: ${path}`);
  }
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureExistingBuildArtifacts() {
  await Promise.all([
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
  await Promise.all([
    ensureExistingPath(
      resolve(repoRoot, "openclaw-runtime/node_modules"),
      "openclaw-runtime install",
    ),
    ensureExistingPath(
      resolve(repoRoot, "openclaw-runtime/.postinstall-cache.json"),
      "openclaw-runtime cache",
    ),
  ]);
}

// Only honor an explicitly provided electron dist override (used by e2e
// coverage tooling). When unset, return null so electron-builder falls back
// to its default electron resolution. Pointing electron-builder directly at
// the pnpm-stored Electron.app caused codesign to fail with "bundle format is
// ambiguous" because the framework symlink layout did not survive the copy
// from the pnpm content-addressable store (regression from #698).
async function resolveElectronDistPath() {
  const override = process.env.NEXU_DESKTOP_ELECTRON_DIST_PATH;
  if (!override) {
    return null;
  }
  await ensureExistingPath(override, "electron dist override");
  return override;
}

async function timedStep(stepName, fn, timings) {
  const startedAt = performance.now();
  console.log(`[dist:mac][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - startedAt;
    timings.push({ stepName, durationMs });
    console.log(
      `[dist:mac][timing] done ${stepName} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

function resolveTargetMacArch() {
  const argValue = process.argv.find((arg) => arg.startsWith("--arch="));
  const rawArch =
    argValue?.slice("--arch=".length) ?? process.env.NEXU_DESKTOP_TARGET_ARCH;

  if (!rawArch) {
    return process.arch === "x64" ? "x64" : "arm64";
  }

  if (rawArch === "x64" || rawArch === "arm64") {
    return rawArch;
  }

  throw new Error(
    `[dist:mac] Unsupported target arch \"${rawArch}\". Expected \"x64\" or \"arm64\".`,
  );
}

function resolveMacTargets() {
  const argValue = process.argv.find((arg) => arg.startsWith("--targets="));
  const rawTargets =
    argValue?.slice("--targets=".length) ??
    process.env.NEXU_DESKTOP_MAC_TARGETS;

  if (!rawTargets) {
    return null;
  }

  const targets = rawTargets
    .split(/[\s,]+/u)
    .map((target) => target.trim())
    .filter(Boolean);

  if (targets.length === 0) {
    return null;
  }

  return targets;
}

function shouldBootstrapDmgTooling() {
  return macTargets === null || macTargets.includes("dmg");
}

function ensureArchScopedFeedUrl(feedUrl) {
  if (!feedUrl || feedUrl.startsWith("github://")) {
    return feedUrl;
  }

  try {
    const url = new URL(feedUrl);
    const trimmedPath = url.pathname.replace(/\/+$/u, "");

    if (trimmedPath.endsWith(`/${targetMacArch}`)) {
      return url.toString();
    }

    url.pathname = `${trimmedPath}/${targetMacArch}`;
    return url.toString();
  } catch {
    const trimmedFeedUrl = feedUrl.replace(/\/+$/u, "");
    return trimmedFeedUrl.endsWith(`/${targetMacArch}`)
      ? trimmedFeedUrl
      : `${trimmedFeedUrl}/${targetMacArch}`;
  }
}

/**
 * Dereference pnpm symlinks for extraResources that electron-builder
 * copies into the bundle. Without this, symlinks point to non-existent
 * paths in the final .app bundle, causing codesign to fail.
 */
async function dereferencePnpmSymlinks() {
  const sharpPath = resolve(electronRoot, "node_modules/sharp");
  const imgPath = resolve(electronRoot, "node_modules/@img");
  let pnpmImgPath = null;

  // First, dereference sharp if it's a symlink
  try {
    const sharpStat = await lstat(sharpPath);
    if (sharpStat.isSymbolicLink()) {
      const realSharpPath = await realpath(sharpPath);
      pnpmImgPath = resolve(dirname(realSharpPath), "@img");
      console.log(
        `[dist:mac] dereferencing pnpm symlink: ${sharpPath} -> ${realSharpPath}`,
      );
      await rm(sharpPath, rmWithRetriesOptions);
      await cp(realSharpPath, sharpPath, {
        recursive: true,
        dereference: true,
      });
    }
  } catch (err) {
    console.log(`[dist:mac] skipping sharp: ${err.message}`);
  }

  // Then, copy @img from sharp's node_modules to top-level if it doesn't exist
  // (pnpm hoists @img inside sharp's node_modules, not at top level)
  try {
    const sharpImgPath = pnpmImgPath ?? resolve(sharpPath, "node_modules/@img");
    const sharpImgStat = await lstat(sharpImgPath).catch(() => null);

    if (sharpImgStat) {
      console.log(
        `[dist:mac] copying @img from sharp's node_modules: ${sharpImgPath} -> ${imgPath}`,
      );
      await rm(imgPath, rmWithRetriesOptions);
      await cp(sharpImgPath, imgPath, { recursive: true, dereference: true });
    } else {
      console.log(`[dist:mac] @img not found in sharp's node_modules`);
    }
  } catch (err) {
    console.log(`[dist:mac] skipping @img: ${err.message}`);
  }
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

async function loadDesktopEnv() {
  const envPath = resolve(electronRoot, ".env");

  try {
    const content = await readFile(envPath, "utf8");
    return parseEnvFile(content);
  } catch {
    return {};
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

function shellEscape(value) {
  return `'${String(value).replace(/'/gu, `'"'"'`)}'`;
}

function quoteNodeOptionValue(value) {
  return `"${String(value).replace(/(["\\])/gu, "\\$1")}"`;
}

async function runElectronBuilder(args, options = {}) {
  const electronBuilderCli = require.resolve("electron-builder/cli.js", {
    paths: [electronRoot, repoRoot],
  });
  const electronBuilderPreload = resolve(
    scriptDir,
    "electron-builder-pnpm-json-preload.cjs",
  );
  const targetOpenFiles = process.env.NEXU_DESKTOP_MAX_OPEN_FILES ?? "8192";
  const baseEnv = options.env ?? process.env;
  const existingNodeOptions = baseEnv.NODE_OPTIONS?.trim();
  const nodeOptions = [
    existingNodeOptions,
    `--require=${quoteNodeOptionValue(electronBuilderPreload)}`,
  ]
    .filter(Boolean)
    .join(" ");
  const command = [
    `target=${shellEscape(targetOpenFiles)}`,
    `export NODE_OPTIONS=${shellEscape(nodeOptions)}`,
    'hard_limit=$(ulimit -Hn 2>/dev/null || printf %s "$target")',
    'if [ "$hard_limit" != "unlimited" ] && [ "$hard_limit" -lt "$target" ]; then target="$hard_limit"; fi',
    'ulimit -n "$target" 2>/dev/null || true',
    `exec ${shellEscape(process.execPath)} ${shellEscape(electronBuilderCli)} ${args.map(shellEscape).join(" ")}`,
  ].join("; ");

  await run("bash", ["-lc", command], options);
}

async function ensureDmgbuildBundle() {
  if (process.env.CUSTOM_DMGBUILD_PATH) {
    return process.env.CUSTOM_DMGBUILD_PATH;
  }

  const cacheRoot = resolve(electronRoot, ".cache", dmgBuilderReleaseName);
  const extractDir = resolve(
    cacheRoot,
    dmgBuilderArchiveName.replace(/\.(tar\.gz|tgz)$/u, ""),
  );
  const dmgbuildPath = resolve(extractDir, "dmgbuild");
  const archivePath = resolve(cacheRoot, dmgBuilderArchiveName);
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${dmgBuilderReleaseName}/${dmgBuilderArchiveName}`;

  try {
    await readFile(dmgbuildPath);
    return dmgbuildPath;
  } catch {
    // Download below.
  }

  await rm(extractDir, rmWithRetriesOptions);
  await mkdir(cacheRoot, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const archiveHash = createHash("sha256").update(archiveBuffer).digest("hex");

  if (archiveHash !== dmgBuilderChecksum) {
    throw new Error(
      `Unexpected SHA-256 for ${dmgBuilderArchiveName}: ${archiveHash}`,
    );
  }

  await writeFile(archivePath, archiveBuffer);
  await mkdir(extractDir, { recursive: true });
  await run("tar", [
    "-xzf",
    archivePath,
    "-C",
    extractDir,
    "--strip-components",
    "1",
  ]);

  return dmgbuildPath;
}

async function stapleNotarizedAppBundles() {
  if (isUnsigned) {
    console.log("[dist:mac] skipping stapling in unsigned mode");
    return;
  }

  const releaseRoot = process.env.NEXU_DESKTOP_RELEASE_DIR
    ? resolve(process.env.NEXU_DESKTOP_RELEASE_DIR)
    : resolve(electronRoot, "release");
  const releaseEntries = await readdir(releaseRoot, { withFileTypes: true });
  const appBundleDirs = releaseEntries.filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === "mac" || entry.name.startsWith("mac-")),
  );

  if (appBundleDirs.length === 0) {
    throw new Error(
      `Expected packaged macOS app bundles under ${releaseRoot}, but none were found.`,
    );
  }

  for (const entry of appBundleDirs) {
    const appPath = resolve(releaseRoot, entry.name, "Nexu.app");

    console.log(`[dist:mac] stapling notarized app bundle: ${appPath}`);
    await run("xcrun", ["stapler", "staple", appPath], { cwd: electronRoot });
    await run("xcrun", ["stapler", "validate", appPath], {
      cwd: electronRoot,
    });
  }
}

async function validatePackagedQqbotDependencies(releaseRoot) {
  const appBundleDirs = await readdir(releaseRoot, { withFileTypes: true });
  const packagedMacBundles = appBundleDirs.filter(
    (entry) =>
      entry.isDirectory() &&
      (entry.name === "mac" || entry.name.startsWith("mac-")),
  );

  if (packagedMacBundles.length === 0) {
    throw new Error(
      `[dist:mac] expected packaged macOS app bundles under ${releaseRoot}, but none were found.`,
    );
  }

  for (const entry of packagedMacBundles) {
    const appRoot = resolve(releaseRoot, entry.name, "Nexu.app");
    const qqbotPluginRoot = resolve(
      appRoot,
      "Contents",
      "Resources",
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
        `[dist:mac] packaged app is missing openclaw-qqbot: ${qqbotPluginRoot}`,
      );
    }

    if (!(await pathExists(silkWasmPackagePath))) {
      throw new Error(
        `[dist:mac] packaged app is missing openclaw-qqbot dependency silk-wasm: ${silkWasmPackagePath}`,
      );
    }
  }
}

async function ensureBuildConfig() {
  const configPath = resolve(electronRoot, "build-config.json");
  const isCi =
    process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  let existingConfig = {};
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );

  if (isCi) {
    try {
      const existing = await readFile(configPath, "utf8");
      existingConfig = JSON.parse(existing);
      console.log("[dist:mac] preserving CI-generated build-config.json");
    } catch {
      // build-config.json is optional before generation in CI.
    }
  } else {
    try {
      await rm(configPath, { force: true });
      console.log(
        "[dist:mac] removed stale build-config.json before regeneration",
      );
    } catch {
      // Ignore cleanup failures and continue with regeneration.
    }
  }

  const envPath = resolve(electronRoot, ".env");
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(await readFile(envPath, "utf8"));
  } catch {
    // .env is optional
  }
  const merged = { ...fileEnv, ...process.env };
  const gitBranch = getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]);
  const gitCommit = getGitValue(["rev-parse", "HEAD"]);

  const defaultMetadata = {
    NEXU_DESKTOP_UPDATE_CHANNEL:
      merged.NEXU_DESKTOP_UPDATE_CHANNEL ??
      existingConfig.NEXU_DESKTOP_UPDATE_CHANNEL ??
      "stable",
    NEXU_DESKTOP_BUILD_SOURCE: merged.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dist",
    NEXU_DESKTOP_BUILD_BRANCH:
      merged.NEXU_DESKTOP_BUILD_BRANCH ?? (gitBranch || undefined),
    NEXU_DESKTOP_BUILD_COMMIT:
      merged.NEXU_DESKTOP_BUILD_COMMIT ?? (gitCommit || undefined),
    NEXU_DESKTOP_BUILD_TIME:
      merged.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
  };

  const config = {
    NEXU_DESKTOP_UPDATE_CHANNEL:
      merged.NEXU_DESKTOP_UPDATE_CHANNEL ??
      existingConfig.NEXU_DESKTOP_UPDATE_CHANNEL ??
      defaultMetadata.NEXU_DESKTOP_UPDATE_CHANNEL,
    ...((merged.NEXU_SENTRY_ENV ?? existingConfig.NEXU_SENTRY_ENV)
      ? {
          NEXU_SENTRY_ENV:
            merged.NEXU_SENTRY_ENV ?? existingConfig.NEXU_SENTRY_ENV,
        }
      : {}),
    NEXU_DESKTOP_APP_VERSION:
      merged.NEXU_DESKTOP_APP_VERSION ??
      existingConfig.NEXU_DESKTOP_APP_VERSION ??
      (typeof desktopPackage.version === "string"
        ? desktopPackage.version
        : undefined) ??
      merged.npm_package_version ??
      undefined,
    ...((merged.NEXU_DESKTOP_SENTRY_DSN ??
    existingConfig.NEXU_DESKTOP_SENTRY_DSN)
      ? {
          NEXU_DESKTOP_SENTRY_DSN:
            merged.NEXU_DESKTOP_SENTRY_DSN ??
            existingConfig.NEXU_DESKTOP_SENTRY_DSN,
        }
      : {}),
    ...((merged.NEXU_UPDATE_FEED_URL ?? existingConfig.NEXU_UPDATE_FEED_URL)
      ? {
          NEXU_UPDATE_FEED_URL: ensureArchScopedFeedUrl(
            merged.NEXU_UPDATE_FEED_URL ?? existingConfig.NEXU_UPDATE_FEED_URL,
          ),
        }
      : {}),
    ...((merged.NEXU_DESKTOP_AUTO_UPDATE_ENABLED ??
    existingConfig.NEXU_DESKTOP_AUTO_UPDATE_ENABLED)
      ? {
          NEXU_DESKTOP_AUTO_UPDATE_ENABLED:
            merged.NEXU_DESKTOP_AUTO_UPDATE_ENABLED ??
            existingConfig.NEXU_DESKTOP_AUTO_UPDATE_ENABLED,
        }
      : {}),
    NEXU_DESKTOP_BUILD_SOURCE:
      merged.NEXU_DESKTOP_BUILD_SOURCE ??
      existingConfig.NEXU_DESKTOP_BUILD_SOURCE ??
      defaultMetadata.NEXU_DESKTOP_BUILD_SOURCE,
    ...((merged.NEXU_DESKTOP_BUILD_BRANCH ??
    existingConfig.NEXU_DESKTOP_BUILD_BRANCH ??
    defaultMetadata.NEXU_DESKTOP_BUILD_BRANCH)
      ? {
          NEXU_DESKTOP_BUILD_BRANCH:
            merged.NEXU_DESKTOP_BUILD_BRANCH ??
            existingConfig.NEXU_DESKTOP_BUILD_BRANCH ??
            defaultMetadata.NEXU_DESKTOP_BUILD_BRANCH,
        }
      : {}),
    ...((merged.NEXU_DESKTOP_BUILD_COMMIT ??
    existingConfig.NEXU_DESKTOP_BUILD_COMMIT ??
    defaultMetadata.NEXU_DESKTOP_BUILD_COMMIT)
      ? {
          NEXU_DESKTOP_BUILD_COMMIT:
            merged.NEXU_DESKTOP_BUILD_COMMIT ??
            existingConfig.NEXU_DESKTOP_BUILD_COMMIT ??
            defaultMetadata.NEXU_DESKTOP_BUILD_COMMIT,
        }
      : {}),
    NEXU_DESKTOP_BUILD_TIME:
      merged.NEXU_DESKTOP_BUILD_TIME ??
      existingConfig.NEXU_DESKTOP_BUILD_TIME ??
      defaultMetadata.NEXU_DESKTOP_BUILD_TIME,
    ...((merged.POSTHOG_API_KEY ?? existingConfig.POSTHOG_API_KEY)
      ? {
          POSTHOG_API_KEY:
            merged.POSTHOG_API_KEY ?? existingConfig.POSTHOG_API_KEY,
        }
      : {}),
    ...((merged.POSTHOG_HOST ?? existingConfig.POSTHOG_HOST)
      ? {
          POSTHOG_HOST: merged.POSTHOG_HOST ?? existingConfig.POSTHOG_HOST,
        }
      : {}),
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(
    "[dist:mac] generated build-config.json from env:",
    JSON.stringify(config),
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

async function main() {
  const timings = [];
  if (buildTargetPlatform !== "mac") {
    throw new Error(
      `[dist:mac] mac packaging must run with target platform "mac": host=${process.platform}, target=${buildTargetPlatform}, arch=${targetMacArch}.`,
    );
  }

  if (process.arch !== targetMacArch) {
    throw new Error(
      `[dist:mac] Cross-arch mac packaging is not supported yet: host=${process.arch}, target=${targetMacArch}. Runtime sidecars embed host-native binaries, so build on a matching macOS host instead. For Intel validation, run pnpm dist:mac:unsigned:x64 on an Intel Mac after openclaw-runtime pruning removes clipboard natives and any optional DAVE binaries you intentionally disabled.`,
    );
  }

  await timedStep(
    "ensure build config",
    async () => ensureBuildConfig(),
    timings,
  );

  const desktopEnv = await loadDesktopEnv();
  const env = {
    ...process.env,
    ...desktopEnv,
    NEXU_WORKSPACE_ROOT: repoRoot,
  };
  const releaseRoot = env.NEXU_DESKTOP_RELEASE_DIR
    ? resolve(env.NEXU_DESKTOP_RELEASE_DIR)
    : resolve(electronRoot, "release");
  const {
    APPLE_ID: appleId,
    APPLE_APP_SPECIFIC_PASSWORD: appleAppSpecificPassword,
    APPLE_TEAM_ID: appleTeamId,
    ...notarizeEnv
  } = env;

  if (appleId) {
    notarizeEnv.NEXU_APPLE_ID = appleId;
  }

  if (appleAppSpecificPassword) {
    notarizeEnv.NEXU_APPLE_APP_SPECIFIC_PASSWORD = appleAppSpecificPassword;
  }

  if (appleTeamId) {
    notarizeEnv.NEXU_APPLE_TEAM_ID = appleTeamId;
  }

  await timedStep(
    "clean release directories",
    async () => {
      await rm(releaseRoot, rmWithRetriesOptions);
      await rm(resolve(electronRoot, ".dist-runtime"), rmWithRetriesOptions);
    },
    timings,
  );

  await timedStep(
    "build @nexu/shared",
    async () => {
      if (shouldReuseExistingBuildArtifacts) {
        await ensureExistingBuildArtifacts();
        console.log("[dist:mac] reusing existing workspace build artifacts");
        return;
      }
      await run(
        "pnpm",
        ["--dir", repoRoot, "--filter", "@nexu/shared", "build"],
        {
          env,
        },
      );
    },
    timings,
  );
  await timedStep(
    "build @nexu/controller",
    async () => {
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await run(
        "pnpm",
        ["--dir", repoRoot, "--filter", "@nexu/controller", "build"],
        { env },
      );
    },
    timings,
  );
  await timedStep(
    "install openclaw-runtime",
    async () => {
      if (shouldReuseExistingRuntimeInstall) {
        await ensureExistingRuntimeInstall();
        console.log("[dist:mac] reusing existing openclaw-runtime install");
        return;
      }
      await run("pnpm", ["--dir", repoRoot, "openclaw-runtime:install"], {
        env,
      });
    },
    timings,
  );
  await timedStep(
    "build @nexu/web",
    async () => {
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/web", "build"], {
        env,
      });
    },
    timings,
  );
  await timedStep(
    "build @nexu/desktop",
    async () => {
      if (shouldReuseExistingBuildArtifacts) {
        return;
      }
      await run("pnpm", ["run", "build"], { cwd: electronRoot, env });
    },
    timings,
  );
  await timedStep(
    "upload sourcemaps",
    async () => {
      await run("node", [resolve(scriptDir, "upload-sourcemaps.mjs")], {
        cwd: electronRoot,
        env,
      });
    },
    timings,
  );
  await timedStep(
    "prepare runtime sidecars",
    async () => {
      await run(
        "node",
        [resolve(scriptDir, "prepare-runtime-sidecars.mjs"), "--release"],
        {
          cwd: electronRoot,
          env: {
            ...env,
            ...(isUnsigned ? { NEXU_DESKTOP_MAC_UNSIGNED: "true" } : {}),
          },
        },
      );
    },
    timings,
  );
  if (shouldBootstrapDmgTooling()) {
    env.CUSTOM_DMGBUILD_PATH = await timedStep(
      "ensure dmgbuild bundle",
      async () => ensureDmgbuildBundle(),
      timings,
    );
  }

  await timedStep(
    "dereference pnpm symlinks",
    async () => dereferencePnpmSymlinks(),
    timings,
  );

  // Use git short SHA as CFBundleVersion (shown in parentheses in About dialog).
  // Falls back to "dev" for local builds outside a git repo.
  let buildVersion = "dev";
  const electronVersion = await getElectronVersion();
  const electronDistPath = await resolveElectronDistPath();
  try {
    buildVersion = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a git repo or git not available — use fallback.
  }

  await timedStep(
    "run electron-builder",
    async () => {
      const electronBuilderArgs = [
        "--mac",
        ...(macTargets ?? []),
        `--${targetMacArch}`,
        "--publish",
        "never",
        `--config.electronVersion=${electronVersion}`,
        ...(electronDistPath
          ? [`--config.electronDist=${electronDistPath}`]
          : []),
        `--config.buildVersion=${buildVersion}`,
        `--config.directories.output=${releaseRoot}`,
        ...(isFastCiMode
          ? ["--config.npmRebuild=false", "--config.nodeGypRebuild=false"]
          : []),
        ...(isUnsigned
          ? ["--config.mac.identity=null", "--config.mac.hardenedRuntime=false"]
          : []),
      ];
      console.log(
        `[dist:mac] electron-builder mode targets=${(macTargets ?? ["default"]).join(",")} fastCi=${isFastCiMode}`,
      );
      await runElectronBuilder(electronBuilderArgs, {
        cwd: electronRoot,
        env: isUnsigned
          ? {
              ...notarizeEnv,
              CSC_IDENTITY_AUTO_DISCOVERY: "false",
              NEXU_DESKTOP_MAC_UNSIGNED: "true",
            }
          : notarizeEnv,
      });
    },
    timings,
  );
  await timedStep(
    "validate packaged qqbot dependencies",
    async () => validatePackagedQqbotDependencies(releaseRoot),
    timings,
  );
  await timedStep(
    "staple notarized app bundles",
    async () => stapleNotarizedAppBundles(),
    timings,
  );

  const totalDurationMs = timings.reduce(
    (sum, timing) => sum + timing.durationMs,
    0,
  );
  const summaryLines = [
    `## dist:mac timing (${targetMacArch})`,
    "",
    "| Step | Duration |",
    "| --- | ---: |",
    ...timings.map(
      (timing) =>
        `| ${timing.stepName} | ${formatDurationMs(timing.durationMs)} |`,
    ),
    `| **Total** | **${formatDurationMs(totalDurationMs)}** |`,
  ];
  console.log("[dist:mac][timing] summary");
  for (const line of summaryLines) {
    console.log(line);
  }
  await appendTimingSummary(summaryLines);
}

await main();
