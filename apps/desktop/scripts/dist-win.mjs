import { execFileSync, spawn } from "node:child_process";
import { cp, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const desktopPackageJsonPath = resolve(electronRoot, "package.json");
const require = createRequire(import.meta.url);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function createCommandSpec(command, args) {
  if (
    process.platform === "win32" &&
    (command === "pnpm" || command === "pnpm.cmd")
  ) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", ["pnpm", ...args].join(" ")],
    };
  }

  return { command, args };
}

const rmWithRetriesOptions = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
};

async function dereferencePnpmSymlinks() {
  const sharpPath = resolve(electronRoot, "node_modules/sharp");
  const imgPath = resolve(electronRoot, "node_modules/@img");
  let pnpmImgPath = null;

  try {
    const sharpStat = await lstat(sharpPath);
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
  } catch (error) {
    console.log(
      `[dist:win] skipping sharp: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const sharpImgPath = pnpmImgPath ?? resolve(sharpPath, "node_modules/@img");
    const sharpImgStat = await lstat(sharpImgPath).catch(() => null);
    if (sharpImgStat) {
      console.log(
        `[dist:win] copying @img from sharp's node_modules: ${sharpImgPath} -> ${imgPath}`,
      );
      await rm(imgPath, rmWithRetriesOptions);
      await cp(sharpImgPath, imgPath, { recursive: true, dereference: true });
    }
  } catch (error) {
    console.log(
      `[dist:win] skipping @img: ${error instanceof Error ? error.message : String(error)}`,
    );
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

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
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

async function runElectronBuilder(args, options = {}) {
  const electronBuilderCli = require.resolve("electron-builder/cli.js", {
    paths: [electronRoot, repoRoot],
  });
  await run(process.execPath, [electronBuilderCli, ...args], options);
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
  const rawArgs = new Set(process.argv.slice(2));
  const dirOnly = rawArgs.has("--dir-only") || rawArgs.has("--target=dir");
  const env = {
    ...process.env,
    NEXU_WORKSPACE_ROOT: repoRoot,
  };
  const releaseRoot = process.env.NEXU_DESKTOP_RELEASE_DIR
    ? resolve(process.env.NEXU_DESKTOP_RELEASE_DIR)
    : resolve(electronRoot, "release");

  await rm(releaseRoot, rmWithRetriesOptions);
  await rm(resolve(electronRoot, ".dist-runtime"), rmWithRetriesOptions);

  await run(
    pnpmCommand,
    ["--dir", repoRoot, "--filter", "@nexu/shared", "build"],
    { env },
  );
  await run(
    pnpmCommand,
    ["--dir", repoRoot, "--filter", "@nexu/controller", "build"],
    { env },
  );
  await run(pnpmCommand, ["--dir", repoRoot, "openclaw-runtime:install"], {
    env,
  });
  await run(
    pnpmCommand,
    ["--dir", repoRoot, "--filter", "@nexu/web", "build"],
    { env },
  );
  await run(pnpmCommand, ["run", "build"], { cwd: electronRoot, env });
  await run(
    "node",
    [resolve(scriptDir, "prepare-runtime-sidecars.mjs"), "--release"],
    {
      cwd: electronRoot,
      env,
    },
  );
  await ensureBuildConfig();
  await dereferencePnpmSymlinks();

  let buildVersion = "dev";
  const electronVersion = await getElectronVersion();
  try {
    buildVersion = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {}

  await runElectronBuilder(
    [
      "--win",
      ...(dirOnly ? ["dir"] : ["nsis", "dir"]),
      "--publish",
      "never",
      `--config.electronVersion=${electronVersion}`,
      `--config.buildVersion=${buildVersion}`,
      `--config.directories.output=${releaseRoot}`,
      ...(dirOnly ? ["--config.win.signAndEditExecutable=false"] : []),
    ],
    {
      cwd: electronRoot,
      env: {
        ...env,
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      },
    },
  );
}

await main();
