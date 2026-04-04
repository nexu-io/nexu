import type {
  DesktopPlatformCapabilities,
  PackagedArchiveFormat,
} from "../types";

export function shouldUseAsyncArchiveExtraction(
  capabilities: DesktopPlatformCapabilities,
): boolean {
  return capabilities.packagedArchive.extractionMode === "async";
}

export function getPreferredPackagedArchiveFormat(
  capabilities: DesktopPlatformCapabilities,
): PackagedArchiveFormat {
  return capabilities.packagedArchive.format;
}
