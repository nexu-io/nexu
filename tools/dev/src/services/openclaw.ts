import { join } from "node:path";

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
import { prepareSlimclawRuntimeStage } from "@nexu/slimclaw";

import {
  createOpenclawInjectedEnv,
  getToolsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { logger as rootLogger } from "../shared/logger.js";
import {
  type DevLogTail,
  readLatestNamedLogTail,
  readLogTailFromFile,
} from "../shared/logs.js";
import {
  getOpenclawDevLogPath,
  getOpenclawRuntimeStageRootPath,
  openclawDevLockPath,
  openclawSupervisorPath,
} from "../shared/paths.js";
import { createDevMarkerArgs } from "../shared/trace.js";

const logger = rootLogger.child({
  component: "openclaw-service",
  service: "openclaw",
});

export type OpenclawDevSnapshot = {
  service: "openclaw";
  status: "running" | "stopped" | "stale";
  pid?: number;
  supervisorPid?: number;
  workerPid?: number;
  listenerPid?: number;
  staleReason?: string;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
};

type OpenclawReadyProbeResult = { ok: true } | { ok: false; reason: string };

async function readLatestOpenclawLogHint(
  logFilePath: string | undefined,
): Promise<string | undefined> {
  if (!logFilePath) {
    return undefined;
  }

  try {
    const logTail = await readLogTailFromFile(logFilePath, 20);
    const lines = logTail.content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const latestLine = lines.at(-1);

    if (!latestLine) {
      return undefined;
    }

    return latestLine.length > 220
      ? `${latestLine.slice(0, 217)}...`
      : latestLine;
  } catch {
    return undefined;
  }
}

function logOpenclawTiming(stage: string, startedAt: number): void {
  logger.debug("openclaw timing", {
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
    getToolsDevRuntimeConfig().openclawPort,
    "openclaw gateway",
  );
}

async function waitForOpenclawPortPid(
  supervisorPid: number,
  logFilePath?: string,
): Promise<number> {
  const port = getToolsDevRuntimeConfig().openclawPort;
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
      const latestLogHint = await readLatestOpenclawLogHint(logFilePath);

      logger.info("waiting for openclaw gateway port", {
        supervisorPid,
        port,
        elapsedMs: Date.now() - waitStartedAt,
        latestLogHint,
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

async function waitForOpenclawReady(
  supervisorPid: number,
  logFilePath?: string,
): Promise<void> {
  const runtimeConfig = getToolsDevRuntimeConfig();
  const healthUrl = `${runtimeConfig.openclawBaseUrl}/health`;
  const attempts = 20;
  const delayMs = 500;
  const waitStartedAt = Date.now();
  let lastFailureReason = "unknown health probe failure";

  for (let index = 0; index < attempts; index += 1) {
    const readyProbe = await getOpenclawReadyStatus();

    if (readyProbe.ok) {
      return;
    }

    lastFailureReason = readyProbe.reason;

    if (!isProcessRunning(supervisorPid)) {
      throw new Error("openclaw supervisor exited before health check passed");
    }

    if ((index + 1) % 4 === 0) {
      const latestLogHint = await readLatestOpenclawLogHint(logFilePath);

      logger.info("waiting for openclaw health endpoint", {
        supervisorPid,
        readyUrl: healthUrl,
        lastFailureReason,
        elapsedMs: Date.now() - waitStartedAt,
        latestLogHint,
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
    `openclaw health endpoint did not become ready at ${healthUrl} (${lastFailureReason})`,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOpenclawReadyStatus(): Promise<OpenclawReadyProbeResult> {
  const runtimeConfig = getToolsDevRuntimeConfig();

  try {
    const response = await fetch(`${runtimeConfig.openclawBaseUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });

    if (response.ok) {
      return { ok: true };
    }

    const body = await response.text().catch(() => "");

    return {
      ok: false,
      reason: body
        ? `http ${response.status}: ${body}`
        : `http ${response.status}`,
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        ok: false,
        reason: `${error.name}: ${error.message}`,
      };
    }

    return {
      ok: false,
      reason: String(error),
    };
  }
}

async function getStableOpenclawReadyStatus(): Promise<OpenclawReadyProbeResult> {
  const attempts = 3;

  for (let index = 0; index < attempts; index += 1) {
    const result = await getOpenclawReadyStatus();

    if (result.ok) {
      return result;
    }

    if (!result.reason.includes("TimeoutError")) {
      return result;
    }

    if (index < attempts - 1) {
      await sleep(200);
    }
  }

  return {
    ok: false,
    reason: "TimeoutError: health probe timed out after 3 attempts",
  };
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
  logger.info("preparing staged openclaw runtime", {
    targetStageRoot: getOpenclawRuntimeStageRootPath(),
  });

  const stage = await prepareSlimclawRuntimeStage({
    targetStageRoot: getOpenclawRuntimeStageRootPath(),
    log: (message) => logger.info(message),
  });

  logger.info("using patched staged openclaw runtime", {
    stagedOpenclawRoot: stage.stagedOpenclawRoot,
    fingerprint: stage.fingerprint,
    reused: stage.reused,
    patchedFileCount: stage.patchedFileCount,
  });

  return join(stage.stagedOpenclawRoot, "openclaw.mjs");
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
  const runtimeConfig = getToolsDevRuntimeConfig();
  const runLogger = logger.child({
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
  logger.info("starting openclaw supervisor", {
    sessionId,
    logFilePath,
  });

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
    logger: runLogger,
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

  logger.info("waiting for openclaw gateway listener", {
    supervisorPid,
    port: runtimeConfig.openclawPort,
  });

  try {
    listenerPid = await waitForOpenclawPortPid(supervisorPid, logFilePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. Inspect ${logFilePath} for OpenClaw startup details.`,
    );
  }

  logOpenclawTiming(`listener-pid=${listenerPid}`, startedAt);
  logger.info("waiting for openclaw health", {
    supervisorPid,
    readyUrl: `${runtimeConfig.openclawBaseUrl}/health`,
  });

  try {
    await waitForOpenclawReady(supervisorPid, logFilePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}. Inspect ${logFilePath} for OpenClaw startup details.`,
    );
  }

  logOpenclawTiming("ready", startedAt);

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

    const readyProbe = await getStableOpenclawReadyStatus();

    if (listenerPid && readyProbe.ok) {
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
      staleReason: listenerPid
        ? `openclaw health endpoint is not ready (${readyProbe.reason})`
        : "openclaw listener is not running",
      runId: lock.runId,
      sessionId: lock.sessionId,
      logFilePath,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      try {
        const listenerPid = await getOpenclawPortPid();

        const readyProbe = await getStableOpenclawReadyStatus();

        if (!readyProbe.ok) {
          throw new Error(
            `openclaw health endpoint is not ready (${readyProbe.reason})`,
          );
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

  if (snapshot.logFilePath) {
    return readLogTailFromFile(snapshot.logFilePath);
  }

  const latestLog = await readLatestNamedLogTail("openclaw.log");

  ensure(Boolean(latestLog)).orThrow(
    () => new Error("openclaw dev log is unavailable"),
  );

  return latestLog as DevLogTail;
}
