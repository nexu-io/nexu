import { app } from "electron";
import { getDefaultPlistDir, installLaunchdQuitHandler } from "../../services";
import type {
  DesktopShutdownCoordinator,
  InstallShutdownCoordinatorArgs,
} from "../types";

export function createManagedShutdownCoordinator(): DesktopShutdownCoordinator {
  return {
    install({
      diagnosticsReporter,
      flushRuntimeLoggers,
      launchdResult,
      orchestrator,
      sleepGuardDispose,
    }: InstallShutdownCoordinatorArgs) {
      app.on("before-quit", (event) => {
        sleepGuardDispose("app-before-quit");
        void diagnosticsReporter?.flushNow().catch(() => undefined);
        flushRuntimeLoggers();

        if (launchdResult) {
          return;
        }

        event.preventDefault();
        orchestrator
          .dispose()
          .catch(() => undefined)
          .finally(() => {
            app.removeAllListeners("before-quit");
            app.quit();
          });
      });
    },
  };
}

export function createLaunchdShutdownCoordinator(): DesktopShutdownCoordinator {
  return {
    install({
      app: electronApp,
      diagnosticsReporter,
      flushRuntimeLoggers,
      launchdResult,
      mainWindow: _mainWindow,
      orchestrator: _orchestrator,
      sleepGuardDispose,
    }: InstallShutdownCoordinatorArgs) {
      if (launchdResult) {
        installLaunchdQuitHandler({
          launchd: launchdResult.launchd,
          labels: launchdResult.labels,
          webServer: launchdResult.webServer,
          plistDir: getDefaultPlistDir(!electronApp.isPackaged),
          onBeforeQuit: async () => {
            sleepGuardDispose("launchd-quit");
            await diagnosticsReporter?.flushNow().catch(() => undefined);
            flushRuntimeLoggers();
          },
        });
      }

      app.on("before-quit", (event) => {
        sleepGuardDispose("app-before-quit");
        void diagnosticsReporter?.flushNow().catch(() => undefined);
        flushRuntimeLoggers();

        if (launchdResult) {
          return;
        }

        event.preventDefault();
      });
    },
  };
}
