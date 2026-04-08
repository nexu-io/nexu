import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const releaseDir = resolve(
  process.env.PACKAGED_RELEASE_DIR ??
    process.env.NEXU_DESKTOP_RELEASE_DIR ??
    "apps/desktop/release",
);
const captureDir =
  process.env.NEXU_DESKTOP_CHECK_CAPTURE_DIR ?? ".tmp/desktop-ci-test";
const tmpDir = resolve(
  process.env.NEXU_DESKTOP_CHECK_TMPDIR ??
    process.env.TMPDIR ??
    process.env.TEMP ??
    ".tmp/desktop-tmp",
);

function resolvePath(value) {
  return resolve(repoRoot, value);
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: repoRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
      detached: options.detached ?? false,
      windowsHide: true,
    });

    child.once("error", (error) => {
      resolveRun({ code: 1, error, pid: null });
    });

    if (options.detached) {
      resolveRun({ code: 0, error: null, pid: child.pid ?? null, child });
      return;
    }

    child.once("exit", (code) => {
      resolveRun({ code: code ?? 1, error: null, pid: child.pid ?? null });
    });
  });
}

function getDefaultPaths() {
  const packagedUserDataDir = resolvePath(
    process.env.PACKAGED_USER_DATA_DIR ??
      (process.platform === "win32"
        ? "./.tmp/desktop-dist-user-data"
        : "./.tmp/desktop-dist-home/@nexu/desktop"),
  );
  const packagedLogsDir = resolvePath(
    process.env.PACKAGED_LOGS_DIR ?? `${packagedUserDataDir}/logs`,
  );
  const packagedRuntimeLogsDir = resolvePath(
    process.env.PACKAGED_RUNTIME_LOGS_DIR ?? `${packagedLogsDir}/runtime-units`,
  );
  const packagedHome = resolvePath(
    process.env.PACKAGED_HOME ?? "./.tmp/desktop-dist-home",
  );

  return {
    packagedHome,
    packagedUserDataDir,
    packagedLogsDir,
    packagedRuntimeLogsDir,
    defaultUserDataDir: process.env.DEFAULT_USER_DATA_DIR
      ? resolvePath(process.env.DEFAULT_USER_DATA_DIR)
      : packagedUserDataDir,
    defaultLogsDir: process.env.DEFAULT_LOGS_DIR
      ? resolvePath(process.env.DEFAULT_LOGS_DIR)
      : packagedLogsDir,
    defaultRuntimeLogsDir: process.env.DEFAULT_RUNTIME_LOGS_DIR
      ? resolvePath(process.env.DEFAULT_RUNTIME_LOGS_DIR)
      : packagedRuntimeLogsDir,
  };
}

async function resolvePackagedExecutable() {
  if (process.env.PACKAGED_EXECUTABLE) {
    return resolvePath(process.env.PACKAGED_EXECUTABLE);
  }

  if (process.platform === "win32") {
    return resolve(releaseDir, "win-unpacked", "Nexu.exe");
  }

  const defaultMacExecutable = resolve(
    releaseDir,
    "Nexu.app",
    "Contents",
    "MacOS",
    "Nexu",
  );

  if (await fileExists(defaultMacExecutable)) {
    return defaultMacExecutable;
  }

  const releaseEntries = await readdir(releaseDir, { withFileTypes: true });

  for (const entry of releaseEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith("mac-")) {
      continue;
    }

    const macExecutable = resolve(
      releaseDir,
      entry.name,
      "Nexu.app",
      "Contents",
      "MacOS",
      "Nexu",
    );

    if (await fileExists(macExecutable)) {
      return macExecutable;
    }
  }

  return defaultMacExecutable;
}

async function main() {
  const paths = getDefaultPaths();
  const packagedExecutable = await resolvePackagedExecutable();

  if (!(await fileExists(packagedExecutable))) {
    throw new Error(`Packaged executable is missing: ${packagedExecutable}`);
  }

  const pidPath = resolvePath(`${captureDir}/packaged-app.pid`);
  const packagedLogPath = resolvePath(`${captureDir}/packaged-app.log`);
  await mkdir(resolvePath(captureDir), { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  await mkdir(paths.packagedHome, { recursive: true });
  const env = {
    ...process.env,
    PACKAGED_HOME: paths.packagedHome,
    PACKAGED_EXECUTABLE: packagedExecutable,
    PACKAGED_LOGS_DIR: paths.packagedLogsDir,
    PACKAGED_USER_DATA_DIR: paths.packagedUserDataDir,
    PACKAGED_RUNTIME_LOGS_DIR: paths.packagedRuntimeLogsDir,
    DEFAULT_LOGS_DIR: paths.defaultLogsDir,
    DEFAULT_USER_DATA_DIR: paths.defaultUserDataDir,
    DEFAULT_RUNTIME_LOGS_DIR: paths.defaultRuntimeLogsDir,
    NEXU_DESKTOP_PACKAGED_PID_PATH: pidPath,
    NEXU_DESKTOP_USER_DATA_ROOT: paths.packagedUserDataDir,
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
  };

  if (process.platform === "win32") {
    env.APPDATA = paths.packagedHome;
    env.LOCALAPPDATA = paths.packagedHome;
    env.USERPROFILE = paths.packagedHome;
  } else {
    env.HOME = paths.packagedHome;
  }

  const packagedLogHandle = await open(packagedLogPath, "a");
  const launchResult = await run(packagedExecutable, [], {
    env,
    stdio: ["ignore", packagedLogHandle.fd, packagedLogHandle.fd],
    detached: true,
  });
  await packagedLogHandle.close();

  if (launchResult.error || !launchResult.pid) {
    throw (
      launchResult.error ?? new Error("Unable to launch packaged desktop app.")
    );
  }

  await writeFile(pidPath, `${String(launchResult.pid)}\n`, "utf8");
  launchResult.child?.unref();

  const checkResult = await run(
    "node",
    ["scripts/desktop-ci-check.mjs", "dist", "--capture-dir", captureDir],
    { env },
  );

  const pid = String(launchResult.pid);
  const stopCommand = process.platform === "win32" ? "taskkill" : "kill";
  const stopArgs =
    process.platform === "win32" ? ["/PID", pid, "/T", "/F"] : [pid];
  await run(stopCommand, stopArgs, { env });

  process.exit(checkResult.code);
}

await main();
