import { join } from "node:path";

import { devLogsPath, devTmpPath, repoRootPath } from "@nexu/dev-utils";
import { getSlimclawRuntimeRoot } from "@nexu/slimclaw";

export const toolsDevPath = join(repoRootPath, "tools", "dev");
export const toolsDevSourcePath = join(toolsDevPath, "src");

export const controllerWorkingDirectoryPath = join(
  repoRootPath,
  "apps",
  "controller",
);
export const desktopWorkingDirectoryPath = join(
  repoRootPath,
  "apps",
  "desktop",
);
export const webWorkingDirectoryPath = join(repoRootPath, "apps", "web");
export const openclawWorkingDirectoryPath = repoRootPath;

export const controllerSupervisorPath = join(
  toolsDevSourcePath,
  "supervisors",
  "controller.ts",
);
export const webSupervisorPath = join(
  toolsDevSourcePath,
  "supervisors",
  "web.ts",
);
export const openclawSupervisorPath = join(
  toolsDevSourcePath,
  "supervisors",
  "openclaw.ts",
);
export const desktopSupervisorPath = join(
  toolsDevSourcePath,
  "supervisors",
  "desktop.ts",
);
export const controllerSourceDirectoryPath = join(
  controllerWorkingDirectoryPath,
  "src",
);

export const controllerDevLockPath = join(devTmpPath, "controller.pid");
export const desktopDevLockPath = join(devTmpPath, "desktop.pid");
export const webDevLockPath = join(devTmpPath, "web.pid");
export const openclawDevLockPath = join(devTmpPath, "openclaw.pid");

export function getControllerDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "controller.log");
}

export function getWebDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "web.log");
}

export function getDesktopDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "desktop.log");
}

export function getOpenclawDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "openclaw.log");
}

export function getDesktopRuntimeRootPath(): string {
  return join(repoRootPath, ".tmp", "desktop");
}

export function getOpenclawRuntimeStageRootPath(): string {
  return join(
    getSlimclawRuntimeRoot(repoRootPath),
    "node_modules",
    ".nexu-dev-runtime",
  );
}
