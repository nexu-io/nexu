import {
  type DesktopRuntimePlatformId,
  resolveDesktopArtifactPlatformSegment,
  resolveDesktopNodePlatform,
} from "@nexu/shared";

export function resolveNodePlatform(
  platformId: DesktopRuntimePlatformId,
): NodeJS.Platform {
  return resolveDesktopNodePlatform(platformId);
}

export function resolvePlatformArchiveComponent(
  platformId: DesktopRuntimePlatformId,
): string {
  return resolveDesktopArtifactPlatformSegment(platformId);
}
