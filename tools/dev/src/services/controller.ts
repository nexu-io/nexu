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
  waitFor,
  waitForListeningPortPid,
  waitForProcessStart,
  writeDevLock,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import {
  createControllerInjectedEnv,
  getToolsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { logger as rootLogger } from "../shared/logger.js";
import {
  type DevLogTail,
  readLatestNamedLogTail,
  readLogTailFromFile,
} from "../shared/logs.js";
import {
  controllerDevLockPath,
  controllerSupervisorPath,
  getControllerDevLogPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";

const logger = rootLogger.child({
  component: "controller-service",
  service: "controller",
});

export type ControllerDevSnapshot = {
  service: "controller";
  status: "running" | "stopped" | "stale";
  pid?: number;
  workerPid?: number;
  staleReason?: string;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
};

type ControllerReadyStatus = {
  ready: boolean;
  bootPhase?: string;
  coreReady?: boolean;
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
    getToolsDevRuntimeConfig().controllerPort,
    "controller dev server",
  );
}

async function waitForControllerPortPid(
  supervisorPid?: number,
): Promise<number> {
  return waitForListeningPortPid(
    getToolsDevRuntimeConfig().controllerPort,
    "controller dev server",
    {
      // Match supervisor headroom — Windows cold-start can take ~15s.
      attempts: 120,
      delayMs: 500,
      supervisorPid,
      supervisorName: "controller supervisor",
    },
  );
}

async function getControllerReadyStatus(): Promise<ControllerReadyStatus> {
  const runtimeConfig = getToolsDevRuntimeConfig();

  try {
    const response = await fetch(
      `${runtimeConfig.controllerUrl}/api/internal/desktop/ready`,
      {
        signal: AbortSignal.timeout(1500),
      },
    );

    if (!response.ok) {
      return { ready: false };
    }

    const payload = (await response.json()) as {
      ready?: boolean;
      coreReady?: boolean;
      bootPhase?: string;
    };

    return {
      ready: payload.coreReady === true || payload.ready === true,
      bootPhase: payload.bootPhase,
      coreReady: payload.coreReady,
    };
  } catch {
    return { ready: false };
  }
}

async function getControllerHealthStatus(): Promise<boolean> {
  return (await getControllerReadyStatus()).ready;
}

async function getStableControllerHealthStatus(): Promise<boolean> {
  for (let index = 0; index < 3; index += 1) {
    if (await getControllerHealthStatus()) {
      return true;
    }

    if (index < 2) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return false;
}

async function waitForControllerHealth(supervisorPid: number): Promise<void> {
  const runtimeConfig = getToolsDevRuntimeConfig();
  const readyUrl = `${runtimeConfig.controllerUrl}/api/internal/desktop/ready`;
  let lastReadyStatus: ControllerReadyStatus | null = null;

  for (let index = 0; index < 120; index += 1) {
    const readyStatus = await getControllerReadyStatus();
    lastReadyStatus = readyStatus;

    if (readyStatus.ready) {
      return;
    }

    try {
      process.kill(supervisorPid, 0);
    } catch {
      throw new Error(
        "controller supervisor exited before controller readiness passed",
      );
    }

    if (index < 119) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const diagnosticSuffix = lastReadyStatus
    ? ` (last bootPhase=${lastReadyStatus.bootPhase ?? "unknown"}, coreReady=${String(lastReadyStatus.coreReady ?? false)}, ready=${String(lastReadyStatus.ready)})`
    : "";

  throw new Error(
    `controller readiness endpoint did not become ready at ${readyUrl}${diagnosticSuffix}`,
  );
}

async function cleanupStaleControllerPort(): Promise<void> {
  try {
    const workerPid = await getControllerPortPid();
    await terminateProcess(workerPid);
    await waitFor(
      async () => {
        try {
          await getControllerPortPid();
        } catch {
          return;
        }
        throw new Error("controller dev server listener is still active");
      },
      () => new Error("controller dev server listener did not stop in time"),
      {
        attempts: 20,
        delayMs: 250,
      },
    ).catch(() => terminateProcess(workerPid));
  } catch {}
}

async function ensureOpenclawReadyForController(): Promise<void> {
  const runtimeConfig = getToolsDevRuntimeConfig();
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

  await cleanupStaleControllerPort();

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getControllerDevLogPath(runId);
  const commandSpec = createControllerCommand(sessionId);
  const runLogger = logger.child({
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
    logger: runLogger,
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
  try {
    const workerPid = await waitForControllerPortPid(supervisorPid);
    await waitForControllerHealth(supervisorPid);

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
  } catch (error) {
    await removeDevLock(controllerDevLockPath).catch(() => undefined);
    await terminateProcess(supervisorPid).catch(() => undefined);

    throw error;
  }
}

export async function stopControllerDevProcess(): Promise<ControllerDevSnapshot> {
  const snapshot = await getCurrentControllerDevSnapshot();

  ensure(snapshot.status !== "stopped").orThrow(
    () => new Error("controller dev process is not running"),
  );

  if (snapshot.pid) {
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
        staleReason: "supervisor pid is not running",
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    let workerPid: number | undefined;

    try {
      workerPid = await getControllerPortPid();
    } catch {}

    if (!workerPid) {
      return {
        service: "controller",
        status: "stale",
        pid: lock.pid,
        staleReason: "controller port is not listening",
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    if (!(await getStableControllerHealthStatus())) {
      const readyStatus = await getControllerReadyStatus();
      return {
        service: "controller",
        status: "stale",
        pid: lock.pid,
        workerPid,
        staleReason: readyStatus.bootPhase
          ? `controller readiness is not ready (bootPhase=${readyStatus.bootPhase})`
          : "controller readiness is not ready",
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

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

  if (snapshot.logFilePath) {
    return readLogTailFromFile(snapshot.logFilePath);
  }

  const latestLog = await readLatestNamedLogTail("controller.log");

  ensure(Boolean(latestLog)).orThrow(
    () => new Error("controller dev log is unavailable"),
  );

  return latestLog as DevLogTail;
}
