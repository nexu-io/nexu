import {
  resolveDesktopDirectoryLinkKind,
  resolveDesktopEntryLinkKind,
  resolveDesktopPnpmCommand,
  shouldRetryDesktopLinkFailureWithCopy,
} from "./desktop-platform.mjs";
import { resolveBuildTargetPlatform } from "./platform-resolver.mjs";

export function resolveDirectoryLinkKind(options = {}) {
  return resolveDesktopDirectoryLinkKind(resolveBuildTargetPlatform(options));
}

export function resolveEntryLinkKind({ isDirectory, ...options }) {
  return resolveDesktopEntryLinkKind({
    platformId: resolveBuildTargetPlatform(options),
    isDirectory,
  });
}

export function shouldRetryLinkFailureWithCopy(options = {}) {
  return shouldRetryDesktopLinkFailureWithCopy(
    resolveBuildTargetPlatform(options),
  );
}

export function resolvePnpmCommand(options = {}) {
  return resolveDesktopPnpmCommand(resolveBuildTargetPlatform(options));
}
