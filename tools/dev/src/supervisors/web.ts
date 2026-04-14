import { type ChildProcess, spawn } from "node:child_process";

import {
  createNodeOptions,
  removeDevLock,
  resolveViteBinPath,
  terminateProcess,
  waitForChildExit,
  writeDevLock,
} from "@nexu/dev-utils";

import { getToolsDevRuntimeConfig } from "../shared/dev-runtime-config.js";
import { webDevLockPath, webWorkingDirectoryPath } from "../shared/paths.js";
import { createDevTraceEnv } from "../shared/trace.js";

const runId = process.env.NEXU_DEV_WEB_RUN_ID;
const sessionId = process.env.NEXU_DEV_SESSION_ID;

if (!runId) {
  throw new Error("NEXU_DEV_WEB_RUN_ID is required");
}

if (!sessionId) {
  throw new Error("NEXU_DEV_SESSION_ID is required");
}

const webRunId = runId;
const webSessionId = sessionId;
const runtimeConfig = getToolsDevRuntimeConfig();

function createWebWorkerCommand(): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [
      resolveViteBinPath(webWorkingDirectoryPath),
      "--host",
      "127.0.0.1",
      "--port",
      String(runtimeConfig.webPort),
      "--strictPort",
    ],
  };
}

let workerChild: ChildProcess | null = null;

async function writeRunningLock(): Promise<void> {
  await writeDevLock(webDevLockPath, {
    pid: process.pid,
    runId: webRunId,
    sessionId: webSessionId,
  });
}

async function removeRunningLock(): Promise<void> {
  await removeDevLock(webDevLockPath);
}

async function startWorker(): Promise<void> {
  const commandSpec = createWebWorkerCommand();
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd: webWorkingDirectoryPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDevTraceEnv({
        sessionId: webSessionId,
        service: "web",
        role: "worker",
      }),
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("web worker did not expose a pid");
  }

  workerChild = child;

  child.once("exit", () => {
    workerChild = null;
  });
}

process.on("SIGINT", async () => {
  if (workerChild?.pid) {
    await terminateProcess(workerChild.pid);
    await waitForChildExit(workerChild);
  }

  await removeRunningLock();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (workerChild?.pid) {
    await terminateProcess(workerChild.pid);
    await waitForChildExit(workerChild);
  }

  await removeRunningLock();
  process.exit(0);
});

await writeRunningLock();
await startWorker();
