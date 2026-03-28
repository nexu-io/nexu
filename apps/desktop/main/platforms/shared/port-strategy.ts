import {
  PortAllocationError,
  allocateDesktopRuntimePorts,
} from "../../runtime/port-allocation";
import type {
  DesktopRuntimePortStrategy,
  PrepareRuntimeConfigArgs,
} from "../types";

export function createManagedPortStrategy(): DesktopRuntimePortStrategy {
  return {
    async allocateRuntimePorts({
      baseRuntimeConfig,
      env,
    }: PrepareRuntimeConfigArgs) {
      return allocateDesktopRuntimePorts(env, baseRuntimeConfig).catch(
        (error: unknown) => {
          if (error instanceof PortAllocationError) {
            throw new Error(
              `[desktop:ports] ${error.code} purpose=${error.purpose} ` +
                `preferredPort=${error.preferredPort ?? "n/a"} ${error.message}`,
            );
          }

          throw error;
        },
      );
    },
  };
}

export function createLaunchdPortStrategy(): DesktopRuntimePortStrategy {
  return {
    async allocateRuntimePorts({
      baseRuntimeConfig,
    }: PrepareRuntimeConfigArgs) {
      return {
        allocations: [],
        runtimeConfig: baseRuntimeConfig,
      };
    },
  };
}
