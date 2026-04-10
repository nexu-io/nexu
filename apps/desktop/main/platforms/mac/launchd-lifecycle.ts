import { detectStaleLaunchdSession } from "../../lifecycle/launchd-recovery-policy";
import {
  readLaunchdRuntimeSession,
  toLaunchdRuntimeSessionSnapshot,
} from "../../lifecycle/launchd-session-store";
import {
  SERVICE_LABELS,
  bootstrapWithLaunchd,
  checkCriticalPathsLocked,
  ensureNexuProcessesDead,
  getDefaultPlistDir,
  getLogDir,
  installLaunchdQuitHandler,
  teardownLaunchdServices,
} from "../../services";
import { deleteRuntimePorts } from "../../services/launchd-bootstrap";
import { resolveRuntimePlatform } from "../platform-resolver";
import type {
  DesktopRuntimePlatformAdapter,
  InstallShutdownCoordinatorArgs,
  PrepareForUpdateInstallArgs,
  RecoverPlatformSessionArgs,
  RunPlatformColdStartArgs,
  RuntimeTeardownArgs,
} from "../types";
import { resolveLaunchdPaths } from "./launchd-paths";
import {
  createMacLaunchdBootstrapEnv,
  createMacLaunchdResidencyContext,
} from "./launchd-residency";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type LaunchdRuntimeStateRef = {
  launchd: Awaited<ReturnType<typeof bootstrapWithLaunchd>>["launchd"] | null;
  labels: Awaited<ReturnType<typeof bootstrapWithLaunchd>>["labels"] | null;
  webServer?: Awaited<ReturnType<typeof bootstrapWithLaunchd>>["webServer"];
};

export async function recoverMacLaunchdSession({
  app,
  logLifecycleStep,
}: RecoverPlatformSessionArgs): Promise<{
  recovered: boolean;
  snapshot: ReturnType<typeof toLaunchdRuntimeSessionSnapshot> | null;
}> {
  const plistDir = getDefaultPlistDir(!app.isPackaged);
  const metadata = await readLaunchdRuntimeSession(plistDir);

  if (!metadata) {
    logLifecycleStep("no persisted launchd session metadata found");
    return { recovered: false, snapshot: null };
  }

  const staleSession = detectStaleLaunchdSession({
    metadata,
    isElectronAlive: isProcessAlive(metadata.electronPid),
  });
  if (staleSession.stale) {
    logLifecycleStep(staleSession.reason ?? "stale launchd session detected");
  }

  const snapshot = toLaunchdRuntimeSessionSnapshot(metadata);
  logLifecycleStep(
    `found persisted launchd session metadata controller=${metadata.controllerPort} openclaw=${metadata.openclawPort} web=${metadata.webPort}`,
  );
  return { recovered: true, snapshot };
}

export async function prepareMacLaunchdUpdateInstall(
  runtimeStateRef: LaunchdRuntimeStateRef,
  { app, logLifecycleStep, orchestrator }: PrepareForUpdateInstallArgs,
): Promise<{ handled: boolean }> {
  logLifecycleStep("launchd update teardown start");

  const isDev = !app.isPackaged;
  const labels = {
    controller: SERVICE_LABELS.controller(isDev),
    openclaw: SERVICE_LABELS.openclaw(isDev),
  };

  if (runtimeStateRef.launchd) {
    try {
      await teardownLaunchdServices({
        launchd: runtimeStateRef.launchd,
        labels,
        plistDir: getDefaultPlistDir(isDev),
      });
    } catch (error) {
      logLifecycleStep(
        `launchd teardown failed, proceeding: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    await orchestrator.dispose();
  } catch (error) {
    logLifecycleStep(
      `orchestrator dispose failed, proceeding: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let { clean, remainingPids } = await ensureNexuProcessesDead();
  if (!clean) {
    logLifecycleStep(
      `${remainingPids.length} process(es) survived first sweep, retrying`,
    );
    ({ clean, remainingPids } = await ensureNexuProcessesDead({
      timeoutMs: 5_000,
      intervalMs: 200,
    }));
  }

  const { locked, lockedPaths } = await checkCriticalPathsLocked();
  if (locked) {
    logLifecycleStep(
      `aborting install, critical paths still locked: ${lockedPaths.join(", ")}`,
    );
    return { handled: true };
  }

  if (!clean) {
    logLifecycleStep(
      `residual processes remain without critical locks: ${remainingPids.join(", ")}`,
    );
  }

  (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
  return { handled: false };
}

export async function teardownMacLaunchdRuntime({
  app,
  diagnosticsReporter,
  flushRuntimeLoggers,
  residencyContext,
  mainWindow,
  reason,
  sleepGuardDispose,
}: RuntimeTeardownArgs): Promise<{ handled: boolean }> {
  if (!residencyContext) {
    return { handled: false };
  }

  if (reason === "background") {
    mainWindow.hide();
    return { handled: true };
  }

  if (reason !== "app-quit") {
    return { handled: false };
  }

  sleepGuardDispose("launchd-quit");
  await diagnosticsReporter?.flushNow().catch(() => undefined);
  flushRuntimeLoggers();

  try {
    await residencyContext.embeddedWebServer?.close();
  } catch (error) {
    console.error("Error closing web server:", error);
  }

  for (const label of [
    residencyContext.serviceLabels.openclaw,
    residencyContext.serviceLabels.controller,
  ]) {
    try {
      await residencyContext.serviceSupervisor.bootoutService(label);
    } catch (error) {
      console.error(`Error booting out ${label}:`, error);
    }

    try {
      await residencyContext.serviceSupervisor.waitForExit(label, 5000);
    } catch (error) {
      console.warn(
        `waitForExit ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await deleteRuntimePorts(getDefaultPlistDir(!app.isPackaged)).catch(
    () => undefined,
  );

  (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
  app.exit(0);
  return { handled: true };
}

export async function coldStartMacLaunchdResidency(
  capabilities: DesktopRuntimePlatformAdapter["capabilities"],
  runtimeStateRef: LaunchdRuntimeStateRef,
  {
    app,
    diagnosticsReporter,
    electronRoot,
    logColdStart,
    runtimeConfig,
    orchestrator,
    rotateDesktopLogSession,
  }: RunPlatformColdStartArgs,
): Promise<{
  residencyContext: ReturnType<typeof createMacLaunchdResidencyContext>;
}> {
  diagnosticsReporter?.markColdStartRunning("launchd bootstrap");
  logColdStart("starting launchd bootstrap");

  const isDev = !app.isPackaged;
  const paths = await resolveLaunchdPaths(app.isPackaged, electronRoot);
  const runtimeRoots = capabilities.resolveRuntimeRoots({
    app,
    electronRoot,
    runtimeConfig,
  });

  capabilities.stateMigrationPolicy.run({
    runtimeConfig,
    runtimeRoots,
    isPackaged: app.isPackaged,
    pendingUserDataMigration: null,
    log: logColdStart,
  });

  const launchdBootstrapResult = await bootstrapWithLaunchd({
    ...createMacLaunchdBootstrapEnv({
      app,
      electronRoot,
      runtimeConfig,
      runtimeRoots,
      capabilities,
      paths,
    }),
    plistDir: getDefaultPlistDir(isDev),
  });

  orchestrator.enableLaunchdMode(
    launchdBootstrapResult.launchd,
    {
      controller: SERVICE_LABELS.controller(isDev),
      openclaw: SERVICE_LABELS.openclaw(isDev),
    },
    getLogDir(isDev ? runtimeRoots.nexuHome : undefined),
  );

  const residencyContext = createMacLaunchdResidencyContext(
    launchdBootstrapResult,
  );
  const { controllerPort, openclawPort, webPort } =
    residencyContext.effectivePorts;
  runtimeConfig.ports.controller = controllerPort;
  runtimeConfig.ports.web = webPort;
  runtimeConfig.urls.controllerBase = `http://127.0.0.1:${controllerPort}`;
  runtimeConfig.urls.web = `http://127.0.0.1:${webPort}`;
  runtimeConfig.urls.openclawBase = `http://127.0.0.1:${openclawPort}`;

  if (residencyContext.attached) {
    logColdStart(
      `attached to running services (controller=${controllerPort} openclaw=${openclawPort} web=${webPort})`,
    );
  } else {
    logColdStart("launchd services started, waiting for controller readiness");
    diagnosticsReporter?.markColdStartRunning(
      "waiting for controller readiness",
    );
    await residencyContext.controllerReady;
    logColdStart("controller ready");
  }

  const sessionId = rotateDesktopLogSession();
  logColdStart(`launchd cold start complete sessionId=${sessionId}`);
  diagnosticsReporter?.markColdStartSucceeded();

  runtimeStateRef.launchd = launchdBootstrapResult.launchd;
  runtimeStateRef.labels = launchdBootstrapResult.labels;
  runtimeStateRef.webServer = launchdBootstrapResult.webServer;

  return { residencyContext };
}

export function installMacLaunchdShutdownCoordinator(
  runtimeStateRef: LaunchdRuntimeStateRef,
  {
    app: electronApp,
    diagnosticsReporter,
    flushRuntimeLoggers,
    residencyContext,
    mainWindow,
    orchestrator,
    sleepGuardDispose,
  }: InstallShutdownCoordinatorArgs,
): void {
  if (residencyContext) {
    installLaunchdQuitHandler({
      launchd:
        runtimeStateRef.launchd ??
        (residencyContext.serviceSupervisor as never),
      labels: residencyContext.serviceLabels,
      webServer: residencyContext.embeddedWebServer,
      plistDir: getDefaultPlistDir(!electronApp.isPackaged),
      onQuitCompletely: () => {
        void teardownMacLaunchdRuntime({
          app: electronApp,
          diagnosticsReporter,
          flushRuntimeLoggers,
          residencyContext,
          mainWindow,
          orchestrator,
          reason: "app-quit",
          sleepGuardDispose,
        });
      },
      onRunInBackground: () => {
        void teardownMacLaunchdRuntime({
          app: electronApp,
          diagnosticsReporter,
          flushRuntimeLoggers,
          residencyContext,
          mainWindow,
          orchestrator,
          reason: "background",
          sleepGuardDispose,
        });
      },
    });
  }

  electronApp.on("before-quit", (event) => {
    sleepGuardDispose("app-before-quit");
    void diagnosticsReporter?.flushNow().catch(() => undefined);
    flushRuntimeLoggers();

    if (residencyContext) {
      return;
    }

    event.preventDefault();
  });
}

export function shouldUseMacLaunchdRuntime(): boolean {
  if (process.env.NEXU_USE_LAUNCHD === "0") return false;
  if (process.env.NEXU_USE_LAUNCHD === "1") return true;
  if (process.env.CI) return false;
  const isPackaged = !process.execPath.includes("node_modules");
  return isPackaged && resolveRuntimePlatform() === "mac";
}
