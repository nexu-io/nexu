import {
  getLegacyNexuHomeStateDir,
  migrateOpenclawState,
} from "../../services/state-migration";
import type { DesktopRuntimeStateMigrationPolicy } from "../types";

export function createNoopStateMigrationPolicy(): DesktopRuntimeStateMigrationPolicy {
  return {
    run() {
      // no-op
    },
  };
}

export function createMacPackagedStateMigrationPolicy(): DesktopRuntimeStateMigrationPolicy {
  return {
    run({ isPackaged, log, runtimeConfig, runtimeRoots }) {
      if (!isPackaged) {
        return;
      }

      const legacyStateDir = getLegacyNexuHomeStateDir(
        runtimeConfig.paths.nexuHome,
      );
      if (legacyStateDir === runtimeRoots.openclawStateDir) {
        return;
      }

      migrateOpenclawState({
        targetStateDir: runtimeRoots.openclawStateDir,
        sourceStateDir: legacyStateDir,
        log: (message) => log(`state-migration: ${message}`),
      });
    },
  };
}
