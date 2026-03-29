import { type ChildProcess, spawn } from "node:child_process";

import {
  createNodeOptions,
  removeDevLock,
  terminateProcess,
  waitForChildExit,
  writeDevLock,
} from "@nexu/dev-utils";

import {
  createOpenclawInjectedEnv,
  getOpenclawWorkingDirectoryPath,
  getScriptsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { openclawDevLockPath } from "../shared/paths.js";
import { createDevTraceEnv } from "../shared/trace.js";

const runId = process.env.NEXU_DEV_OPENCLAW_RUN_ID;
const sessionId = process.env.NEXU_DEV_SESSION_ID;

if (!runId) {
  throw new Error("NEXU_DEV_OPENCLAW_RUN_ID is required");
}

if (!sessionId) {
  throw new Error("NEXU_DEV_SESSION_ID is required");
}

const openclawRunId = runId;
const openclawSessionId = sessionId;
const runtimeConfig = getScriptsDevRuntimeConfig();
const supervisorStartedAt = Date.now();

function logSupervisorTiming(stage: string): void {
  console.log(
    `[scripts-dev][openclaw-supervisor] ${stage} elapsedMs=${Date.now() - supervisorStartedAt}`,
  );
}

function createOpenclawWorkerCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [
      runtimeConfig.openclawEntryPath,
      "gateway",
      "run",
      "--allow-unconfigured",
      "--bind",
      "loopback",
      "--port",
      String(runtimeConfig.openclawPort),
      "--force",
      "--verbose",
    ],
  };
}

let workerChild: ChildProcess | null = null;

async function writeRunningLock(): Promise<void> {
  await writeDevLock(openclawDevLockPath, {
    pid: process.pid,
    runId: openclawRunId,
    sessionId: openclawSessionId,
  });
}

async function removeRunningLock(): Promise<void> {
  await removeDevLock(openclawDevLockPath);
}

async function startWorker(): Promise<void> {
  const commandSpec = createOpenclawWorkerCommand();
  logSupervisorTiming("worker-spawn:start");
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd: getOpenclawWorkingDirectoryPath(),
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createOpenclawInjectedEnv(),
      ...createDevTraceEnv({
        sessionId: openclawSessionId,
        service: "openclaw",
        role: "worker",
      }),
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("openclaw worker did not expose a pid");
  }

  workerChild = child;
  logSupervisorTiming(`worker-spawn:pid=${child.pid}`);

  child.once("exit", () => {
    logSupervisorTiming("worker-exit");
    workerChild = null;
  });
}

async function shutdown(): Promise<void> {
  if (workerChild?.pid) {
    await terminateProcess(workerChild.pid);
    await waitForChildExit(workerChild);
  }

  await removeRunningLock();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

logSupervisorTiming("module-started");
await writeRunningLock();
logSupervisorTiming("lock-written");
await startWorker();
logSupervisorTiming("worker-start-dispatched");
