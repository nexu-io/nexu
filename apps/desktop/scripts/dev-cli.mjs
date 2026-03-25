import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = resolve(scriptPath, "..");
const appDir = resolve(scriptDir, "..");
const rootDir = resolve(appDir, "../..");
const tmpDir = resolve(rootDir, ".tmp");
const runtimeRoot = resolve(tmpDir, "desktop");
const logDir = resolve(tmpDir, "logs");
const lockDir = resolve(tmpDir, "locks", "desktop-dev.lock");
const lockInfoFile = resolve(lockDir, "owner.json");
const logFile = resolve(logDir, "desktop-dev.log");
const timelineFile = resolve(logDir, "desktop-startup-timeline.log");
const managerDir = resolve(runtimeRoot, "manager");
const stateFile = resolve(managerDir, "state.json");
const defaultPorts = [18789, 50800, 50810];
const cliFlags = new Set(process.argv.slice(3));
const sidecarRoot = resolve(rootDir, ".tmp", "sidecars");

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const gitCommand = process.platform === "win32" ? "git.exe" : "git";
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

function timestamp() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function stripTerminalControl(input) {
  let result = "";

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);

    if (code === 0x1b) {
      const next = input[index + 1];

      if (next === "[") {
        index += 2;
        while (index < input.length) {
          const current = input.charCodeAt(index);
          if (current >= 0x40 && current <= 0x7e) {
            break;
          }
          index += 1;
        }
        continue;
      }

      if (next === "]") {
        index += 2;
        while (index < input.length) {
          const current = input.charCodeAt(index);
          if (current === 0x07) {
            break;
          }
          if (current === 0x1b && input[index + 1] === "\\") {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }

      continue;
    }

    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code !== 0x7f)
    ) {
      result += input[index];
    }
  }

  return result;
}

function isEnvFlagEnabled(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function shouldForceFullStart() {
  return (
    cliFlags.has("--force-full-build") ||
    isEnvFlagEnabled("NEXU_DESKTOP_FORCE_FULL_START")
  );
}

function shouldReuseBuildArtifacts() {
  if (shouldForceFullStart()) {
    return false;
  }

  if (cliFlags.has("--no-reuse-build")) {
    return false;
  }

  return !isEnvFlagEnabled("NEXU_DESKTOP_DISABLE_BUILD_REUSE");
}

function createLauncherEnv() {
  return {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CLICOLOR: "0",
    npm_config_color: "false",
    ...(shouldForceFullStart()
      ? {
          NEXU_DESKTOP_FORCE_FULL_START: "1",
        }
      : {}),
  };
}

async function appendLine(filePath, message) {
  await appendFile(
    filePath,
    `[${timestamp()}] ${stripTerminalControl(message)}\n`,
  );
}

async function log(message) {
  console.log(`[${timestamp()}] ${message}`);
  await appendLine(logFile, message);
}

async function runTimedPhase(label, action) {
  const startedAt = Date.now();
  await log(`phase:start ${label}`);
  try {
    const result = await action();
    await log(`phase:done ${label} durationMs=${Date.now() - startedAt}`);
    return result;
  } catch (error) {
    await log(`phase:fail ${label} durationMs=${Date.now() - startedAt}`);
    throw error;
  }
}

async function logTimeline(message) {
  await appendLine(timelineFile, message);
}

async function ensureBaseDirs() {
  await mkdir(logDir, { recursive: true });
  await mkdir(managerDir, { recursive: true });
  await mkdir(resolve(tmpDir, "locks"), { recursive: true });
}

function validateWorkspaceLayout() {
  if (
    !existsSync(resolve(rootDir, "package.json")) ||
    !existsSync(resolve(appDir, "package.json"))
  ) {
    throw new Error(
      [
        "[desktop-dev] invalid workspace layout detected",
        "",
        `NEXU_WORKSPACE_ROOT=${rootDir}`,
        `NEXU_DESKTOP_APP_ROOT=${appDir}`,
      ].join("\n"),
    );
  }
}

async function acquireLock() {
  let announcedWait = false;

  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      try {
        await writeFile(
          lockInfoFile,
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !String(error.message).includes("EEXIST")
      ) {
        throw error;
      }

      let ownerPid = null;
      try {
        const owner = JSON.parse(await readFile(lockInfoFile, "utf8"));
        ownerPid = Number.isInteger(owner?.pid) ? owner.pid : null;
      } catch {}

      if (!ownerPid || !isPidRunning(ownerPid)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }

      if (!announcedWait) {
        await log(`waiting for desktop lock held by pid=${ownerPid}`);
        announcedWait = true;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
}

async function removePathWithRetry(targetPath, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    }
  }
}

async function releaseLock() {
  await rm(lockDir, { recursive: true, force: true });
}

async function withLock(action) {
  await acquireLock();
  try {
    return await action();
  } finally {
    await releaseLock();
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return null;
  }
}

async function writeState(state) {
  await mkdir(managerDir, { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

async function removeState() {
  await rm(stateFile, { force: true });
}

function hasReusableArtifacts() {
  const requiredPaths = [
    resolve(rootDir, "packages/shared/dist/index.js"),
    resolve(rootDir, "apps/controller/dist/index.js"),
    resolve(rootDir, "apps/web/dist/index.html"),
    resolve(appDir, "dist/index.html"),
    resolve(appDir, "dist-electron/main/bootstrap.js"),
    resolve(rootDir, ".tmp/sidecars/controller/dist/index.js"),
    resolve(
      rootDir,
      ".tmp/sidecars/openclaw/node_modules/openclaw/openclaw.mjs",
    ),
    resolve(rootDir, ".tmp/sidecars/web/index.js"),
  ];

  return requiredPaths.every((filePath) => existsSync(filePath));
}

function runCapture(command, args, options = {}) {
  const commandSpec = createCommandSpec(command, args);
  const result = spawnSync(commandSpec.command, commandSpec.args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  if (process.platform === "win32") {
    const result = spawnSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return result.status === 0 && result.stdout.includes(`"${pid}"`);
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

function listListeningPids(ports) {
  if (process.platform === "win32") {
    const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) {
      return [];
    }

    const targetPorts = new Set(ports.map(String));
    const pids = new Set();
    for (const rawLine of result.stdout.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line.startsWith("TCP")) {
        continue;
      }

      const columns = line.split(/\s+/u);
      if (columns.length < 5 || columns[3] !== "LISTENING") {
        continue;
      }

      const localAddress = columns[1];
      const port = localAddress.split(":").at(-1);
      if (!port || !targetPorts.has(port)) {
        continue;
      }

      const pid = Number.parseInt(columns[4], 10);
      if (Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }

    return [...pids];
  }

  const pids = new Set();
  for (const port of ports) {
    const result = spawnSync(
      "lsof",
      [`-tiTCP:${String(port)}`, "-sTCP:LISTEN"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (result.status !== 0) {
      continue;
    }
    for (const line of result.stdout.split(/\r?\n/u)) {
      const pid = Number.parseInt(line.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }
  }
  return [...pids];
}

function readGitValue(args, fallback) {
  try {
    const result = runCapture(gitCommand, ["-C", rootDir, ...args]);
    const value = result.stdout.trim();
    return result.status === 0 && value ? value : fallback;
  } catch {
    return fallback;
  }
}

async function runLogged(command, args, options = {}) {
  const startedAt = Date.now();
  await log(`run:start ${command} ${args.join(" ")}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const commandSpec = createCommandSpec(command, args);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: options.cwd ?? rootDir,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", async (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      await appendFile(logFile, stripTerminalControl(text));
    });

    child.stderr.on("data", async (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      await appendFile(logFile, stripTerminalControl(text));
    });

    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) {
        void log(
          `run:done ${command} ${args.join(" ")} durationMs=${Date.now() - startedAt}`,
        );
        resolvePromise();
        return;
      }
      void log(
        `run:fail ${command} ${args.join(" ")} exit=${code ?? "null"} durationMs=${Date.now() - startedAt}`,
      );
      rejectPromise(
        new Error(
          `Command failed: ${command} ${args.join(" ")} (exit ${code ?? "null"})`,
        ),
      );
    });
  });
}

function createDesktopEnv(launchId) {
  return {
    ...process.env,
    NEXU_WORKSPACE_ROOT: rootDir,
    NEXU_DESKTOP_APP_ROOT: appDir,
    NEXU_DESKTOP_RUNTIME_ROOT: runtimeRoot,
    NEXU_DESKTOP_BUILD_SOURCE:
      process.env.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dev",
    NEXU_DESKTOP_BUILD_BRANCH:
      process.env.NEXU_DESKTOP_BUILD_BRANCH ??
      readGitValue(["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
    NEXU_DESKTOP_BUILD_COMMIT:
      process.env.NEXU_DESKTOP_BUILD_COMMIT ??
      readGitValue(["rev-parse", "HEAD"], "unknown"),
    NEXU_DESKTOP_BUILD_TIME:
      process.env.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
    NEXU_DESKTOP_LAUNCH_ID: launchId,
  };
}

function ensureDarwinLsuiElement() {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    const electronExec = runCapture(
      pnpmCommand,
      [
        "--dir",
        rootDir,
        "exec",
        "node",
        "-e",
        'const electron=require("electron"); process.stdout.write(electron)',
      ],
      { env: process.env },
    ).stdout.trim();
    if (!electronExec || !electronExec.endsWith("/Contents/MacOS/Electron")) {
      return;
    }
    const electronApp = electronExec.slice(
      0,
      -"/Contents/MacOS/Electron".length,
    );
    const infoPlist = resolve(electronApp, "Contents/Info.plist");
    if (!existsSync(infoPlist)) {
      return;
    }
    spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Set :LSUIElement true", infoPlist],
      {
        stdio: "ignore",
      },
    );
    spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Add :LSUIElement bool true", infoPlist],
      {
        stdio: "ignore",
      },
    );
  } catch {}
}

async function killResidualProcesses() {
  await runTimedPhase("kill_residual_processes", async () => {
    await log("killing residual processes");

    const state = await readState();
    if (state?.electronPid) {
      await killPid(state.electronPid);
    }

    const portPids = listListeningPids(defaultPorts);
    for (const pid of portPids) {
      await killPid(pid);
    }

    await removeState();
  });
}

async function buildRuntime() {
  const launcherEnv = createLauncherEnv();

  await runTimedPhase("build_runtime", async () => {
    await log("building runtime artifacts");
    await logTimeline("build_runtime shared build start");
    await runLogged(
      pnpmCommand,
      ["--dir", rootDir, "--filter", "@nexu/shared", "build"],
      { env: launcherEnv },
    );
    await logTimeline("build_runtime controller build start");
    await runLogged(
      pnpmCommand,
      ["--dir", rootDir, "--filter", "@nexu/controller", "build"],
      { env: launcherEnv },
    );
    await logTimeline("build_runtime web build start");
    await runLogged(
      pnpmCommand,
      ["--dir", rootDir, "--filter", "@nexu/web", "build"],
      { env: launcherEnv },
    );
    await logTimeline("build_runtime controller sidecar start");
    await runLogged(
      pnpmCommand,
      ["--dir", appDir, "prepare:controller-sidecar"],
      { env: launcherEnv },
    );
    await logTimeline("build_runtime openclaw sidecar start");
    await runLogged(
      pnpmCommand,
      ["--dir", appDir, "prepare:openclaw-sidecar"],
      { env: launcherEnv },
    );
    await logTimeline("build_runtime web sidecar start");
    await runLogged(pnpmCommand, ["--dir", appDir, "prepare:web-sidecar"], {
      env: launcherEnv,
    });
    await logTimeline("build_runtime desktop build start");
    await runLogged(pnpmCommand, ["--dir", appDir, "build"], {
      env: launcherEnv,
    });

    if (!process.env.SENTRY_AUTH_TOKEN?.trim()) {
      await log(
        "skipping desktop sourcemap upload because SENTRY_AUTH_TOKEN is unset",
      );
    } else {
      try {
        await logTimeline("build_runtime upload sourcemaps start");
        await runLogged(pnpmCommand, ["--dir", appDir, "upload:sourcemaps"], {
          env: {
            ...launcherEnv,
            ...createDesktopEnv("desktop-build-metadata"),
          },
        });
      } catch {
        await log(
          "warning: desktop sourcemap upload failed; continuing startup",
        );
      }
    }

    await logTimeline("build_runtime complete");
  });
}

async function startSession() {
  await runTimedPhase("start_session", async () => {
    const launchId = `desktop-launch-${Date.now()}`;
    const env = createDesktopEnv(launchId);

    await log(`start_session launchId=${launchId}`);
    ensureDarwinLsuiElement();

    await logTimeline(`launch electron requested launch_id=${launchId}`);
    const stdoutFd = openSync(logFile, "a");
    const commandSpec = createCommandSpec(pnpmCommand, [
      "exec",
      "electron",
      "apps/desktop",
    ]);
    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd: rootDir,
      env,
      detached: true,
      stdio: ["ignore", stdoutFd, stdoutFd],
    });
    child.unref();
    await log(`start_session spawned pid=${child.pid ?? "unknown"}`);

    await writeState({
      launchId,
      electronPid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      runtimeRoot,
      platform: process.platform,
    });
    await logTimeline(
      `background process started launch_id=${launchId} pid=${child.pid ?? "unknown"}`,
    );
    await log(`started desktop process pid=${child.pid ?? "unknown"}`);
  });
}

async function start() {
  await runTimedPhase("start", async () => {
    await withLock(async () => {
      validateWorkspaceLayout();
      const state = await readState();
      if (state?.electronPid && isPidRunning(state.electronPid)) {
        await log(
          `desktop process is already running pid=${state.electronPid}`,
        );
        return;
      }

      await killResidualProcesses();
      if (shouldReuseBuildArtifacts() && hasReusableArtifacts()) {
        await log("reusing existing build artifacts");
      } else {
        if (shouldForceFullStart()) {
          await log("full desktop rebuild forced by CLI/environment");
        } else if (shouldReuseBuildArtifacts()) {
          await log(
            "build reuse enabled but artifacts are incomplete; running full build",
          );
        } else {
          await log(
            "build reuse disabled by CLI/environment; running full build",
          );
        }
        await buildRuntime();
      }
      await startSession();
    });
  });
}

async function stop() {
  await runTimedPhase("stop", async () => {
    await withLock(async () => {
      validateWorkspaceLayout();
      await killResidualProcesses();
      await log("stopped desktop process");
    });
  });
}

async function resetState() {
  await runTimedPhase("reset_state", async () => {
    await stop();
    await removePathWithRetry(runtimeRoot);
    await removePathWithRetry(sidecarRoot);
    await removePathWithRetry(lockDir);
    await removeState();
    await log(
      `reset desktop runtime state at '${runtimeRoot}' and cleared cached sidecars at '${sidecarRoot}'`,
    );
  });
}

async function restart() {
  await stop();
  await start();
}

async function status() {
  validateWorkspaceLayout();
  const state = await readState();
  if (state?.electronPid && isPidRunning(state.electronPid)) {
    console.log(
      `[${timestamp()}] desktop process is running pid=${state.electronPid}`,
    );
  } else {
    console.log(`[${timestamp()}] desktop process is not running`);
  }

  const portPids = listListeningPids(defaultPorts);
  if (portPids.length > 0) {
    console.log(`listening pids: ${portPids.join(", ")}`);
  }
}

function readLastLines(filePath, limit) {
  if (!existsSync(filePath)) {
    return "";
  }

  const content = readFileSync(filePath, "utf8");
  return content.split(/\r?\n/u).slice(-limit).join("\n");
}

async function logs() {
  const output = readLastLines(logFile, 200);
  if (output) {
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
}

async function devlog() {
  await logs();
}

async function control() {
  const target = `file://${join(appDir, "dist", "index.html")}`;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [target], { detached: true, stdio: "ignore" }).unref();
}

const command = process.argv[2] ?? "start";
const commandMap = {
  start,
  stop,
  restart,
  "reset-state": resetState,
  status,
  logs,
  devlog,
  control,
};

try {
  await ensureBaseDirs();
  const action = commandMap[command];
  if (!action) {
    console.error(
      "Usage: node apps/desktop/scripts/dev-cli.mjs <start|stop|restart|reset-state|status|logs|devlog|control>",
    );
    process.exit(1);
  }
  await action();
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  await ensureBaseDirs();
  await appendLine(logFile, `fatal: ${message}`);
  console.error(message);
  process.exit(1);
}
