import { type ChildProcess, spawn } from "node:child_process";
import chokidar from "chokidar";

import {
  createNodeOptions,
  removeDevLock,
  resolveTsxPaths,
  terminateProcess,
  waitFor,
  writeDevLock,
} from "@nexu/dev-utils";

import { waitForChildExit } from "./children.js";
import { getControllerPortPid } from "./controller-dev.js";
import {
  controllerDevLockPath,
  controllerSourceDirectoryPath,
  controllerWorkingDirectoryPath,
} from "./dev-paths.js";
import { createDevTraceEnv } from "./dev-trace.js";

const runId = process.env.NEXU_DEV_CONTROLLER_RUN_ID;
const logFilePath = process.env.NEXU_DEV_CONTROLLER_LOG_PATH;
const sessionId = process.env.NEXU_DEV_SESSION_ID;

if (!runId) {
  throw new Error("NEXU_DEV_CONTROLLER_RUN_ID is required");
}

if (!logFilePath) {
  throw new Error("NEXU_DEV_CONTROLLER_LOG_PATH is required");
}

if (!sessionId) {
  throw new Error("NEXU_DEV_SESSION_ID is required");
}

const controllerRunId = runId;
const controllerSessionId = sessionId;

function createControllerWorkerCommand(): { command: string; args: string[] } {
  const { loaderUrl, preflightPath } = resolveTsxPaths();

  return {
    command: process.execPath,
    args: ["--require", preflightPath, "--import", loaderUrl, "src/index.ts"],
  };
}

async function waitForControllerPortRelease(): Promise<void> {
  await waitFor(
    async () => {
      try {
        await getControllerPortPid();
      } catch {
        return;
      }

      throw new Error("controller dev server is still listening on port 3010");
    },
    () => new Error("controller dev server did not release port 3010"),
  );
}

async function waitForControllerPortPid(): Promise<number> {
  return waitFor(
    () => getControllerPortPid(),
    () => new Error("controller dev server did not open port 3010"),
    {
      attempts: 30,
    },
  );
}

let workerChild: ChildProcess | null = null;

async function writeRunningLock(): Promise<void> {
  await writeDevLock(controllerDevLockPath, {
    pid: process.pid,
    runId: controllerRunId,
    sessionId: controllerSessionId,
  });
}

async function removeRunningLock(): Promise<void> {
  await removeDevLock(controllerDevLockPath);
}

async function startWorker(): Promise<void> {
  const commandSpec = createControllerWorkerCommand();
  const child = spawn(commandSpec.command, commandSpec.args, {
    cwd: controllerWorkingDirectoryPath,
    env: {
      ...process.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDevTraceEnv({
        sessionId: controllerSessionId,
        service: "controller",
        role: "worker",
      }),
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("controller worker did not expose a pid");
  }

  workerChild = child;
  await waitForControllerPortPid();

  child.once("exit", () => {
    workerChild = null;
  });
}

async function restartWorker(): Promise<void> {
  if (workerChild?.pid) {
    await terminateProcess(workerChild.pid);
    await waitForChildExit(workerChild);
    await waitForControllerPortRelease();
  }

  console.log("[scripts-dev] controller watcher restarting worker");
  await startWorker();
}

const watcher = chokidar.watch(controllerSourceDirectoryPath, {
  ignoreInitial: true,
});

watcher.on("all", async () => {
  try {
    await restartWorker();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
});

process.on("SIGINT", async () => {
  await watcher.close();

  if (workerChild?.pid) {
    await terminateProcess(workerChild.pid);
    await waitForChildExit(workerChild);
  }

  await removeRunningLock();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await watcher.close();

  if (workerChild?.pid) {
    await terminateProcess(workerChild.pid);
    await waitForChildExit(workerChild);
  }

  await removeRunningLock();
  process.exit(0);
});

await writeRunningLock();
await startWorker();
