import {
  type DesktopDevLaunchSpec,
  createDarwinDesktopDevLaunchSpec,
  findDarwinDesktopDevMainPid,
  terminateDarwinDesktopDevProcesses,
} from "./desktop-dev-platform.darwin.js";
import {
  createWindowsDesktopDevLaunchSpec,
  findWindowsDesktopDevMainPid,
  terminateWindowsDesktopDevProcesses,
} from "./desktop-dev-platform.win32.js";

export type CreateDesktopDevLaunchSpecOptions = {
  launchId: string;
  env: NodeJS.ProcessEnv;
  logFilePath: string;
  command: string;
  args: string[];
  cwd: string;
};

function withDesktopLaunchMetadata(
  launchId: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...env,
    NEXU_DESKTOP_BUILD_SOURCE: env.NEXU_DESKTOP_BUILD_SOURCE ?? "local-dev",
    NEXU_DESKTOP_BUILD_BRANCH: env.NEXU_DESKTOP_BUILD_BRANCH ?? "unknown",
    NEXU_DESKTOP_BUILD_COMMIT: env.NEXU_DESKTOP_BUILD_COMMIT ?? "unknown",
    NEXU_DESKTOP_BUILD_TIME:
      env.NEXU_DESKTOP_BUILD_TIME ?? new Date().toISOString(),
    NEXU_DESKTOP_LAUNCH_ID: launchId,
  };
}

export type { DesktopDevLaunchSpec };

export async function createDesktopElectronLaunchSpec(
  options: Omit<CreateDesktopDevLaunchSpecOptions, "command" | "args" | "cwd">,
): Promise<DesktopDevLaunchSpec> {
  switch (process.platform) {
    case "darwin":
      return createDarwinDesktopDevLaunchSpec({
        launchId: options.launchId,
        env: withDesktopLaunchMetadata(options.launchId, options.env),
        logFilePath: options.logFilePath,
      });
    case "win32":
      return createWindowsDesktopDevLaunchSpec({
        launchId: options.launchId,
        env: withDesktopLaunchMetadata(options.launchId, options.env),
        logFilePath: options.logFilePath,
      });
    default:
      throw new Error(
        `Unsupported platform for desktop electron launch: ${process.platform}`,
      );
  }
}

export async function findDesktopDevMainPid(
  launchId?: string,
): Promise<number | undefined> {
  switch (process.platform) {
    case "darwin":
      return findDarwinDesktopDevMainPid();
    case "win32":
      return findWindowsDesktopDevMainPid(launchId);
    default:
      throw new Error(
        `Unsupported platform for desktop dev process lookup: ${process.platform}`,
      );
  }
}

export async function terminateDesktopDevProcesses(
  pid?: number,
  options?: { force?: boolean; launchId?: string },
): Promise<void> {
  switch (process.platform) {
    case "darwin":
      await terminateDarwinDesktopDevProcesses(pid, options);
      return;
    case "win32":
      await terminateWindowsDesktopDevProcesses(pid, options);
      return;
    default:
      throw new Error(
        `Unsupported platform for desktop dev process termination: ${process.platform}`,
      );
  }
}

export async function createDesktopDevLaunchSpec(
  options: CreateDesktopDevLaunchSpecOptions,
): Promise<DesktopDevLaunchSpec> {
  const env = withDesktopLaunchMetadata(options.launchId, options.env);

  switch (process.platform) {
    case "darwin":
      return createDarwinDesktopDevLaunchSpec({
        launchId: options.launchId,
        env,
        logFilePath: options.logFilePath,
        command: options.command,
        args: options.args,
        cwd: options.cwd,
      });
    case "win32":
      return createWindowsDesktopDevLaunchSpec({
        launchId: options.launchId,
        env,
        logFilePath: options.logFilePath,
        command: options.command,
        args: options.args,
        cwd: options.cwd,
      });
    default:
      throw new Error(
        `Unsupported platform for desktop dev launch: ${process.platform}`,
      );
  }
}
