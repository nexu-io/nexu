import { app } from "electron";
import type {
  DesktopShutdownCoordinator,
  InstallShutdownCoordinatorArgs,
} from "../types";

export function createManagedShutdownCoordinator(): DesktopShutdownCoordinator {
  return {
    install({
      diagnosticsReporter,
      flushRuntimeLoggers,
      residencyContext,
      orchestrator,
      sleepGuardDispose,
    }: InstallShutdownCoordinatorArgs) {
      app.on("before-quit", (event) => {
        sleepGuardDispose("app-before-quit");
        void diagnosticsReporter?.flushNow().catch(() => undefined);
        flushRuntimeLoggers();

        if (residencyContext) {
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

export function createNoopShutdownCoordinator(): DesktopShutdownCoordinator {
  return {
    install(_args: InstallShutdownCoordinatorArgs) {},
  };
}
