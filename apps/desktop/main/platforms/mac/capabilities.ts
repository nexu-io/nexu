import {
  createLaunchdPortStrategy,
  createManagedPortStrategy,
} from "../shared/port-strategy";
import { createDefaultRuntimeExecutableResolver } from "../shared/runtime-executables";
import {
  resolveLaunchdRuntimeRoots,
  resolveManagedRuntimeRoots,
} from "../shared/runtime-roots";
import {
  createManagedShutdownCoordinator,
  createNoopShutdownCoordinator,
} from "../shared/shutdown-coordinator";
import { createSyncTarSidecarMaterializer } from "../shared/sidecar-materializer";
import {
  createMacPackagedStateMigrationPolicy,
  createNoopStateMigrationPolicy,
} from "../shared/state-migration-policy";
import type { DesktopPlatformCapabilities } from "../types";

export function createMacLaunchdCapabilities(): DesktopPlatformCapabilities {
  return {
    platformId: "mac",
    runtimeResidency: "launchd",
    packagedArchive: {
      format: "tar.gz",
      extractionMode: "sync",
      supportsAtomicSwap: false,
    },
    resolveRuntimeRoots: resolveLaunchdRuntimeRoots,
    sidecarMaterializer: createSyncTarSidecarMaterializer(),
    runtimeExecutables: createDefaultRuntimeExecutableResolver(),
    portStrategy: createLaunchdPortStrategy(),
    stateMigrationPolicy: createMacPackagedStateMigrationPolicy(),
    shutdownCoordinator: createNoopShutdownCoordinator(),
  };
}

export function createMacManagedCapabilities(): DesktopPlatformCapabilities {
  return {
    platformId: "mac",
    runtimeResidency: "managed",
    packagedArchive: {
      format: "tar.gz",
      extractionMode: "sync",
      supportsAtomicSwap: false,
    },
    resolveRuntimeRoots: resolveManagedRuntimeRoots,
    sidecarMaterializer: createSyncTarSidecarMaterializer(),
    runtimeExecutables: createDefaultRuntimeExecutableResolver(),
    portStrategy: createManagedPortStrategy(),
    stateMigrationPolicy: createNoopStateMigrationPolicy(),
    shutdownCoordinator: createManagedShutdownCoordinator(),
  };
}
