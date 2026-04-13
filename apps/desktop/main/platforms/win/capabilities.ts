import { createManagedPortStrategy } from "../shared/port-strategy";
import { createDefaultRuntimeExecutableResolver } from "../shared/runtime-executables";
import { resolveManagedRuntimeRoots } from "../shared/runtime-roots";
import { createManagedShutdownCoordinator } from "../shared/shutdown-coordinator";
import { createAsyncArchiveSidecarMaterializer } from "../shared/sidecar-materializer";
import type { DesktopPlatformCapabilities } from "../types";
import { createWindowsStateMigrationPolicy } from "./state-migration-policy";

export function createWindowsPlatformCapabilities(): DesktopPlatformCapabilities {
  return {
    platformId: "win",
    runtimeResidency: "managed",
    packagedArchive: {
      format: "zip",
      extractionMode: "async",
      supportsAtomicSwap: true,
    },
    resolveRuntimeRoots: resolveManagedRuntimeRoots,
    sidecarMaterializer: createAsyncArchiveSidecarMaterializer(),
    runtimeExecutables: createDefaultRuntimeExecutableResolver(),
    portStrategy: createManagedPortStrategy(),
    stateMigrationPolicy: createWindowsStateMigrationPolicy(),
    shutdownCoordinator: createManagedShutdownCoordinator(),
  };
}
