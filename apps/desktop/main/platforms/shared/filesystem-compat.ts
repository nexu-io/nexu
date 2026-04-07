import { shouldRestoreDesktopArchiveEntryMode } from "@nexu/shared";
import { resolveRuntimePlatform } from "../platform-resolver";

export function shouldRestoreArchiveEntryMode(): boolean {
  return shouldRestoreDesktopArchiveEntryMode(resolveRuntimePlatform());
}
