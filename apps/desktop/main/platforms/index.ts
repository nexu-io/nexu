import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import {
  createFallbackMacRuntimePlatformAdapter,
  createMacRuntimePlatformAdapter,
  shouldUseMacLaunchdRuntime,
} from "./mac/runtime";
import { resolveRuntimePlatform } from "./platform-resolver";
import { createExternalRuntimePlatformAdapter } from "./shared/runtime-common";
import { createWindowsRuntimePlatformAdapter } from "./win/runtime";

function createExternalAdapter() {
  switch (resolveRuntimePlatform()) {
    case "mac":
      return createExternalRuntimePlatformAdapter(
        "mac",
        createFallbackMacRuntimePlatformAdapter().capabilities,
      );
    case "win":
      return createExternalRuntimePlatformAdapter(
        "win",
        createWindowsRuntimePlatformAdapter().capabilities,
      );
  }
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

  switch (resolveRuntimePlatform()) {
    case "mac":
      return createFallbackMacRuntimePlatformAdapter();
    case "win":
      return createWindowsRuntimePlatformAdapter();
  }
}
