import {
  type DesktopRuntimePlatformId,
  isDesktopRuntimePlatform,
  resolveDesktopRuntimePlatform,
} from "@nexu/shared";

export function resolveRuntimePlatform(
  platform: NodeJS.Platform = process.platform,
): DesktopRuntimePlatformId {
  return resolveDesktopRuntimePlatform(platform);
}

export function isRuntimePlatform(
  platformId: string,
): platformId is DesktopRuntimePlatformId {
  return isDesktopRuntimePlatform(platformId);
}

export function assertSupportedRuntimePlatform(
  platform: NodeJS.Platform = process.platform,
): DesktopRuntimePlatformId {
  return resolveRuntimePlatform(platform);
}
