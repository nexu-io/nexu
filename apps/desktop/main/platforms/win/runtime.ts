import { createManagedRuntimePlatformAdapter } from "../shared/runtime-common";
import { createWindowsPlatformCapabilities } from "./capabilities";

export function createWindowsRuntimePlatformAdapter() {
  return createManagedRuntimePlatformAdapter(
    "win",
    createWindowsPlatformCapabilities(),
  );
}
