import { execFileSync, spawn } from "node:child_process";
import { cp, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

const buildTargetPlatform = resolveBuildTargetPlatform({
  env: process.env,
  platform: process.platform,
});

if (buildTargetPlatform !== "linux") {
  throw new Error(
    `[dist:linux] Linux packaging must run with target platform "linux": host=${process.platform}, target=${buildTargetPlatform}.`,
  );
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

/**
 * Dereference pnpm symlinks for extraResources that electron-builder
 * copies into the bundle. Without this, symlinks point to non-existent
 * paths in the final AppImage, breaking the packaged application.
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
        `[dist:linux] dereferencing pnpm symlink: ${sharpPath} -> ${realSharpPath}`,
      );
      await rm(sharpPath, rmWithRetriesOptions);
      await cp(realSharpPath, sharpPath, {
        recursive: true,
        dereference: true,
      });
    }
  } catch (err) {
    console.log(`[dist:linux] skipping sharp: ${err.message}`);
  }

  // Then, copy @img from sharp's node_modules to top-level if it doesn't exist
  // (pnpm hoists @img inside sharp's node_modules, not at top level)
  try {
    const sharpImgPath = pnpmImgPath ?? resolve(sharpPath, "node_modules/@img");
    const sharpImgStat = await lstat(sharpImgPath).catch(() => null);

    if (sharpImgStat) {
      console.log(
        `[dist:linux] copying @img from sharp's node_modules: ${sharpImgPath} -> ${imgPath}`,
      );
      await rm(imgPath, rmWithRetriesOptions);
      await cp(sharpImgPath, imgPath, { recursive: true, dereference: true });
    } else {
      console.log(`[dist:linux] @img not found in sharp's node_modules`);
    }
  } catch (err) {
    console.log(`[dist:linux] skipping @img: ${err.message}`);
  }
}

function parseEnvFile(content) {
  const values = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([^=]+)=(.*)$/u);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    let value = match[2].trim();
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

async function ensureBuildConfig() {
  const configPath = resolve(electronRoot, "build-config.json");
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );

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

  const config = {
    NEXU_DESKTOP_UPDATE_CHANNEL: merged.NEXU_DESKTOP_UPDATE_CHANNEL ?? "stable",
    NEXU_DESKTOP_APP_VERSION:
      merged.NEXU_DESKTOP_APP_VERSION ?? desktopPackage.version,
    NEXU_DESKTOP_BUILD_SOURCE: merged.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dist",
    NEXU_DESKTOP_BUILD_BRANCH:
      merged.NEXU_DESKTOP_BUILD_BRANCH ?? (gitBranch || undefined),
    NEXU_DESKTOP_BUILD_COMMIT:
      merged.NEXU_DESKTOP_BUILD_COMMIT ?? (gitCommit || undefined),
    NEXU_DESKTOP_BUILD_TIME:
      merged.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function timedStep(stepName, fn, timings) {
  const startedAt = performance.now();
  console.log(`[dist:linux][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - startedAt;
    timings.push({ stepName, durationMs });
    console.log(
      `[dist:linux][timing] done ${stepName} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

async function main() {
  const timings = [];
  const env = { ...process.env, NEXU_WORKSPACE_ROOT: repoRoot };
  const releaseRoot = process.env.NEXU_DESKTOP_RELEASE_DIR
    ? resolve(process.env.NEXU_DESKTOP_RELEASE_DIR)
    : resolve(electronRoot, "release");
  const runtimeDistRoot = resolve(electronRoot, ".dist-runtime");

  await timedStep(
    "clean release directories",
    async () => {
      await rm(releaseRoot, rmWithRetriesOptions);
      await rm(runtimeDistRoot, rmWithRetriesOptions);
    },
    timings,
  );

  await timedStep(
    "build shared workspace steps",
    async () => {
      await run(
        "pnpm",
        ["--dir", repoRoot, "--filter", "@nexu/dev-utils", "build"],
        { env },
      );
      await run(
        "pnpm",
        ["--dir", repoRoot, "--filter", "@nexu/shared", "build"],
        { env },
      );
      await run(
        "pnpm",
        ["--dir", repoRoot, "--filter", "@nexu/controller", "build"],
        { env },
      );
      await run("pnpm", ["--dir", repoRoot, "slimclaw:prepare"], { env });
    },
    timings,
  );

  await timedStep(
    "build @nexu/web",
    async () => {
      await run("pnpm", ["--dir", repoRoot, "--filter", "@nexu/web", "build"], {
        env: { ...env, VITE_DESKTOP_PLATFORM: "linux" },
      });
    },
    timings,
  );

  await timedStep(
    "build @nexu/desktop",
    async () => {
      await run(
        "pnpm",
        ["--dir", repoRoot, "--filter", "@nexu/desktop", "build"],
        { env },
      );
    },
    timings,
  );

  await timedStep(
    "package runtime sidecars",
    async () => {
      await run("pnpm", ["--dir", electronRoot, "package:sidecars"], { env });
    },
    timings,
  );

  await timedStep(
    "dereference pnpm symlinks",
    async () => dereferencePnpmSymlinks(),
    timings,
  );

  await timedStep(
    "generate build config",
    async () => {
      await ensureBuildConfig();
    },
    timings,
  );

  const electronPackageJsonPath = require.resolve("electron/package.json", {
    paths: [electronRoot, repoRoot],
  });
  const electronVersion = JSON.parse(
    await readFile(electronPackageJsonPath, "utf8"),
  ).version;

  await timedStep(
    "run electron-builder",
    async () => {
      const builderArgs = [
        "--linux",
        "AppImage",
        "--publish",
        "never",
        `--config.electronVersion=${electronVersion}`,
        `--config.directories.output=${releaseRoot}`,
      ];
      await runElectronBuilder(builderArgs, {
        cwd: electronRoot,
        env,
      });
    },
    timings,
  );

  console.log("[dist:linux][timing] summary");
  for (const timing of timings) {
    console.log(
      `[dist:linux][timing] ${timing.stepName}=${formatDurationMs(timing.durationMs)}`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
