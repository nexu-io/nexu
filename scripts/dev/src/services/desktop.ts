import {
  createNodeOptions,
  ensureParentDirectory,
  isProcessRunning,
  readDevLock,
  removeDevLock,
  repoRootPath,
  resolveTsxPaths,
  spawnHiddenProcess,
  terminateProcess,
  waitForProcessStart,
  writeDevLock,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import { createDesktopInjectedEnv } from "../shared/dev-runtime-config.js";
import { type DevLogTail, readLogTailFromFile } from "../shared/logs.js";
import {
  desktopDevLockPath,
  desktopSupervisorPath,
  desktopWorkingDirectoryPath,
  getDesktopDevLogPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";
import { getCurrentControllerDevSnapshot } from "./controller.js";
import { getCurrentWebDevSnapshot } from "./web.js";

export type DesktopDevSnapshot = {
  service: "desktop";
  status: "running" | "stopped" | "stale";
  pid?: number;
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
      NODE_OPTIONS: createNodeOptions(),
      ...createDesktopInjectedEnv(),
      NEXU_WORKSPACE_ROOT: repoRootPath,
      NEXU_DESKTOP_APP_ROOT: desktopWorkingDirectoryPath,
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

function createDesktopCommand(sessionId: string): {
  command: string;
  args: string[];
} {
  const { cliPath } = resolveTsxPaths();

  return {
    command: process.execPath,
    args: [
      cliPath,
      desktopSupervisorPath,
      ...createDevMarkerArgs({
        sessionId,
        service: "desktop",
        role: "supervisor",
      }),
    ],
  };
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
  const commandSpec = createDesktopCommand(sessionId);
  const desktopLaunch = createDesktopLaunchEnv();

  await ensureParentDirectory(logFilePath);

  const processHandle = await spawnHiddenProcess({
    command: commandSpec.command,
    args: commandSpec.args,
    cwd: repoRootPath,
    env: {
      ...desktopLaunch.env,
      NEXU_DEV_DESKTOP_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "desktop",
      NEXU_DEV_ROLE: "supervisor",
    },
    logFilePath,
  });

  try {
    if (processHandle.child) {
      await waitForProcessStart(processHandle.child, "desktop dev process");
    }
  } finally {
    processHandle.dispose();
  }

  await writeDevLock(desktopDevLockPath, {
    pid: processHandle.pid,
    runId,
    sessionId,
    launchId: desktopLaunch.launchId,
  });

  return {
    service: "desktop",
    status: "running",
    pid: processHandle.pid,
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

  if (snapshot.status === "running" && snapshot.pid) {
    await terminateProcess(snapshot.pid);
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
      return {
        service: "desktop",
        status: "stale",
        pid: lock.pid,
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
