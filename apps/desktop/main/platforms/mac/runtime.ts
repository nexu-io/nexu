import { createManagedRuntimePlatformAdapter } from "../shared/runtime-common";
import type { DesktopRuntimePlatformAdapter } from "../types";
import {
  createMacLaunchdCapabilities,
  createMacManagedCapabilities,
} from "./capabilities";
import {
  coldStartMacLaunchdResidency,
  installMacLaunchdShutdownCoordinator,
  prepareMacLaunchdUpdateInstall,
  recoverMacLaunchdSession,
  shouldUseMacLaunchdRuntime,
} from "./launchd-lifecycle";

export function createMacRuntimePlatformAdapter(): DesktopRuntimePlatformAdapter {
  const capabilities = createMacLaunchdCapabilities();
  const runtimeStateRef = {
    launchd: null,
    labels: null,
    webServer: undefined,
  };

  return {
    id: "mac",
    capabilities,
    lifecycle: {
      residency: "launchd",
      prepareRuntimeConfig: ({ baseRuntimeConfig, logStartupStep }) => {
        logStartupStep("mac:prepareRuntimeConfig:launchd");
        return Promise.resolve({
          allocations: [],
          runtimeConfig: baseRuntimeConfig,
        });
      },
      recoverSession: (args) => recoverMacLaunchdSession(args),
      coldStartOrAttach: (args) =>
        coldStartMacLaunchdResidency(capabilities, runtimeStateRef, args),
      installShutdownCoordinator: (args) =>
        installMacLaunchdShutdownCoordinator(runtimeStateRef, args),
      prepareForUpdateInstall: (args) =>
        prepareMacLaunchdUpdateInstall(runtimeStateRef, args),
    },
  };
}

export { shouldUseMacLaunchdRuntime };

export function createFallbackMacRuntimePlatformAdapter() {
  return createManagedRuntimePlatformAdapter(
    "mac",
    createMacManagedCapabilities(),
  );
}
