import { readFile } from "node:fs/promises";

import {
  createNodeOptions,
  ensureDirectory,
  ensureParentDirectory,
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

import {
  getWebDevLogPath,
  webDevLockPath,
  webSupervisorPath,
} from "./dev-paths.js";
import { createDevMarkerArgs } from "./dev-trace.js";
import { getListeningPortPid, waitForListeningPortPid } from "./ports.js";

export type WebDevSnapshot = {
  service: "web";
  status: "running" | "stopped" | "stale";
  pid?: number;
  listenerPid?: number;
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
  return getListeningPortPid(5173, "web dev server");
}

async function waitForWebPortPid(): Promise<number> {
  return waitForListeningPortPid(5173, "web dev server", {
    attempts: 20,
    delayMs: 500,
  });
}

export async function startWebDevProcess(options: {
  sessionId: string;
}): Promise<WebDevSnapshot> {
  const existingSnapshot = await getCurrentWebDevSnapshot();

  ensure(existingSnapshot.status !== "running").orThrow(
    () =>
      new Error(
        "web dev process is already running; run `pnpm dev stop` first",
      ),
  );

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getWebDevLogPath(runId);
  const commandSpec = createWebCommand(sessionId);

  await ensureParentDirectory(logFilePath);
  await ensureDirectory(repoRootPath);

  const processHandle = await spawnHiddenProcess({
    command: commandSpec.command,
    args: commandSpec.args,
    cwd: repoRootPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      NEXU_DEV_WEB_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "web",
      NEXU_DEV_ROLE: "supervisor",
    },
    logFilePath,
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

  ensure(snapshot.status === "running" && Boolean(snapshot.pid)).orThrow(
    () => new Error("web dev process is not running"),
  );
  const supervisorPid = snapshot.pid as number;

  await terminateProcess(supervisorPid);

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
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    let listenerPid: number | undefined;

    try {
      listenerPid = await getWebPortPid();
    } catch {}

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

export async function readWebDevLog(): Promise<string> {
  const snapshot = await getCurrentWebDevSnapshot();

  ensure(Boolean(snapshot.logFilePath)).orThrow(
    () => new Error("web dev log is unavailable"),
  );

  return readFile(snapshot.logFilePath as string, "utf8");
}
