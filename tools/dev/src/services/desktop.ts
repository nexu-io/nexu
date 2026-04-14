import { execFile, spawn } from "node:child_process";
import {
  createNodeOptions,
  devTmpPath,
  ensureParentDirectory,
  getListeningPortPid,
  isProcessRunning,
  readDevLock,
  removeDevLock,
  resolveViteBinPath,
  spawnHiddenProcess,
  waitFor,
  waitForListeningPortPid,
  waitForProcessStart,
  writeDevLock,
} from "@nexu/dev-utils";
import { ensure } from "@nexu/shared";

import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createDesktopInjectedEnv,
  getToolsDevRuntimeConfig,
} from "../shared/dev-runtime-config.js";
import { logger as rootLogger } from "../shared/logger.js";
import {
  type DevLogTail,
  readLatestNamedLogTail,
  readLogTailFromFile,
} from "../shared/logs.js";
import {
  desktopDevLockPath,
  desktopWorkingDirectoryPath,
  getDesktopDevLogPath,
} from "../shared/paths.js";
import {
  createDesktopElectronLaunchSpec,
  findDesktopDevMainPid,
  terminateDesktopDevProcesses,
} from "../shared/platform/desktop-dev-platform.js";
import { getCurrentControllerDevSnapshot } from "./controller.js";
import { getCurrentWebDevSnapshot } from "./web.js";

const logger = rootLogger.child({
  component: "desktop-service",
  service: "desktop",
});

export type DesktopDevSnapshot = {
  service: "desktop";
  status: "running" | "stopped" | "stale";
  pid?: number;
  workerPid?: number;
  inspectPid?: number;
  staleReason?: string;
  launchId?: string;
  runId?: string;
  sessionId?: string;
  logFilePath?: string;
  inspectUrl?: string;
};

type DesktopLaunchEnv = {
  env: NodeJS.ProcessEnv;
  launchId: string;
};

type DetachedDesktopHandle = {
  pid: number;
  dispose: () => void;
};

type DesktopDevEvalResponse = {
  ok: boolean;
  valueType: string;
  value: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

type DesktopDevDomSnapshotResponse = {
  title: string;
  url: string;
  readyState: string;
  htmlLength: number;
  htmlSummary: string;
};

type DesktopDevRendererLogResponse = {
  entries: Array<{
    id: string;
    ts: string;
    source: "console" | "page-error";
    level: "debug" | "info" | "warning" | "error";
    message: string;
    url: string | null;
    sourceId: string | null;
    line: number | null;
  }>;
  truncated: boolean;
};

type DesktopDevScreenshotResponse = {
  mimeType: "image/png";
  base64: string;
  width: number;
  height: number;
  scaleFactor: number;
};

const execFileAsync = promisify(execFile);

async function ensureDesktopDependenciesReady(): Promise<void> {
  const [controllerSnapshot, webSnapshot] = await Promise.all([
    getCurrentControllerDevSnapshot(),
    getCurrentWebDevSnapshot(),
  ]);

  ensure(controllerSnapshot.status === "running").orThrow(
    () =>
      new Error(
        "controller is not running; start it with `pnpm dev start controller` before starting desktop",
      ),
  );
  ensure(webSnapshot.status === "running").orThrow(
    () =>
      new Error(
        "web is not running; start it with `pnpm dev start web` before starting desktop",
      ),
  );
}

function createDesktopLaunchEnv(): DesktopLaunchEnv {
  const launchId = `desktop-launch-${Date.now()}`;

  return {
    launchId,
    env: {
      ...process.env,
      NEXU_DESKTOP_BUILD_SOURCE:
        process.env.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dev",
      NEXU_DESKTOP_BUILD_BRANCH:
        process.env.NEXU_DESKTOP_BUILD_BRANCH ?? "unknown",
      NEXU_DESKTOP_BUILD_COMMIT:
        process.env.NEXU_DESKTOP_BUILD_COMMIT ?? "unknown",
      NEXU_DESKTOP_BUILD_TIME:
        process.env.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
      NEXU_DESKTOP_LAUNCH_ID: launchId,
    },
  };
}

function createDesktopViteCommand(): {
  command: string;
  args: string[];
} {
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

async function terminateDesktopPid(pid: number, force = false): Promise<void> {
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];

    if (force) {
      args.push("/F");
    }

    try {
      await execFileAsync("taskkill.exe", args, { windowsHide: true });
      return;
    } catch {}
  }

  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {}
}

function spawnWindowsDetachedDesktopProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): DetachedDesktopHandle {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });

  if (!child.pid) {
    throw new Error("desktop electron process did not expose a pid");
  }

  return {
    pid: child.pid,
    dispose: () => {
      child.unref();
    },
  };
}

function shouldRetryDesktopElectronLaunch(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("desktop inspect server did not open port") ||
    error.message.includes(
      "desktop electron main process exited before opening port",
    )
  );
}

async function waitForDesktopShutdown(options?: {
  previousPid?: number;
  launchId?: string;
}): Promise<void> {
  const runtimeConfig = getToolsDevRuntimeConfig();

  await waitFor(
    async () => {
      if (options?.previousPid && isProcessRunning(options.previousPid)) {
        throw new Error("desktop process is still shutting down");
      }

      const desktopMainPid = await findDesktopDevMainPid(options?.launchId);
      if (desktopMainPid) {
        throw new Error("desktop electron process is still shutting down");
      }

      try {
        await getListeningPortPid(
          runtimeConfig.desktopDevPort,
          "desktop dev server",
        );
      } catch {
        try {
          await getListeningPortPid(
            runtimeConfig.desktopInspectPort,
            "desktop inspect server",
          );
        } catch {
          return;
        }

        throw new Error("desktop inspect server is still shutting down");
      }

      throw new Error("desktop dev server is still shutting down");
    },
    () => new Error("desktop dev process did not shut down cleanly"),
    {
      attempts: 40,
      delayMs: 250,
    },
  );
}

async function cleanupStaleDesktopDevServer(): Promise<void> {
  const desktopDevPort = getToolsDevRuntimeConfig().desktopDevPort;

  try {
    const vitePid = await getListeningPortPid(
      desktopDevPort,
      "desktop dev server",
    );
    await terminateDesktopPid(vitePid);
    await waitFor(
      async () => {
        await getListeningPortPid(desktopDevPort, "desktop dev server");
        throw new Error("desktop dev server listener is still active");
      },
      () => new Error("desktop dev server listener did not stop in time"),
      {
        attempts: 20,
        delayMs: 250,
      },
    ).catch(() => {
      return terminateDesktopPid(vitePid, true);
    });
  } catch {}
}

async function getDesktopInspectPortPid(): Promise<number> {
  return getListeningPortPid(
    getToolsDevRuntimeConfig().desktopInspectPort,
    "desktop inspect server",
  );
}

async function waitForDesktopInspectPortPid(
  supervisorPid?: number,
): Promise<number> {
  return waitForListeningPortPid(
    getToolsDevRuntimeConfig().desktopInspectPort,
    "desktop inspect server",
    {
      attempts: 40,
      delayMs: 250,
      supervisorPid,
      supervisorName: "desktop electron main process",
    },
  );
}

async function waitForDesktopBuildOutputs(startedAt: number): Promise<void> {
  const expectedOutputs = [
    join(desktopWorkingDirectoryPath, "dist-electron", "main", "bootstrap.js"),
    join(desktopWorkingDirectoryPath, "dist-electron", "preload", "index.js"),
    join(
      desktopWorkingDirectoryPath,
      "dist-electron",
      "preload",
      "webview-preload.js",
    ),
  ];

  await waitFor(
    async () => {
      await Promise.all(
        expectedOutputs.map(async (filePath) => {
          const fileStat = await stat(filePath);

          if (fileStat.mtimeMs < startedAt) {
            throw new Error(`desktop build output is stale: ${filePath}`);
          }
        }),
      );
    },
    () => new Error("desktop vite build outputs were not refreshed in time"),
    {
      attempts: 40,
      delayMs: 250,
    },
  );
}

async function getDesktopInspectSession(): Promise<{
  inspectUrl: string;
  token: string;
}> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  if (snapshot.status === "stale") {
    throw new Error(
      snapshot.staleReason
        ? `desktop inspect is unavailable because desktop is stale: ${snapshot.staleReason}; restart it with \`pnpm dev restart desktop\``
        : "desktop inspect is unavailable because desktop is stale; restart it with `pnpm dev restart desktop`",
    );
  }

  ensure(snapshot.status === "running").orThrow(
    () =>
      new Error(
        "desktop is not running; start it with `pnpm dev start desktop` first",
      ),
  );
  const token = snapshot.sessionId;

  ensure(Boolean(token)).orThrow(
    () =>
      new Error("desktop inspect token is unavailable for the current session"),
  );

  return {
    inspectUrl: snapshot.inspectUrl,
    token,
  };
}

async function requestDesktopInspect<T>(input: {
  method: "GET" | "POST";
  pathname: string;
  body?: unknown;
}): Promise<T> {
  const { inspectUrl, token } = await getDesktopInspectSession();
  const requestUrl = new URL(input.pathname, inspectUrl);
  const response = await fetch(requestUrl, {
    method: input.method,
    headers: {
      "content-type": "application/json",
      "x-nexu-dev-inspect-token": token,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const payload = (await response.json()) as T | { error?: string };

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? payload.error
        : undefined;

    throw new Error(
      message || `desktop inspect request failed with ${response.status}`,
    );
  }

  return payload as T;
}

export async function captureDesktopDevInspectScreenshot(options?: {
  outputPath?: string;
}): Promise<{
  outputPath: string;
  width: number;
  height: number;
  scaleFactor: number;
}> {
  const result = await requestDesktopInspect<DesktopDevScreenshotResponse>({
    method: "POST",
    pathname: "/screenshot",
  });
  const outputPath =
    options?.outputPath ??
    join(devTmpPath, "inspect", `desktop-${Date.now()}.png`);

  await ensureParentDirectory(outputPath);
  await writeFile(outputPath, Buffer.from(result.base64, "base64"));

  return {
    outputPath,
    width: result.width,
    height: result.height,
    scaleFactor: result.scaleFactor,
  };
}

export async function evaluateDesktopDevInspectScript(
  script: string,
): Promise<DesktopDevEvalResponse> {
  return requestDesktopInspect<DesktopDevEvalResponse>({
    method: "POST",
    pathname: "/eval",
    body: { script },
  });
}

export async function getDesktopDevInspectDomSnapshot(options?: {
  maxHtmlLength?: number;
}): Promise<DesktopDevDomSnapshotResponse> {
  return requestDesktopInspect<DesktopDevDomSnapshotResponse>({
    method: "POST",
    pathname: "/dom",
    body: options,
  });
}

export async function getDesktopDevInspectRendererLogs(options?: {
  limit?: number;
}): Promise<DesktopDevRendererLogResponse> {
  const searchParams = new URLSearchParams();

  if (options?.limit) {
    searchParams.set("limit", String(options.limit));
  }

  return requestDesktopInspect<DesktopDevRendererLogResponse>({
    method: "GET",
    pathname:
      searchParams.size > 0 ? `/logs?${searchParams.toString()}` : "/logs",
  });
}

export async function startDesktopDevProcess(options: {
  sessionId: string;
}): Promise<DesktopDevSnapshot> {
  const runtimeConfig = getToolsDevRuntimeConfig();
  await ensureDesktopDependenciesReady();

  const existingSnapshot = await getCurrentDesktopDevSnapshot();

  if (existingSnapshot.status === "stale") {
    await stopDesktopDevProcess();
  }

  ensure(existingSnapshot.status !== "running").orThrow(
    () =>
      new Error(
        "desktop dev process is already running; run `pnpm dev stop desktop` first",
      ),
  );

  const runId = options.sessionId;
  const sessionId = options.sessionId;
  const logFilePath = getDesktopDevLogPath(runId);
  const desktopLaunch = createDesktopLaunchEnv();
  const desktopViteCommand = createDesktopViteCommand();
  const runLogger = logger.child({
    runId,
    sessionId,
  });

  await ensureParentDirectory(logFilePath);
  await cleanupStaleDesktopDevServer();

  const viteStartedAt = Date.now();
  const viteHandle = await spawnHiddenProcess({
    command: desktopViteCommand.command,
    args: desktopViteCommand.args,
    cwd: desktopWorkingDirectoryPath,
    env: {
      ...desktopLaunch.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDesktopInjectedEnv(),
      NEXU_DESKTOP_DEV_INSPECT_TOKEN: sessionId,
      NEXU_DESKTOP_DISABLE_VITE_ELECTRON_STARTUP: "1",
      NEXU_DEV_DESKTOP_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "desktop",
      NEXU_DEV_ROLE: "worker",
    },
    logFilePath,
    logger: runLogger,
  });

  try {
    if (viteHandle.child) {
      await waitForProcessStart(viteHandle.child, "desktop vite worker");
    }
  } finally {
    viteHandle.dispose();
  }

  await waitForListeningPortPid(
    runtimeConfig.desktopDevPort,
    "desktop dev server",
    {
      attempts: 40,
      delayMs: 250,
      supervisorPid: viteHandle.pid,
      supervisorName: "desktop vite worker",
    },
  );
  await waitForDesktopBuildOutputs(viteStartedAt);

  const electronLaunchSpec = await createDesktopElectronLaunchSpec({
    launchId: desktopLaunch.launchId,
    logFilePath,
    env: {
      ...desktopLaunch.env,
      NODE_OPTIONS: createNodeOptions(),
      ...createDesktopInjectedEnv(),
      NEXU_DESKTOP_DEV_INSPECT_TOKEN: sessionId,
      NEXU_DEV_DESKTOP_RUN_ID: runId,
      NEXU_DEV_SESSION_ID: sessionId,
      NEXU_DEV_SERVICE: "desktop",
      NEXU_DEV_ROLE: "main",
    },
  });

  let desktopMainPid: number | undefined;

  try {
    const launchDesktopElectron = async (): Promise<{
      desktopMainPid: number;
      inspectPid: number;
    }> => {
      let launchedDesktopMainPid: number | undefined;

      try {
        launchedDesktopMainPid =
          process.platform === "win32"
            ? (() => {
                const handle = spawnWindowsDetachedDesktopProcess({
                  command: electronLaunchSpec.command,
                  args: electronLaunchSpec.args,
                  cwd: electronLaunchSpec.cwd,
                  env: electronLaunchSpec.env,
                });
                handle.dispose();
                return handle.pid;
              })()
            : await (async () => {
                const electronHandle = await spawnHiddenProcess({
                  command: electronLaunchSpec.command,
                  args: electronLaunchSpec.args,
                  cwd: electronLaunchSpec.cwd,
                  env: electronLaunchSpec.env,
                  logFilePath,
                  logger,
                });

                electronHandle.dispose();

                return waitFor(
                  async () => {
                    const pid = await findDesktopDevMainPid(
                      desktopLaunch.launchId,
                    );
                    if (!pid) {
                      throw new Error(
                        "desktop electron main process was not detected yet",
                      );
                    }

                    return pid;
                  },
                  () =>
                    new Error(
                      "desktop electron main process did not start in time",
                    ),
                  {
                    attempts: 40,
                    delayMs: 250,
                  },
                );
              })();

        const inspectPid = await waitForDesktopInspectPortPid(
          launchedDesktopMainPid,
        );

        return {
          desktopMainPid: launchedDesktopMainPid,
          inspectPid,
        };
      } catch (error) {
        if (launchedDesktopMainPid) {
          await terminateDesktopDevProcesses(launchedDesktopMainPid, {
            force: true,
            launchId: desktopLaunch.launchId,
          }).catch(() => undefined);

          await waitForDesktopShutdown({
            previousPid: launchedDesktopMainPid,
            launchId: desktopLaunch.launchId,
          }).catch(() => undefined);
        }

        throw error;
      }
    };

    let inspectPid: number;

    try {
      ({ desktopMainPid, inspectPid } = await launchDesktopElectron());
    } catch (error) {
      if (!shouldRetryDesktopElectronLaunch(error)) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      ({ desktopMainPid, inspectPid } = await launchDesktopElectron());
    }

    await writeDevLock(desktopDevLockPath, {
      pid: desktopMainPid,
      workerPid: viteHandle.pid,
      runId,
      sessionId,
      launchId: desktopLaunch.launchId,
    });

    return {
      service: "desktop",
      status: "running",
      pid: desktopMainPid,
      workerPid: viteHandle.pid,
      inspectPid,
      launchId: desktopLaunch.launchId,
      runId,
      sessionId,
      logFilePath,
      inspectUrl: runtimeConfig.desktopInspectUrl,
    };
  } catch (error) {
    await removeDevLock(desktopDevLockPath).catch(() => undefined);

    if (desktopMainPid) {
      await terminateDesktopDevProcesses(desktopMainPid, {
        force: true,
        launchId: desktopLaunch.launchId,
      }).catch(() => undefined);
    }

    if (viteHandle.pid && isProcessRunning(viteHandle.pid)) {
      await terminateDesktopPid(viteHandle.pid, true);
    }

    throw error;
  }
}

export async function stopDesktopDevProcess(): Promise<DesktopDevSnapshot> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  ensure(snapshot.status !== "stopped").orThrow(
    () => new Error("desktop dev process is not running"),
  );

  await terminateDesktopDevProcesses(snapshot.pid, {
    launchId: snapshot.launchId,
  });

  if (snapshot.workerPid && isProcessRunning(snapshot.workerPid)) {
    await terminateDesktopPid(snapshot.workerPid);
  }

  try {
    const desktopVitePid = await getListeningPortPid(
      getToolsDevRuntimeConfig().desktopDevPort,
      "desktop dev server",
    );
    if (isProcessRunning(desktopVitePid)) {
      await terminateDesktopPid(desktopVitePid);
    }
  } catch {}

  try {
    await waitForDesktopShutdown({
      previousPid: snapshot.pid,
      launchId: snapshot.launchId,
    });
  } catch {
    await terminateDesktopDevProcesses(snapshot.pid, {
      force: true,
      launchId: snapshot.launchId,
    });

    if (snapshot.workerPid && isProcessRunning(snapshot.workerPid)) {
      await terminateDesktopPid(snapshot.workerPid, true);
    }

    try {
      const desktopVitePid = await getListeningPortPid(
        getToolsDevRuntimeConfig().desktopDevPort,
        "desktop dev server",
      );
      await terminateDesktopPid(desktopVitePid, true);
    } catch {}

    await waitForDesktopShutdown({
      previousPid: snapshot.pid,
      launchId: snapshot.launchId,
    });
  }

  await removeDevLock(desktopDevLockPath);

  return snapshot;
}

export async function restartDesktopDevProcess(options: {
  sessionId: string;
}): Promise<DesktopDevSnapshot> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  if (snapshot.status === "running") {
    await stopDesktopDevProcess();
  }

  return startDesktopDevProcess(options);
}

export async function getCurrentDesktopDevSnapshot(): Promise<DesktopDevSnapshot> {
  try {
    const lock = await readDevLock(desktopDevLockPath);
    const logFilePath = getDesktopDevLogPath(lock.runId);
    const runtimeConfig = getToolsDevRuntimeConfig();

    const buildSnapshot = async (
      desktopMainPid: number,
    ): Promise<DesktopDevSnapshot> => {
      let inspectPid: number | undefined;

      try {
        await getListeningPortPid(
          runtimeConfig.desktopDevPort,
          "desktop dev server",
        );
      } catch {
        return {
          service: "desktop",
          status: "stale",
          pid: desktopMainPid,
          workerPid: lock.workerPid,
          staleReason: "desktop dev server is not listening",
          launchId: lock.launchId,
          runId: lock.runId,
          sessionId: lock.sessionId,
          logFilePath,
        };
      }

      try {
        inspectPid = await getDesktopInspectPortPid();
      } catch {
        return {
          service: "desktop",
          status: "stale",
          pid: desktopMainPid,
          workerPid: lock.workerPid,
          launchId: lock.launchId,
          staleReason: "desktop inspect server is not listening",
          runId: lock.runId,
          sessionId: lock.sessionId,
          logFilePath,
        };
      }

      return {
        service: "desktop",
        status: "running",
        pid: desktopMainPid,
        workerPid: lock.workerPid,
        inspectPid,
        launchId: lock.launchId,
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
        inspectUrl: runtimeConfig.desktopInspectUrl,
      };
    };

    if (!isProcessRunning(lock.pid)) {
      const desktopMainPid = await findDesktopDevMainPid(lock.launchId);

      if (desktopMainPid) {
        return buildSnapshot(desktopMainPid);
      }

      return {
        service: "desktop",
        status: "stale",
        pid: lock.pid,
        workerPid: lock.workerPid,
        launchId: lock.launchId,
        staleReason: "desktop main pid is not running",
        runId: lock.runId,
        sessionId: lock.sessionId,
        logFilePath,
      };
    }

    return buildSnapshot(lock.pid);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        service: "desktop",
        status: "stopped",
      };
    }

    throw error;
  }
}

export async function readDesktopDevLog(): Promise<DevLogTail> {
  const snapshot = await getCurrentDesktopDevSnapshot();

  if (snapshot.logFilePath) {
    return readLogTailFromFile(snapshot.logFilePath);
  }

  const latestLog = await readLatestNamedLogTail("desktop.log");

  ensure(Boolean(latestLog)).orThrow(
    () => new Error("desktop dev log is unavailable"),
  );

  return latestLog as DevLogTail;
}
