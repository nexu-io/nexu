import {
  createNodeOptions,
  ensureDirectory,
  ensureParentDirectory,
  getListeningPortPid,
  isProcessRunning,
  readDevLock,
  removeDevLock,
  repoRootPath,
  resolveTsxPaths,
  spawnHiddenProcess,
  terminateProcess,
  waitForProcessStart,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import {
  createOpenclawInjectedEnv,
  getScriptsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { getScriptsDevLogger } from "../shared/logger.js";
import { type DevLogTail, readLogTailFromFile } from "../shared/logs.js";
import { prepareRepoLocalDevOpenclawRuntime } from "../shared/openclaw-runtime-bridge.js";
import {
  getOpenclawDevLogPath,
  getOpenclawRuntimeStageRootPath,
  openclawDevLockPath,
  openclawSupervisorPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";

export type OpenclawDevSnapshot = {
  service: "openclaw";
  status: "running" | "stopped" | "stale";
  pid?: number;
  supervisorPid?: number;
  workerPid?: number;
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
  const logger = getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
  });

  logger.info("selected tsx supervisor entrypoint for openclaw dev startup", {
    command: process.execPath,
    args: [cliPath, openclawSupervisorPath],
  });

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
  const logger = getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
  });
  const port = getScriptsDevRuntimeConfig().openclawPort;
  const attempts = 120;
  const delayMs = 500;
  const heartbeatEveryAttempts = 4;
  const waitStartedAt = Date.now();

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await getListeningPortPid(port, "openclaw gateway");
    } catch {}

    if (!isProcessRunning(supervisorPid)) {
      throw new Error(`openclaw supervisor exited before opening port ${port}`);
    }

    if ((index + 1) % heartbeatEveryAttempts === 0) {
      logger.info("waiting for openclaw gateway port", {
        supervisorPid,
        port,
        elapsedMs: Date.now() - waitStartedAt,
      });
    }

    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!isProcessRunning(supervisorPid)) {
    throw new Error(`openclaw supervisor exited before opening port ${port}`);
  }

  throw new Error(`openclaw gateway did not open port ${port}`);
}

async function waitForOpenclawPortProcessLaunch(
  supervisorPid: number,
): Promise<void> {
  const logger = getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
  });
  const port = getScriptsDevRuntimeConfig().openclawPort;
  const attempts = 30;
  const delayMs = 250;
  const waitStartedAt = Date.now();

  for (let index = 0; index < attempts; index += 1) {
    if (await getOpenclawHealthStatus()) {
      return;
    }

    if (!isProcessRunning(supervisorPid)) {
      throw new Error("openclaw supervisor exited before health check passed");
    }

    if ((index + 1) % 4 === 0) {
      logger.info("waiting for openclaw health endpoint", {
        supervisorPid,
        port,
        elapsedMs: Date.now() - waitStartedAt,
      });
    }

    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!isProcessRunning(supervisorPid)) {
    throw new Error("openclaw supervisor exited before health check passed");
  }

  throw new Error(
    `openclaw health endpoint did not become ready at ${getScriptsDevRuntimeConfig().openclawBaseUrl}/health`,
  );
}

async function waitForOpenclawHealth(supervisorPid: number): Promise<void> {
  const logger = getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
  });
  const runtimeConfig = getScriptsDevRuntimeConfig();
  const healthUrl = `${runtimeConfig.openclawBaseUrl}/health`;
  const attempts = 20;
  const delayMs = 500;
  const waitStartedAt = Date.now();

  for (let index = 0; index < attempts; index += 1) {
    if (await getOpenclawHealthStatus()) {
      return;
    }

    if (!isProcessRunning(supervisorPid)) {
      throw new Error("openclaw supervisor exited before health check passed");
    }

    if ((index + 1) % 4 === 0) {
      logger.info("waiting for openclaw health endpoint", {
        supervisorPid,
        healthUrl,
        elapsedMs: Date.now() - waitStartedAt,
      });
    }

    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!isProcessRunning(supervisorPid)) {
    throw new Error("openclaw supervisor exited before health check passed");
  }

  throw new Error(
    `openclaw health endpoint did not become ready at ${healthUrl}`,
  );
}

async function getOpenclawHealthStatus(): Promise<boolean> {
  const runtimeConfig = getScriptsDevRuntimeConfig();

  try {
    const response = await fetch(`${runtimeConfig.openclawBaseUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function waitForOpenclawCurrentLock(options: {
  runId: string;
  sessionId: string;
}): Promise<Awaited<ReturnType<typeof readDevLock>> | null> {
  const attempts = 20;
  const delayMs = 250;

  for (let index = 0; index < attempts; index += 1) {
    const recordedLock = await readDevLock(openclawDevLockPath).catch(
      () => null,
    );

    if (
      recordedLock?.runId === options.runId &&
      recordedLock.sessionId === options.sessionId
    ) {
      return recordedLock;
    }

    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
}

async function prepareOpenclawEntryPath(): Promise<string> {
  const logger = getScriptsDevLogger({
    component: "openclaw-service",
    service: "openclaw",
  });
  const preparedRuntime = await prepareRepoLocalDevOpenclawRuntime({
    log: (message) => logger.info(message),
  });

  logger.info("using patched staged openclaw runtime", {
    stagedOpenclawRoot: preparedRuntime.stagedOpenclawRoot,
    fingerprint: preparedRuntime.fingerprint,
    reused: preparedRuntime.reused,
    patchedFileCount: preparedRuntime.patchedFileCount,
    manifestPath: preparedRuntime.manifestPath,
  });

  return preparedRuntime.entryPath;
}

export async function startOpenclawDevProcess(options: {
  sessionId: string;
}): Promise<OpenclawDevSnapshot> {
  const startedAt = Date.now();
  const existingSnapshot = await getCurrentOpenclawDevSnapshot();

  if (existingSnapshot.status === "stale") {
    await removeDevLock(openclawDevLockPath);
  }

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
  const openclawEntryPath = await prepareOpenclawEntryPath();

  logOpenclawTiming("filesystem-ready", startedAt);
  logger.info(
    "prepared openclaw runtime entry path from repo-root openclaw runtime bridge",
    {
      openclawEntryPath,
      runtimeStageRoot: getOpenclawRuntimeStageRootPath(),
    },
  );

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
      NEXU_DEV_OPENCLAW_ENTRY_PATH: openclawEntryPath,
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
  let listenerPid: number;

  try {
    listenerPid = await waitForOpenclawPortPid(supervisorPid);
  } catch {
    await waitForOpenclawPortProcessLaunch(supervisorPid);
    listenerPid = await waitForOpenclawPortPid(supervisorPid);
  }

  logOpenclawTiming(`listener-pid=${listenerPid}`, startedAt);

  try {
    await waitForOpenclawHealth(supervisorPid);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. Inspect ${logFilePath} for OpenClaw startup details.`,
    );
  }

  logOpenclawTiming("health-ready", startedAt);

  const recordedLock = await waitForOpenclawCurrentLock({
    runId,
    sessionId,
  });

  logOpenclawTiming("lock-written", startedAt);

  return {
    service: "openclaw",
    status: "running",
    pid: recordedLock?.pid ?? supervisorPid,
    supervisorPid: recordedLock?.pid ?? supervisorPid,
    workerPid: recordedLock?.workerPid,
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

  const pidsToTerminate = new Set<number>();

  if (snapshot.listenerPid) {
    pidsToTerminate.add(snapshot.listenerPid);
  }

  if (snapshot.workerPid) {
    pidsToTerminate.add(snapshot.workerPid);
  }

  if (snapshot.supervisorPid) {
    pidsToTerminate.add(snapshot.supervisorPid);
  }

  if (snapshot.pid) {
    pidsToTerminate.add(snapshot.pid);
  }

  try {
    pidsToTerminate.add(await getOpenclawPortPid());
  } catch {}

  for (const pid of pidsToTerminate) {
    await terminateProcess(pid);
  }

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
    const supervisorPid = lock.pid;
    const workerPid = lock.workerPid;
    let listenerPid: number | undefined;

    try {
      listenerPid = await getOpenclawPortPid();
    } catch {}

    if ((await getOpenclawHealthStatus()) || listenerPid) {
      return {
        service: "openclaw",
        status: "running",
        pid: supervisorPid,
        supervisorPid,
        workerPid,
        listenerPid,
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    return {
      service: "openclaw",
      status: "stale",
      pid: supervisorPid,
      supervisorPid,
      workerPid,
      listenerPid,
      runId: lock.runId,
      sessionId: lock.sessionId,
      logFilePath,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      try {
        const listenerPid = await getOpenclawPortPid();

        if (!(await getOpenclawHealthStatus())) {
          throw new Error("openclaw health endpoint is not ready");
        }

        return {
          service: "openclaw",
          status: "running",
          pid: listenerPid,
          listenerPid,
        };
      } catch {}

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
