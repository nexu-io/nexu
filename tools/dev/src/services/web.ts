import {
  createNodeOptions,
  ensureDirectory,
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
  createWebInjectedEnv,
  getToolsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { createDesktopInjectedEnv } from "../shared/dev-runtime-config.js";
import { logger as rootLogger } from "../shared/logger.js";
import {
  type DevLogTail,
  readLatestNamedLogTail,
  readLogTailFromFile,
} from "../shared/logs.js";
import {
  getWebDevLogPath,
  webDevLockPath,
  webSupervisorPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";

const logger = rootLogger.child({
  component: "web-service",
  service: "web",
});

export type WebDevSnapshot = {
  service: "web";
  status: "running" | "stopped" | "stale";
  pid?: number;
  listenerPid?: number;
  staleReason?: string;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
};

function createWebCommand(sessionId: string): {
  command: string;
  args: string[];
} {
  const { cliPath } = resolveTsxPaths();

  return {
    command: process.execPath,
    args: [
      cliPath,
      webSupervisorPath,
      ...createDevMarkerArgs({
        sessionId,
        service: "web",
        role: "supervisor",
      }),
    ],
  };
}

async function getWebPortPid(): Promise<number> {
  return getListeningPortPid(
    getToolsDevRuntimeConfig().webPort,
    "web dev server",
  );
}

async function waitForWebPortPid(): Promise<number> {
  return waitForListeningPortPid(
    getToolsDevRuntimeConfig().webPort,
    "web dev server",
    {
      attempts: 20,
      delayMs: 500,
    },
  );
}

async function cleanupStaleWebPort(): Promise<void> {
  try {
    const listenerPid = await getWebPortPid();
    await terminateProcess(listenerPid);
    await waitFor(
      async () => {
        try {
          await getWebPortPid();
        } catch {
          return;
        }
        throw new Error("web dev server listener is still active");
      },
      () => new Error("web dev server listener did not stop in time"),
      {
        attempts: 20,
        delayMs: 250,
      },
    ).catch(() => terminateProcess(listenerPid));
  } catch {}
}

export async function startWebDevProcess(options: {
  sessionId: string;
}): Promise<WebDevSnapshot> {
  const existingSnapshot = await getCurrentWebDevSnapshot();

  ensure(existingSnapshot.status !== "running").orThrow(
    () =>
      new Error(
        "web dev process is already running; run `pnpm dev stop web` first",
      ),
  );

  await cleanupStaleWebPort();

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getWebDevLogPath(runId);
  const commandSpec = createWebCommand(sessionId);
  const runLogger = logger.child({
    runId,
    sessionId,
  });

  await ensureParentDirectory(logFilePath);
  await ensureDirectory(repoRootPath);

  const processHandle = await spawnHiddenProcess({
    command: commandSpec.command,
    args: commandSpec.args,
    cwd: repoRootPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createWebInjectedEnv(),
      ...createDesktopInjectedEnv(),
      NEXU_DEV_WEB_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "web",
      NEXU_DEV_ROLE: "supervisor",
    },
    logFilePath,
    logger: runLogger,
  });

  try {
    if (processHandle.child) {
      await waitForProcessStart(processHandle.child, "web dev process");
    }
  } finally {
    processHandle.dispose();
  }

  const listenerPid = await waitForWebPortPid();

  await writeDevLock(webDevLockPath, {
    pid: processHandle.pid,
    runId,
    sessionId,
  });

  return {
    service: "web",
    status: "running",
    pid: processHandle.pid,
    listenerPid,
    runId,
    sessionId,
    logFilePath,
  };
}

export async function stopWebDevProcess(): Promise<WebDevSnapshot> {
  const snapshot = await getCurrentWebDevSnapshot();

  ensure(snapshot.status !== "stopped").orThrow(
    () => new Error("web dev process is not running"),
  );

  if (snapshot.pid) {
    await terminateProcess(snapshot.pid);
  }

  try {
    const listenerPid = await getWebPortPid();
    await terminateProcess(listenerPid);
  } catch {}

  await removeDevLock(webDevLockPath);

  return snapshot;
}

export async function restartWebDevProcess(options: {
  sessionId: string;
}): Promise<WebDevSnapshot> {
  const snapshot = await getCurrentWebDevSnapshot();

  if (snapshot.status === "running") {
    await stopWebDevProcess();
  }

  return startWebDevProcess(options);
}

export async function getCurrentWebDevSnapshot(): Promise<WebDevSnapshot> {
  try {
    const lock = await readDevLock(webDevLockPath);
    const logFilePath = getWebDevLogPath(lock.runId);

    try {
      process.kill(lock.pid, 0);
    } catch {
      return {
        service: "web",
        status: "stale",
        pid: lock.pid,
        staleReason: "supervisor pid is not running",
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    let listenerPid: number | undefined;

    try {
      listenerPid = await getWebPortPid();
    } catch {}

    if (!listenerPid) {
      return {
        service: "web",
        status: "stale",
        pid: lock.pid,
        staleReason: "web listener is not running",
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    return {
      service: "web",
      status: "running",
      pid: lock.pid,
      listenerPid,
      runId: lock.runId,
      sessionId: lock.sessionId,
      logFilePath,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        service: "web",
        status: "stopped",
      };
    }

    throw error;
  }
}

export async function readWebDevLog(): Promise<DevLogTail> {
  const snapshot = await getCurrentWebDevSnapshot();

  if (snapshot.logFilePath) {
    return readLogTailFromFile(snapshot.logFilePath);
  }

  const latestLog = await readLatestNamedLogTail("web.log");

  ensure(Boolean(latestLog)).orThrow(
    () => new Error("web dev log is unavailable"),
  );

  return latestLog as DevLogTail;
}
