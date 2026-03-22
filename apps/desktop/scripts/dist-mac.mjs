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
const dmgBuilderReleaseName = "dmg-builder@1.2.0";
const dmgBuilderReleaseVersion = "75c8a6c";
const dmgBuilderArch = process.arch === "arm64" ? "arm64" : "x86_64";
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

async function runElectronBuilder(args, options = {}) {
  const electronBuilderCli = require.resolve("electron-builder/cli.js", {
    paths: [electronRoot, repoRoot],
  });
  const targetOpenFiles = process.env.NEXU_DESKTOP_MAX_OPEN_FILES ?? "8192";
  const command = [
    `target=${shellEscape(targetOpenFiles)}`,
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
    (entry) => entry.isDirectory() && entry.name.startsWith("mac-"),
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
    NEXU_DESKTOP_BUILD_SOURCE: merged.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dist",
    NEXU_DESKTOP_BUILD_BRANCH:
      merged.NEXU_DESKTOP_BUILD_BRANCH ?? (gitBranch || undefined),
    NEXU_DESKTOP_BUILD_COMMIT:
      merged.NEXU_DESKTOP_BUILD_COMMIT ?? (gitCommit || undefined),
    NEXU_DESKTOP_BUILD_TIME:
      merged.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
  };

  const config = {
    NEXU_CLOUD_URL:
      merged.NEXU_CLOUD_URL ??
      existingConfig.NEXU_CLOUD_URL ??
      "https://nexu.io",
    NEXU_LINK_URL: merged.NEXU_LINK_URL ?? existingConfig.NEXU_LINK_URL ?? null,
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
          NEXU_UPDATE_FEED_URL:
            merged.NEXU_UPDATE_FEED_URL ?? existingConfig.NEXU_UPDATE_FEED_URL,
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
  await ensureBuildConfig();

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

  const controllerPort =
    process.env.NEXU_CONTROLLER_PORT ?? process.env.NEXU_API_PORT ?? "50800";

  await rm(releaseRoot, rmWithRetriesOptions);
  await rm(resolve(electronRoot, ".dist-runtime"), rmWithRetriesOptions);

  await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/shared", "build"], {
    env,
  });
  await run(
    "pnpm",
    ["--dir", repoRoot, "--filter", "@nexu/controller", "build"],
    {
      env,
    },
  );
  await run("pnpm", ["--dir", repoRoot, "openclaw-runtime:install"], {
    env,
  });
  await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/web", "build"], {
    env: {
      ...env,
      VITE_API_BASE_URL: `http://127.0.0.1:${controllerPort}`,
      VITE_AUTH_BASE_URL: `http://127.0.0.1:${controllerPort}`,
    },
  });
  await run("pnpm", ["run", "build"], { cwd: electronRoot, env });
  await run("node", [resolve(scriptDir, "upload-sourcemaps.mjs")], {
    cwd: electronRoot,
    env,
  });
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
  env.CUSTOM_DMGBUILD_PATH = await ensureDmgbuildBundle();

  // Dereference pnpm symlinks before electron-builder runs
  await dereferencePnpmSymlinks();

  // Use git short SHA as CFBundleVersion (shown in parentheses in About dialog).
  // Falls back to "dev" for local builds outside a git repo.
  let buildVersion = "dev";
  const electronVersion = await getElectronVersion();
  try {
    buildVersion = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // Not a git repo or git not available — use fallback.
  }

  await runElectronBuilder(
    [
      "--mac",
      "--publish",
      "never",
      `--config.electronVersion=${electronVersion}`,
      `--config.buildVersion=${buildVersion}`,
      `--config.directories.output=${releaseRoot}`,
      ...(isUnsigned
        ? ["--config.mac.identity=null", "--config.mac.hardenedRuntime=false"]
        : []),
    ],
    {
      cwd: electronRoot,
      env: isUnsigned
        ? {
            ...notarizeEnv,
            CSC_IDENTITY_AUTO_DISCOVERY: "false",
            NEXU_DESKTOP_MAC_UNSIGNED: "true",
          }
        : notarizeEnv,
    },
  );
  await stapleNotarizedAppBundles();
}

await main();
