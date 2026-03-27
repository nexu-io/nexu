import { join } from "node:path";

import { devLogsPath, devTmpPath, repoRootPath } from "@nexu/dev-utils";

export const scriptsDevPath = join(repoRootPath, "scripts", "dev");
export const scriptsDevSourcePath = join(scriptsDevPath, "src");

export const controllerWorkingDirectoryPath = join(
  repoRootPath,
  "apps",
  "controller",
);
export const webWorkingDirectoryPath = join(repoRootPath, "apps", "web");

export const controllerSupervisorPath = join(
  scriptsDevSourcePath,
  "controller-supervisor.ts",
);
export const webSupervisorPath = join(
  scriptsDevSourcePath,
  "web-supervisor.ts",
);
export const controllerSourceDirectoryPath = join(
  controllerWorkingDirectoryPath,
  "src",
);

export const controllerDevLockPath = join(devTmpPath, "controller.pid");
export const webDevLockPath = join(devTmpPath, "web.pid");

export function getControllerDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "controller.log");
}

export function getWebDevLogPath(runId: string): string {
  return join(devLogsPath, runId, "web.log");
}
