import {
  createNodeOptions,
  ensureParentDirectory,
  getListeningPortPid,
  readDevLock,
  removeDevLock,
  repoRootPath,
  resolveTsxPaths,
  spawnHiddenProcess,
  terminateProcess,
  waitForListeningPortPid,
  waitForProcessStart,
  writeDevLock,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import {
  createControllerInjectedEnv,
  getScriptsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { getScriptsDevLogger } from "../shared/logger.js";
import { type DevLogTail, readLogTailFromFile } from "../shared/logs.js";
import {
  controllerDevLockPath,
  controllerSupervisorPath,
  getControllerDevLogPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";

export type ControllerDevSnapshot = {
  service: "controller";
  status: "running" | "stopped" | "stale";
  pid?: number;
  workerPid?: number;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
};

function createControllerCommand(sessionId: string): {
  command: string;
  args: string[];
} {
  const { cliPath } = resolveTsxPaths();

  return {
    command: process.execPath,
    args: [
      cliPath,
      controllerSupervisorPath,
      ...createDevMarkerArgs({
        sessionId,
        service: "controller",
        role: "supervisor",
      }),
    ],
  };
}

export async function getControllerPortPid(): Promise<number> {
  return getListeningPortPid(
    getScriptsDevRuntimeConfig().controllerPort,
    "controller dev server",
  );
}

async function waitForControllerPortPid(): Promise<number> {
  return waitForListeningPortPid(
    getScriptsDevRuntimeConfig().controllerPort,
    "controller dev server",
    {
      attempts: 30,
      delayMs: 500,
    },
  );
}

async function ensureOpenclawReadyForController(): Promise<void> {
  const runtimeConfig = getScriptsDevRuntimeConfig();
  const healthUrl = `${runtimeConfig.openclawBaseUrl}/health`;

  await waitForListeningPortPid(
    runtimeConfig.openclawPort,
    "openclaw gateway",
    {
      attempts: 20,
      delayMs: 250,
    },
  ).catch(() => {
    throw new Error(
      "openclaw is not running; start it with `pnpm dev start openclaw` before starting controller",
    );
  });

  for (let index = 0; index < 20; index += 1) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        return;
      }
    } catch {}

    if (index < 19) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(
    `openclaw health endpoint did not become ready at ${healthUrl}; start it with \`pnpm dev start openclaw\` before starting controller`,
  );
}

export async function startControllerDevProcess(options: {
  sessionId: string;
}): Promise<ControllerDevSnapshot> {
  await ensureOpenclawReadyForController();

  const existingSnapshot = await getCurrentControllerDevSnapshot();

  ensure(existingSnapshot.status !== "running").orThrow(
    () =>
      new Error(
        "controller dev process is already running; run `pnpm dev stop controller` first",
      ),
  );

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getControllerDevLogPath(runId);
  const commandSpec = createControllerCommand(sessionId);
  const logger = getScriptsDevLogger({
    component: "controller-service",
    service: "controller",
    runId,
    sessionId,
  });

  await ensureParentDirectory(logFilePath);

  const processHandle = await spawnHiddenProcess({
    command: commandSpec.command,
    args: commandSpec.args,
    cwd: repoRootPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createControllerInjectedEnv(),
      NEXU_DEV_CONTROLLER_RUN_ID: runId,
      NEXU_DEV_CONTROLLER_LOG_PATH: logFilePath,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "controller",
      NEXU_DEV_ROLE: "supervisor",
    },
    logFilePath,
    logger,
  });

  try {
    if (processHandle.child) {
      await waitForProcessStart(processHandle.child, "controller dev process");
    }
  } finally {
    processHandle.dispose();
  }

  ensure(Boolean(processHandle.pid)).orThrow(
    () => new Error("controller dev process did not expose a pid"),
  );
  const supervisorPid = processHandle.pid as number;
  const workerPid = await waitForControllerPortPid();

  await writeDevLock(controllerDevLockPath, {
    pid: supervisorPid,
    runId,
    sessionId,
  });

  return {
    service: "controller",
    status: "running",
    pid: supervisorPid,
    workerPid,
    runId,
    sessionId,
    logFilePath,
  };
}

export async function stopControllerDevProcess(): Promise<ControllerDevSnapshot> {
  const snapshot = await getCurrentControllerDevSnapshot();

  ensure(snapshot.status !== "stopped").orThrow(
    () => new Error("controller dev process is not running"),
  );

  if (snapshot.status === "running" && snapshot.pid) {
    await terminateProcess(snapshot.pid);
  }

  try {
    const workerPid = await getControllerPortPid();
    await terminateProcess(workerPid);
  } catch {}

  await removeDevLock(controllerDevLockPath);

  return snapshot;
}

export async function restartControllerDevProcess(options: {
  sessionId: string;
}): Promise<ControllerDevSnapshot> {
  const snapshot = await getCurrentControllerDevSnapshot();

  if (snapshot.status === "running") {
    await stopControllerDevProcess();
  }

  return startControllerDevProcess(options);
}

export async function getCurrentControllerDevSnapshot(): Promise<ControllerDevSnapshot> {
  try {
    const lock = await readDevLock(controllerDevLockPath);
    const logFilePath = getControllerDevLogPath(lock.runId);

    try {
      process.kill(lock.pid, 0);
    } catch {
      return {
        service: "controller",
        status: "stale",
        pid: lock.pid,
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    let workerPid: number | undefined;

    try {
      workerPid = await getControllerPortPid();
    } catch {}

    return {
      service: "controller",
      status: "running",
      pid: lock.pid,
      workerPid,
      runId: lock.runId,
      sessionId: lock.sessionId,
      logFilePath,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        service: "controller",
        status: "stopped",
      };
    }

    throw error;
  }
}

export async function readControllerDevLog(): Promise<DevLogTail> {
  const snapshot = await getCurrentControllerDevSnapshot();

  ensure(Boolean(snapshot.logFilePath)).orThrow(
    () => new Error("controller dev log is unavailable"),
  );

  return readLogTailFromFile(snapshot.logFilePath as string);
}
