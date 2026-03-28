import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import { createDefaultPlatformCapabilities } from "./default/capabilities";
import {
  createFallbackMacRuntimePlatformAdapter,
  createMacRuntimePlatformAdapter,
  shouldUseMacLaunchdRuntime,
} from "./mac/runtime";
import {
  createExternalRuntimePlatformAdapter,
  createManagedRuntimePlatformAdapter,
} from "./shared/runtime-common";
import { createWindowsRuntimePlatformAdapter } from "./win/runtime";

function createExternalAdapter() {
  if (process.platform === "darwin") {
    return createExternalRuntimePlatformAdapter(
      "mac",
      createFallbackMacRuntimePlatformAdapter().capabilities,
    );
  }

  if (process.platform === "win32") {
    return createExternalRuntimePlatformAdapter(
      "win",
      createWindowsRuntimePlatformAdapter().capabilities,
    );
  }

  return createExternalRuntimePlatformAdapter(
    "default",
    createDefaultPlatformCapabilities(),
  );
}

export function getDesktopRuntimePlatformAdapter(
  baseRuntimeConfig?: DesktopRuntimeConfig,
) {
  if (baseRuntimeConfig?.runtimeMode === "external") {
    return createExternalAdapter();
  }

  if (shouldUseMacLaunchdRuntime()) {
    return createMacRuntimePlatformAdapter();
  }

  if (process.platform === "darwin") {
    return createFallbackMacRuntimePlatformAdapter();
  }

  if (process.platform === "win32") {
    return createWindowsRuntimePlatformAdapter();
  }

  return createManagedRuntimePlatformAdapter(
    "default",
    createDefaultPlatformCapabilities(),
  );
}
