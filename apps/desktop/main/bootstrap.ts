import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { app } from "electron";

function loadDesktopDevEnv(): void {
  const workspaceRoot = process.env.NEXU_WORKSPACE_ROOT;

  if (!workspaceRoot || app.isPackaged) {
    return;
  }

  const apiEnvPath = resolve(workspaceRoot, "apps/api/.env");

  if (!existsSync(apiEnvPath)) {
    return;
  }

  process.loadEnvFile(apiEnvPath);
}

function configureLocalDevPaths(): void {
  const runtimeRoot = process.env.NEXU_DESKTOP_RUNTIME_ROOT;

  if (!runtimeRoot || app.isPackaged) {
    return;
  }

  const electronRoot = resolve(runtimeRoot, "electron");
  const userDataPath = resolve(electronRoot, "user-data");
  const sessionDataPath = resolve(electronRoot, "session-data");
  const logsPath = resolve(electronRoot, "logs");

  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });

  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.setPath("logs", logsPath);

  process.stdout.write(
    `[desktop:paths] runtimeRoot=${runtimeRoot} userData=${userDataPath} sessionData=${sessionDataPath} logs=${logsPath}\n`,
  );
}

loadDesktopDevEnv();
configureLocalDevPaths();

await import("./index");
