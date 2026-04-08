import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot =
  process.env.NEXU_WORKSPACE_ROOT ?? resolve(electronRoot, "../..");
const desktopPackageJsonPath = resolve(electronRoot, "package.json");
const vendored7zExePath = resolve(
  electronRoot,
  "vendor",
  "7zip",
  "win-x64",
  "7z.exe",
);
const vendored7zDllPath = resolve(
  electronRoot,
  "vendor",
  "7zip",
  "win-x64",
  "7z.dll",
);

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

async function timedStep(stepName, fn, timings) {
  const startedAt = performance.now();
  console.log(`[dist:win][step] start ${stepName}`);
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - startedAt;
    timings.push({ stepName, durationMs });
    console.log(
      `[dist:win][step] done ${stepName} duration=${formatDurationMs(durationMs)}`,
    );
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
      shell: false,
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

function resolvePathCommand(candidates, probeArgs = ["/VERSION"]) {
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, probeArgs, {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "ignore"],
      });
      return candidate;
    } catch {}
  }

  return null;
}

function resolveMakensisCommand() {
  const command = resolvePathCommand([
    "makensis.exe",
    "makensis",
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
  ]);
  if (!command) {
    throw new Error(
      "[dist:win] makensis is required. Install NSIS or add makensis.exe to PATH.",
    );
  }
  return command;
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readDesktopPackageVersion() {
  const desktopPackage = JSON.parse(
    await readFile(desktopPackageJsonPath, "utf8"),
  );
  if (
    typeof desktopPackage.version !== "string" ||
    desktopPackage.version.length === 0
  ) {
    throw new Error(`[dist:win] missing version in ${desktopPackageJsonPath}`);
  }
  return desktopPackage.version;
}

function parsePhaseArg(argv) {
  const supportedPhases = new Set(["all", "stage", "payload", "installer"]);
  const phaseArg = argv.find((arg) => arg.startsWith("--phase="));
  const phase = phaseArg ? phaseArg.slice("--phase=".length) : "all";
  if (!supportedPhases.has(phase)) {
    throw new Error(
      `[dist:win] unsupported phase ${JSON.stringify(phase)}. Use --phase=all|stage|payload|installer.`,
    );
  }
  return phase;
}

async function main() {
  const timings = [];
  const phase = parsePhaseArg(process.argv.slice(2));
  const buildTargetPlatform = resolveBuildTargetPlatform({
    env: process.env,
    platform: process.platform,
  });
  if (buildTargetPlatform !== "win") {
    throw new Error(
      `[dist:win] Windows packaging must run with target platform \"win\": host=${process.platform}, target=${buildTargetPlatform}.`,
    );
  }

  const makensisCommand = resolveMakensisCommand();
  const version = await readDesktopPackageVersion();
  const releaseRoot = resolve(electronRoot, "release");
  const winUnpackedDir = resolve(releaseRoot, "win-unpacked");
  const installerRoot = resolve(releaseRoot, "win-installer");
  const payloadRoot = resolve(installerRoot, "payload");
  const payloadPath = resolve(payloadRoot, "payload.7z");
  const installerPath = resolve(releaseRoot, `nexu-setup-${version}-x64.exe`);
  const installerScriptPath = resolve(
    electronRoot,
    "build",
    "win-installer.nsi",
  );
  const iconPath = resolve(electronRoot, "build", "icon.ico");
  const timingLogPath = resolve(installerRoot, "timing.json");
  if (!(await pathExists(vendored7zExePath))) {
    throw new Error(
      `[dist:win] missing vendored 7-Zip executable: ${vendored7zExePath}`,
    );
  }
  if (!(await pathExists(vendored7zDllPath))) {
    throw new Error(
      `[dist:win] missing vendored 7-Zip DLL: ${vendored7zDllPath}`,
    );
  }

  console.log(`[dist:win] using 7-Zip CLI: ${vendored7zExePath}`);
  console.log(`[dist:win] using vendored 7z.exe: ${vendored7zExePath}`);
  console.log(`[dist:win] using vendored 7z.dll: ${vendored7zDllPath}`);
  console.log(`[dist:win] using makensis: ${makensisCommand}`);
  console.log(`[dist:win] selected phase: ${phase}`);

  if (phase === "all") {
    await timedStep(
      "clean installer release root",
      async () => {
        await rm(installerRoot, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
        await mkdir(payloadRoot, { recursive: true });
      },
      timings,
    );
  } else {
    await mkdir(payloadRoot, { recursive: true });
  }

  if (phase === "all" || phase === "stage") {
    await timedStep(
      "stage win-unpacked via dist-win-stage.mjs --local",
      async () => {
        console.log(
          "[dist:win] staging win-unpacked via dist-win-stage.mjs --local",
        );
        await run(
          process.execPath,
          [resolve(scriptDir, "dist-win-stage.mjs"), "--local"],
          {
            cwd: electronRoot,
            env: process.env,
          },
        );
      },
      timings,
    );
  }

  if (!(await pathExists(winUnpackedDir))) {
    throw new Error(`[dist:win] missing win-unpacked stage: ${winUnpackedDir}`);
  }

  if (phase === "all" || phase === "payload") {
    await timedStep(
      "create payload.7z from win-unpacked contents",
      async () => {
        console.log(
          "[dist:win] creating payload.7z from win-unpacked contents",
        );
        await rm(payloadPath, { force: true, maxRetries: 5, retryDelay: 200 });
        await run(
          vendored7zExePath,
          ["a", "-t7z", "-mx=1", "-ms=off", payloadPath, ".\\*"],
          {
            cwd: winUnpackedDir,
            env: process.env,
          },
        );
      },
      timings,
    );
  }

  if (
    (phase === "all" || phase === "installer") &&
    !(await pathExists(payloadPath))
  ) {
    throw new Error(`[dist:win] missing payload archive: ${payloadPath}`);
  }

  if (phase === "all" || phase === "installer") {
    await timedStep(
      "compile standalone NSIS installer",
      async () => {
        console.log("[dist:win] compiling standalone NSIS installer");
        await rm(installerPath, {
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
        await run(
          makensisCommand,
          [
            "/V4",
            `/DAPP_VERSION=${version}`,
            "/DPRODUCT_NAME=Nexu",
            `/DOUTPUT_EXE=${installerPath}`,
            `/DPAYLOAD_7Z=${payloadPath}`,
            `/DSEVEN_Z_EXE=${vendored7zExePath}`,
            `/DSEVEN_Z_DLL=${vendored7zDllPath}`,
            `/DAPP_ICON=${iconPath}`,
            installerScriptPath,
          ],
          {
            cwd: electronRoot,
            env: process.env,
          },
        );
      },
      timings,
    );
  }

  await writeFile(
    timingLogPath,
    JSON.stringify(
      {
        version,
        phase,
        payloadPath,
        installerPath,
        timings: timings.map((entry) => ({
          ...entry,
          durationText: formatDurationMs(entry.durationMs),
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("[dist:win][timing] summary");
  for (const timing of timings) {
    console.log(
      `[dist:win][timing] ${timing.stepName}=${formatDurationMs(timing.durationMs)}`,
    );
  }

  console.log(`[dist:win] done: ${installerPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
