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
import { createDesktopInjectedEnv } from "../shared/dev-runtime-config.js";
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
  return {
    command: process.execPath,
    args: [
      resolveViteBinPath(desktopWorkingDirectoryPath),
      "--host",
      process.env.NEXU_DESKTOP_DEV_HOST ?? "127.0.0.1",
      "--port",
      process.env.NEXU_DESKTOP_DEV_PORT ?? "5180",
      "--strictPort",
    ],
  };
}

async function waitForDesktopShutdown(previousPid?: number): Promise<void> {
  await waitFor(
    async () => {
      if (previousPid && isProcessRunning(previousPid)) {
        throw new Error("desktop process is still shutting down");
      }

      const desktopMainPid = await findDesktopDevMainPid();
      if (desktopMainPid) {
        throw new Error("desktop electron process is still shutting down");
      }

      try {
        await getListeningPortPid(5180, "desktop dev server");
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

  await waitForListeningPortPid(5180, "desktop dev server", {
    attempts: 40,
    delayMs: 250,
    supervisorPid: viteHandle.pid,
    supervisorName: "desktop vite worker",
  });
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

  const electronHandle = await spawnHiddenProcess({
    command: electronLaunchSpec.command,
    args: electronLaunchSpec.args,
    cwd: electronLaunchSpec.cwd,
    env: electronLaunchSpec.env,
    logFilePath,
    logger,
  });

  electronHandle.dispose();

  const desktopMainPid = await waitFor(
    async () => {
      const pid = await findDesktopDevMainPid();
      if (!pid) {
        throw new Error("desktop electron main process was not detected yet");
      }

      return pid;
    },
    () => new Error("desktop electron main process did not start in time"),
    {
      attempts: 40,
      delayMs: 250,
    },
  );

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

  await terminateDesktopDevProcesses(snapshot.pid);

  if (snapshot.workerPid && isProcessRunning(snapshot.workerPid)) {
    try {
      process.kill(-snapshot.workerPid, "SIGTERM");
    } catch {
      process.kill(snapshot.workerPid, "SIGTERM");
    }
  }

  try {
    const desktopVitePid = await getListeningPortPid(
      5180,
      "desktop dev server",
    );
    if (isProcessRunning(desktopVitePid)) {
      try {
        process.kill(-desktopVitePid, "SIGTERM");
      } catch {
        process.kill(desktopVitePid, "SIGTERM");
      }
    }
  } catch {}

  try {
    await waitForDesktopShutdown(snapshot.pid);
  } catch {
    await terminateDesktopDevProcesses(snapshot.pid, { force: true });

    if (snapshot.workerPid && isProcessRunning(snapshot.workerPid)) {
      try {
        process.kill(snapshot.workerPid, "SIGKILL");
      } catch {}
    }

    try {
      const desktopVitePid = await getListeningPortPid(
        5180,
        "desktop dev server",
      );
      process.kill(desktopVitePid, "SIGKILL");
    } catch {}

    await waitForDesktopShutdown(snapshot.pid);
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
      const desktopMainPid = await findDesktopDevMainPid();

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
