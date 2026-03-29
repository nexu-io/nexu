export const NEXU_TARGET_PLATFORM_ENV = "NEXU_TARGET_PLATFORM";

export function isDesktopRuntimePlatform(platformId) {
  return platformId === "mac" || platformId === "win";
}

export function resolveDesktopRuntimePlatform(platform) {
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

export function resolveDesktopDirectoryLinkKind(platformId) {
  return platformId === "win" ? "junction" : "dir";
}

export function resolveDesktopEntryLinkKind({ platformId, isDirectory }) {
  if (platformId === "mac") {
    return undefined;
  }

  return isDirectory ? "junction" : "file";
}

export function shouldRetryDesktopLinkFailureWithCopy(platformId) {
  return platformId === "win";
}

export function resolveDesktopPnpmCommand(platformId) {
  return platformId === "win" ? "pnpm.cmd" : "pnpm";
}
