import { repoRootPath } from "@nexu/dev-utils";

import {
  desktopWorkingDirectoryPath,
  getDesktopRuntimeRootPath,
} from "../paths.js";

import type { DesktopDevLaunchSpec } from "./desktop-dev-platform.darwin.js";

type WindowsDesktopDevLaunchSpecOptions = {
  launchId: string;
  env: NodeJS.ProcessEnv;
  logFilePath: string;
  command?: string;
  args?: string[];
  cwd?: string;
};

export async function createWindowsDesktopDevLaunchSpec(
  options: WindowsDesktopDevLaunchSpecOptions,
): Promise<DesktopDevLaunchSpec> {
  return {
    command: options.command ?? "pnpm",
    args: options.args ?? ["exec", "electron", "apps/desktop"],
    cwd: options.cwd ?? repoRootPath,
    env: {
      ...options.env,
      NEXU_WORKSPACE_ROOT: repoRootPath,
      NEXU_DESKTOP_APP_ROOT: desktopWorkingDirectoryPath,
      NEXU_DESKTOP_RUNTIME_ROOT: getDesktopRuntimeRootPath(),
      // Fallback: Windows does not need the macOS LSUIElement patch path.
    },
  };
}

export async function findWindowsDesktopDevMainPid(): Promise<
  number | undefined
> {
  // Fallback: Windows desktop main-process lookup is not implemented yet.
  return undefined;
}

export async function terminateWindowsDesktopDevProcesses(
  pid?: number,
  _options?: { force?: boolean },
): Promise<void> {
  // Fallback: Windows desktop process cleanup remains to be implemented.
  if (pid) {
    throw new Error(
      "Desktop dev process termination is not implemented for win32 yet",
    );
  }
}
