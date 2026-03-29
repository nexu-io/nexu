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
  waitForListeningPortPid,
  waitForProcessStart,
  writeDevLock,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import {
  createOpenclawInjectedEnv,
  getScriptsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { getScriptsDevLogger } from "../shared/logger.js";
import { type DevLogTail, readLogTailFromFile } from "../shared/logs.js";
import {
  getOpenclawDevLogPath,
  openclawDevLockPath,
  openclawSupervisorPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";

export type OpenclawDevSnapshot = {
  service: "openclaw";
  status: "running" | "stopped" | "stale";
  pid?: number;
  listenerPid?: number;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
};

function logOpenclawTiming(stage: string, startedAt: number): void {
  getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
  }).debug("openclaw timing", {
    stage,
    elapsedMs: Date.now() - startedAt,
  });
}

function createOpenclawCommand(sessionId: string): {
  command: string;
  args: string[];
} {
  const { cliPath } = resolveTsxPaths();

  return {
    command: process.execPath,
    args: [
      cliPath,
      openclawSupervisorPath,
      ...createDevMarkerArgs({
        sessionId,
        service: "openclaw",
        role: "supervisor",
      }),
    ],
  };
}

export async function getOpenclawPortPid(): Promise<number> {
  return getListeningPortPid(
    getScriptsDevRuntimeConfig().openclawPort,
    "openclaw gateway",
  );
}

async function waitForOpenclawPortPid(supervisorPid: number): Promise<number> {
  return waitForListeningPortPid(
    getScriptsDevRuntimeConfig().openclawPort,
    "openclaw gateway",
    {
      attempts: 120,
      delayMs: 500,
      supervisorPid,
      supervisorName: "openclaw supervisor",
    },
  );
}

export async function startOpenclawDevProcess(options: {
  sessionId: string;
}): Promise<OpenclawDevSnapshot> {
  const startedAt = Date.now();
  const existingSnapshot = await getCurrentOpenclawDevSnapshot();

  ensure(existingSnapshot.status !== "running").orThrow(
    () =>
      new Error(
        "openclaw dev process is already running; run `pnpm dev stop openclaw` first",
      ),
  );

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getOpenclawDevLogPath(runId);
  const commandSpec = createOpenclawCommand(sessionId);
  const runtimeConfig = getScriptsDevRuntimeConfig();
  const logger = getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
    runId,
    sessionId,
  });

  logOpenclawTiming("start:entered", startedAt);

  await ensureParentDirectory(logFilePath);
  await ensureDirectory(runtimeConfig.openclawStateDir);
  await ensureParentDirectory(runtimeConfig.openclawConfigPath);
  await ensureDirectory(runtimeConfig.openclawLogDir);

  logOpenclawTiming("filesystem-ready", startedAt);

  const processHandle = await spawnHiddenProcess({
    command: commandSpec.command,
    args: commandSpec.args,
    cwd: repoRootPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createOpenclawInjectedEnv(),
      NEXU_DEV_OPENCLAW_RUN_ID: runId,
      NEXU_DEV_OPENCLAW_LOG_PATH: logFilePath,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "openclaw",
      NEXU_DEV_ROLE: "supervisor",
    },
    logFilePath,
    logger,
  });

  logOpenclawTiming("spawn-hidden-process-returned", startedAt);

  try {
    if (processHandle.child) {
      await waitForProcessStart(processHandle.child, "openclaw dev process");
      logOpenclawTiming("supervisor-process-start-confirmed", startedAt);
    }
  } finally {
    processHandle.dispose();
  }

  ensure(Boolean(processHandle.pid)).orThrow(
    () => new Error("openclaw dev process did not expose a pid"),
  );
  const supervisorPid = processHandle.pid as number;
  logOpenclawTiming(`supervisor-pid=${supervisorPid}`, startedAt);
  const listenerPid = await waitForOpenclawPortPid(supervisorPid);

  logOpenclawTiming(`listener-pid=${listenerPid}`, startedAt);

  await writeDevLock(openclawDevLockPath, {
    pid: supervisorPid,
    runId,
    sessionId,
  });

  logOpenclawTiming("lock-written", startedAt);

  return {
    service: "openclaw",
    status: "running",
    pid: supervisorPid,
    listenerPid,
    runId,
    sessionId,
    logFilePath,
  };
}

export async function stopOpenclawDevProcess(): Promise<OpenclawDevSnapshot> {
  const snapshot = await getCurrentOpenclawDevSnapshot();

  ensure(snapshot.status !== "stopped").orThrow(
    () => new Error("openclaw dev process is not running"),
  );

  if (snapshot.status === "running" && snapshot.pid) {
    await terminateProcess(snapshot.pid);
  }

  try {
    const listenerPid = await getOpenclawPortPid();
    await terminateProcess(listenerPid);
  } catch {}

  await removeDevLock(openclawDevLockPath);

  return snapshot;
}

export async function restartOpenclawDevProcess(options: {
  sessionId: string;
}): Promise<OpenclawDevSnapshot> {
  const snapshot = await getCurrentOpenclawDevSnapshot();

  if (snapshot.status === "running") {
    await stopOpenclawDevProcess();
  }

  return startOpenclawDevProcess(options);
}

export async function getCurrentOpenclawDevSnapshot(): Promise<OpenclawDevSnapshot> {
  try {
    const lock = await readDevLock(openclawDevLockPath);
    const logFilePath = getOpenclawDevLogPath(lock.runId);

    try {
      process.kill(lock.pid, 0);
    } catch {
      return {
        service: "openclaw",
        status: "stale",
        pid: lock.pid,
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    let listenerPid: number | undefined;

    try {
      listenerPid = await getOpenclawPortPid();
    } catch {}

    return {
      service: "openclaw",
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
        service: "openclaw",
        status: "stopped",
      };
    }

    throw error;
  }
}

export async function readOpenclawDevLog(): Promise<DevLogTail> {
  const snapshot = await getCurrentOpenclawDevSnapshot();

  ensure(Boolean(snapshot.logFilePath)).orThrow(
    () => new Error("openclaw dev log is unavailable"),
  );

  return readLogTailFromFile(snapshot.logFilePath as string);
}
