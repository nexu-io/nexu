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
import {
  desktopDevLockPath,
  desktopWorkingDirectoryPath,
} from "../shared/paths.js";
import { createDevTraceEnv } from "../shared/trace.js";

const runId = process.env.NEXU_DEV_DESKTOP_RUN_ID;
const sessionId = process.env.NEXU_DEV_SESSION_ID;

if (!runId) {
  throw new Error("NEXU_DEV_DESKTOP_RUN_ID is required");
}

if (!sessionId) {
  throw new Error("NEXU_DEV_SESSION_ID is required");
}

const desktopRunId = runId;
const desktopSessionId = sessionId;

function createDesktopWorkerCommand(): { command: string; args: string[] } {
  const runtimeConfig = getToolsDevRuntimeConfig();

  return {
    command: process.execPath,
    args: [
      resolveViteBinPath(desktopWorkingDirectoryPath),
      "--host",
      runtimeConfig.desktopDevHost,
      "--port",
      String(runtimeConfig.desktopDevPort),
      "--strictPort",
    ],
  };
}

let workerChild: ChildProcess | null = null;

async function writeRunningLock(): Promise<void> {
  await writeDevLock(desktopDevLockPath, {
    pid: process.pid,
    runId: desktopRunId,
    sessionId: desktopSessionId,
  });
}

async function removeRunningLock(): Promise<void> {
  await removeDevLock(desktopDevLockPath);
}

async function startWorker(): Promise<void> {
  const commandSpec = createDesktopWorkerCommand();
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd: desktopWorkingDirectoryPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDevTraceEnv({
        sessionId: desktopSessionId,
        service: "desktop",
        role: "worker",
      }),
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("desktop worker did not expose a pid");
  }

  workerChild = child;

  child.once("exit", () => {
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

await writeRunningLock();
await startWorker();

if (!workerChild) {
  throw new Error("desktop worker exited before supervisor wait could attach");
}

await waitForChildExit(workerChild);
await removeRunningLock();
