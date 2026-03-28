import { createManagedPortStrategy } from "../shared/port-strategy";
import { createDefaultRuntimeExecutableResolver } from "../shared/runtime-executables";
import { resolveManagedRuntimeRoots } from "../shared/runtime-roots";
import { createManagedShutdownCoordinator } from "../shared/shutdown-coordinator";
import { createSyncTarSidecarMaterializer } from "../shared/sidecar-materializer";
import { createNoopStateMigrationPolicy } from "../shared/state-migration-policy";
import type { DesktopPlatformCapabilities } from "../types";

export function createDefaultPlatformCapabilities(): DesktopPlatformCapabilities {
  return {
    platformId: "default",
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
