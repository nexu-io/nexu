export const NEXU_TARGET_PLATFORM_ENV = "NEXU_TARGET_PLATFORM";

export type DesktopNodePlatform = "darwin" | "win32";

export type DesktopLinkKind = "dir" | "junction" | "file";

export function isDesktopRuntimePlatform(
  platformId: string,
): platformId is "mac" | "win" {
  switch (platformId) {
    case "mac":
    case "win":
      return true;
    default:
      return false;
  }
}

export function resolveDesktopRuntimePlatform(platform: string): "mac" | "win" {
  switch (platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "win";
    default:
      throw new Error(
        `Unsupported desktop platform: ${platform}. Only macOS and Windows adapters are implemented.`,
      );
  }
}

export function resolveDesktopNodePlatform(
  platformId: "mac" | "win",
): DesktopNodePlatform {
  switch (platformId) {
    case "mac":
      return "darwin";
    case "win":
      return "win32";
  }
}

export function resolveDesktopArtifactPlatformSegment(
  platformId: "mac" | "win",
): DesktopNodePlatform {
  return resolveDesktopNodePlatform(platformId);
}

export function shouldRestoreDesktopArchiveEntryMode(
  platformId: "mac" | "win",
): boolean {
  switch (platformId) {
    case "mac":
      return true;
    case "win":
      return false;
  }
}

export function isDesktopPortProbeRetryableError(args: {
  platformId: "mac" | "win";
  errorCode: unknown;
}): boolean {
  switch (args.platformId) {
    case "mac":
      return args.errorCode === "EADDRINUSE";
    case "win":
      return args.errorCode === "EADDRINUSE" || args.errorCode === "EACCES";
  }
}

export function resolveDesktopDirectoryLinkKind(
  platformId: "mac" | "win",
): "dir" | "junction" {
  switch (platformId) {
    case "mac":
      return "dir";
    case "win":
      return "junction";
  }
}

export function resolveDesktopEntryLinkKind(args: {
  platformId: "mac" | "win";
  isDirectory: boolean;
}): DesktopLinkKind | undefined {
  switch (args.platformId) {
    case "mac":
      return undefined;
    case "win":
      return args.isDirectory ? "junction" : "file";
  }
}

export function shouldRetryDesktopLinkFailureWithCopy(
  platformId: "mac" | "win",
): boolean {
  switch (platformId) {
    case "mac":
      return false;
    case "win":
      return true;
  }
}

export function resolveDesktopPnpmCommand(
  platformId: "mac" | "win",
): "pnpm" | "pnpm.cmd" {
  switch (platformId) {
    case "mac":
      return "pnpm";
    case "win":
      return "pnpm.cmd";
  }
}
