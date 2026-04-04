import { symlinkSync } from "node:fs";

export class KnownSymlinkPlatformGapError extends Error {
  readonly code = "NEXU_KNOWN_PLATFORM_GAP_SYMLINK";

  constructor(
    message = "Windows symlink creation is a known compatibility gap in this test environment",
  ) {
    super(message);
    this.name = "KnownSymlinkPlatformGapError";
  }
}

export function createSymlink(target: string, linkPath: string): void {
  if (process.platform === "win32") {
    throw new KnownSymlinkPlatformGapError();
  }

  symlinkSync(target, linkPath);
}
