import { type ChildProcess, spawn } from "node:child_process";
import chokidar from "chokidar";

import {
  createNodeOptions,
  removeDevLock,
  resolveTsxPaths,
  terminateProcess,
  waitFor,
  waitForChildExit,
  writeDevLock,
} from "@nexu/dev-utils";

import { getControllerPortPid } from "../services/controller.js";
import { getToolsDevRuntimeConfig } from "../shared/dev-runtime-config.js";
import {
  controllerDevLockPath,
  controllerSourceDirectoryPath,
  controllerWorkingDirectoryPath,
} from "../shared/paths.js";
import { createDevTraceEnv } from "../shared/trace.js";

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
const runtimeConfig = getToolsDevRuntimeConfig();

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

      throw new Error(
        `controller dev server is still listening on port ${String(runtimeConfig.controllerPort)}`,
      );
    },
    () =>
      new Error(
        `controller dev server did not release port ${String(runtimeConfig.controllerPort)}`,
      ),
  );
}

async function waitForControllerPortPid(): Promise<number> {
  return waitFor(
    () => getControllerPortPid(),
    () =>
      new Error(
        `controller dev server did not open port ${String(runtimeConfig.controllerPort)}`,
      ),
    {
      // Windows cold-start (tsx loader + controller bootstrap) routinely
      // takes ~15s; default 30 attempts × 500ms = 15s was firing right as
      // the listener was about to bind. Give it 60s of headroom.
      attempts: 120,
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

  await startWorker();
}

const watcher = chokidar.watch(controllerSourceDirectoryPath, {
  ignoreInitial: true,
});

let restartPending = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

watcher.on("all", () => {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    if (restartPending) return;
    restartPending = true;
    try {
      await restartWorker();
    } catch (error) {
      console.error("[controller] restart failed:", error);
    } finally {
      restartPending = false;
    }
  }, 500);
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
