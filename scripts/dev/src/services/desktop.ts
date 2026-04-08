import { execFile, spawn } from "node:child_process";
import {
  createNodeOptions,
  ensureParentDirectory,
  getListeningPortPid,
  isProcessRunning,
  readDevLock,
  removeDevLock,
  resolveViteBinPath,
  spawnHiddenProcess,
  waitFor,
  waitForListeningPortPid,
  waitForProcessStart,
  writeDevLock,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createDesktopInjectedEnv,
  getScriptsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { getScriptsDevLogger } from "../shared/logger.js";
import { type DevLogTail, readLogTailFromFile } from "../shared/logs.js";
import {
  desktopDevLockPath,
  desktopWorkingDirectoryPath,
  getDesktopDevLogPath,
} from "../shared/paths.js";
import {
  createDesktopElectronLaunchSpec,
  findDesktopDevMainPid,
  terminateDesktopDevProcesses,
} from "../shared/platform/desktop-dev-platform.js";
import { getCurrentControllerDevSnapshot } from "./controller.js";
import { getCurrentWebDevSnapshot } from "./web.js";

export type DesktopDevSnapshot = {
  service: "desktop";
  status: "running" | "stopped" | "stale";
  pid?: number;
  workerPid?: number;
  launchId?: string;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
};

type DesktopLaunchEnv = {
  env: NodeJS.ProcessEnv;
  launchId: string;
};

type DetachedDesktopHandle = {
  pid: number;
  dispose: () => void;
};

const execFileAsync = promisify(execFile);

async function ensureDesktopDependenciesReady(): Promise<void> {
  const [controllerSnapshot, webSnapshot] = await Promise.all([
    getCurrentControllerDevSnapshot(),
    getCurrentWebDevSnapshot(),
  ]);

  ensure(controllerSnapshot.status === "running").orThrow(
    () =>
      new Error(
        "controller is not running; start it with `pnpm dev start controller` before starting desktop",
      ),
  );
  ensure(webSnapshot.status === "running").orThrow(
    () =>
      new Error(
        "web is not running; start it with `pnpm dev start web` before starting desktop",
      ),
  );
}

function createDesktopLaunchEnv(): DesktopLaunchEnv {
  const launchId = `desktop-launch-${Date.now()}`;

  return {
    launchId,
    env: {
      ...process.env,
      NEXU_DESKTOP_BUILD_SOURCE:
        process.env.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dev",
      NEXU_DESKTOP_BUILD_BRANCH:
        process.env.NEXU_DESKTOP_BUILD_BRANCH ?? "unknown",
      NEXU_DESKTOP_BUILD_COMMIT:
        process.env.NEXU_DESKTOP_BUILD_COMMIT ?? "unknown",
      NEXU_DESKTOP_BUILD_TIME:
        process.env.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
      NEXU_DESKTOP_LAUNCH_ID: launchId,
    },
  };
}

function createDesktopViteCommand(): {
  command: string;
  args: string[];
} {
  const runtimeConfig = getScriptsDevRuntimeConfig();

  return {
    command: process.execPath,
    args: [
      resolveViteBinPath(desktopWorkingDirectoryPath),
      "--host",
      runtimeConfig.desktopDevHost,
      "--port",
      String(runtimeConfig.desktopDevPort),
      "--strictPort",
    ],
  };
}

async function terminateDesktopPid(pid: number, force = false): Promise<void> {
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];

    if (force) {
      args.push("/F");
    }

    try {
      await execFileAsync("taskkill.exe", args, { windowsHide: true });
      return;
    } catch {}
  }

  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {}
}

function spawnWindowsDetachedDesktopProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): DetachedDesktopHandle {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("desktop electron process did not expose a pid");
  }

  return {
    pid: child.pid,
    dispose: () => {
      child.unref();
    },
  };
}

async function waitForDesktopShutdown(options?: {
  previousPid?: number;
  launchId?: string;
}): Promise<void> {
  const desktopDevPort = getScriptsDevRuntimeConfig().desktopDevPort;

  await waitFor(
    async () => {
      if (options?.previousPid && isProcessRunning(options.previousPid)) {
        throw new Error("desktop process is still shutting down");
      }

      const desktopMainPid = await findDesktopDevMainPid(options?.launchId);
      if (desktopMainPid) {
        throw new Error("desktop electron process is still shutting down");
      }

      try {
        await getListeningPortPid(desktopDevPort, "desktop dev server");
      } catch {
        return;
      }

      throw new Error("desktop dev server is still shutting down");
    },
    () => new Error("desktop dev process did not shut down cleanly"),
    {
      attempts: 40,
      delayMs: 250,
    },
  );
}

async function cleanupStaleDesktopDevServer(): Promise<void> {
  const desktopDevPort = getScriptsDevRuntimeConfig().desktopDevPort;

  try {
    const vitePid = await getListeningPortPid(
      desktopDevPort,
      "desktop dev server",
    );
    await terminateDesktopPid(vitePid);
    await waitFor(
      async () => {
        await getListeningPortPid(desktopDevPort, "desktop dev server");
        throw new Error("desktop dev server listener is still active");
      },
      () => new Error("desktop dev server listener did not stop in time"),
      {
        attempts: 20,
        delayMs: 250,
      },
    ).catch(() => {
      return terminateDesktopPid(vitePid, true);
    });
  } catch {}
}

async function waitForDesktopBuildOutputs(startedAt: number): Promise<void> {
  const expectedOutputs = [
    join(desktopWorkingDirectoryPath, "dist-electron", "main", "bootstrap.js"),
    join(desktopWorkingDirectoryPath, "dist-electron", "preload", "index.js"),
    join(
      desktopWorkingDirectoryPath,
      "dist-electron",
      "preload",
      "webview-preload.js",
    ),
  ];

  await waitFor(
    async () => {
      await Promise.all(
        expectedOutputs.map(async (filePath) => {
          const fileStat = await stat(filePath);

          if (fileStat.mtimeMs < startedAt) {
            throw new Error(`desktop build output is stale: ${filePath}`);
          }
        }),
      );
    },
    () => new Error("desktop vite build outputs were not refreshed in time"),
    {
      attempts: 40,
      delayMs: 250,
    },
  );
}

export async function startDesktopDevProcess(options: {
  sessionId: string;
}): Promise<DesktopDevSnapshot> {
  const runtimeConfig = getScriptsDevRuntimeConfig();
  await ensureDesktopDependenciesReady();

  const existingSnapshot = await getCurrentDesktopDevSnapshot();

  ensure(existingSnapshot.status !== "running").orThrow(
    () =>
      new Error(
        "desktop dev process is already running; run `pnpm dev stop desktop` first",
      ),
  );

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getDesktopDevLogPath(runId);
  const desktopLaunch = createDesktopLaunchEnv();
  const desktopViteCommand = createDesktopViteCommand();
  const logger = getScriptsDevLogger({
    component: "desktop-service",
    service: "desktop",
    runId,
    sessionId,
  });

  await ensureParentDirectory(logFilePath);
  await cleanupStaleDesktopDevServer();

  const viteStartedAt = Date.now();
  const viteHandle = await spawnHiddenProcess({
    command: desktopViteCommand.command,
    args: desktopViteCommand.args,
    cwd: desktopWorkingDirectoryPath,
    env: {
      ...desktopLaunch.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDesktopInjectedEnv(),
      NEXU_DESKTOP_DISABLE_VITE_ELECTRON_STARTUP: "1",
      NEXU_DEV_DESKTOP_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "desktop",
      NEXU_DEV_ROLE: "worker",
    },
    logFilePath,
    logger,
  });

  try {
    if (viteHandle.child) {
      await waitForProcessStart(viteHandle.child, "desktop vite worker");
    }
  } finally {
    viteHandle.dispose();
  }

  await waitForListeningPortPid(
    runtimeConfig.desktopDevPort,
    "desktop dev server",
    {
      attempts: 40,
      delayMs: 250,
      supervisorPid: viteHandle.pid,
      supervisorName: "desktop vite worker",
    },
  );
  await waitForDesktopBuildOutputs(viteStartedAt);

  const electronLaunchSpec = await createDesktopElectronLaunchSpec({
    launchId: desktopLaunch.launchId,
    logFilePath,
    env: {
      ...desktopLaunch.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDesktopInjectedEnv(),
      NEXU_DEV_DESKTOP_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "desktop",
      NEXU_DEV_ROLE: "main",
    },
  });

  const desktopMainPid =
    process.platform === "win32"
      ? (() => {
          const handle = spawnWindowsDetachedDesktopProcess({
            command: electronLaunchSpec.command,
            args: electronLaunchSpec.args,
            cwd: electronLaunchSpec.cwd,
            env: electronLaunchSpec.env,
          });
          handle.dispose();
          return handle.pid;
        })()
      : await (async () => {
          const electronHandle = await spawnHiddenProcess({
            command: electronLaunchSpec.command,
            args: electronLaunchSpec.args,
            cwd: electronLaunchSpec.cwd,
            env: electronLaunchSpec.env,
            logFilePath,
            logger,
          });

          electronHandle.dispose();

          return waitFor(
            async () => {
              const pid = await findDesktopDevMainPid(desktopLaunch.launchId);
              if (!pid) {
                throw new Error(
                  "desktop electron main process was not detected yet",
                );
              }

              return pid;
            },
            () =>
              new Error("desktop electron main process did not start in time"),
            {
              attempts: 40,
              delayMs: 250,
            },
          );
        })();

  await writeDevLock(desktopDevLockPath, {
    pid: desktopMainPid,
    workerPid: viteHandle.pid,
    runId,
    sessionId,
    launchId: desktopLaunch.launchId,
  });

  return {
    service: "desktop",
    status: "running",
    pid: desktopMainPid,
    workerPid: viteHandle.pid,
    launchId: desktopLaunch.launchId,
    runId,
    sessionId,
    logFilePath,
  };
}

export async function stopDesktopDevProcess(): Promise<DesktopDevSnapshot> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  ensure(snapshot.status !== "stopped").orThrow(
    () => new Error("desktop dev process is not running"),
  );

  await terminateDesktopDevProcesses(snapshot.pid, {
    launchId: snapshot.launchId,
  });

  if (snapshot.workerPid && isProcessRunning(snapshot.workerPid)) {
    await terminateDesktopPid(snapshot.workerPid);
  }

  try {
    const desktopVitePid = await getListeningPortPid(
      getScriptsDevRuntimeConfig().desktopDevPort,
      "desktop dev server",
    );
    if (isProcessRunning(desktopVitePid)) {
      await terminateDesktopPid(desktopVitePid);
    }
  } catch {}

  try {
    await waitForDesktopShutdown({
      previousPid: snapshot.pid,
      launchId: snapshot.launchId,
    });
  } catch {
    await terminateDesktopDevProcesses(snapshot.pid, {
      force: true,
      launchId: snapshot.launchId,
    });

    if (snapshot.workerPid && isProcessRunning(snapshot.workerPid)) {
      await terminateDesktopPid(snapshot.workerPid, true);
    }

    try {
      const desktopVitePid = await getListeningPortPid(
        getScriptsDevRuntimeConfig().desktopDevPort,
        "desktop dev server",
      );
      await terminateDesktopPid(desktopVitePid, true);
    } catch {}

    await waitForDesktopShutdown({
      previousPid: snapshot.pid,
      launchId: snapshot.launchId,
    });
  }

  await removeDevLock(desktopDevLockPath);

  return snapshot;
}

export async function restartDesktopDevProcess(options: {
  sessionId: string;
}): Promise<DesktopDevSnapshot> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  if (snapshot.status === "running") {
    await stopDesktopDevProcess();
  }

  return startDesktopDevProcess(options);
}

export async function getCurrentDesktopDevSnapshot(): Promise<DesktopDevSnapshot> {
  try {
    const lock = await readDevLock(desktopDevLockPath);
    const logFilePath = getDesktopDevLogPath(lock.runId);

    if (!isProcessRunning(lock.pid)) {
      const desktopMainPid = await findDesktopDevMainPid(lock.launchId);

      if (desktopMainPid) {
        return {
          service: "desktop",
          status: "running",
          pid: desktopMainPid,
          workerPid: lock.workerPid,
          launchId: lock.launchId,
          runId: lock.runId,
          sessionId: lock.sessionId,
          logFilePath,
        };
      }

      return {
        service: "desktop",
        status: "stale",
        pid: lock.pid,
        workerPid: lock.workerPid,
        launchId: lock.launchId,
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    return {
      service: "desktop",
      status: "running",
      pid: lock.pid,
      workerPid: lock.workerPid,
      launchId: lock.launchId,
      runId: lock.runId,
      sessionId: lock.sessionId,
      logFilePath,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        service: "desktop",
        status: "stopped",
      };
    }

    throw error;
  }
}

export async function readDesktopDevLog(): Promise<DevLogTail> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  ensure(Boolean(snapshot.logFilePath)).orThrow(
    () => new Error("desktop dev log is unavailable"),
  );

  return readLogTailFromFile(snapshot.logFilePath as string);
}
