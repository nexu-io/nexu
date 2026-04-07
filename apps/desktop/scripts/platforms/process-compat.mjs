import { createDesktopCommandSpec } from "./desktop-platform.mjs";
import { resolveBuildTargetPlatform } from "./platform-resolver.mjs";

export function createPlatformCommandSpec({ command, args, ...options }) {
  return createDesktopCommandSpec(
    resolveBuildTargetPlatform(options),
    command,
    args,
  );
}
