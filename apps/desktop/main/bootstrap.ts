import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";
import { getDesktopNexuHomeDir } from "../shared/desktop-paths";

function safeWrite(stream: NodeJS.WriteStream, message: string): void {
  if (stream.destroyed || !stream.writable) {
    return;
  }

  try {
    stream.write(message);
  } catch (error) {
    const errorCode =
      error instanceof Error && "code" in error ? String(error.code) : null;
    if (errorCode === "EIO" || errorCode === "EPIPE") {
      return;
    }
    throw error;
  }
}

function loadDesktopDevEnv(): void {
  const workspaceRoot = process.env.NEXU_WORKSPACE_ROOT;

  if (!workspaceRoot || app.isPackaged) {
    return;
  }

  const envPaths = [
    resolve(workspaceRoot, "apps/controller/.env"),
    resolve(workspaceRoot, "apps/desktop/.env"),
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    process.loadEnvFile(envPath);
  }
}

function configureLocalDevPaths(): void {
  const runtimeRoot = process.env.NEXU_DESKTOP_RUNTIME_ROOT;

  if (!runtimeRoot || app.isPackaged) {
    return;
  }

  const electronRoot = resolve(runtimeRoot, "electron");
  const userDataPath = resolve(electronRoot, "user-data");
  const sessionDataPath = resolve(electronRoot, "session-data");
  const logsPath = resolve(userDataPath, "logs");
  const nexuHomePath = getDesktopNexuHomeDir(userDataPath);

  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });
  mkdirSync(nexuHomePath, { recursive: true });

  process.env.NEXU_HOME = nexuHomePath;

  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.setAppLogsPath(logsPath);

  safeWrite(
    process.stdout,
    `[desktop:paths] runtimeRoot=${runtimeRoot} userData=${userDataPath} sessionData=${sessionDataPath} logs=${logsPath} nexuHome=${nexuHomePath}\n`,
  );
}

function configurePackagedPaths(): void {
  if (!app.isPackaged) {
    return;
  }

  const appDataPath = app.getPath("appData");
  const overrideUserDataPath = process.env.NEXU_DESKTOP_USER_DATA_ROOT;
  const userDataPath = overrideUserDataPath
    ? resolve(overrideUserDataPath)
    : join(appDataPath, "@nexu", "desktop");
  const sessionDataPath = join(userDataPath, "session");
  const logsPath = join(userDataPath, "logs");

  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });

  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.setAppLogsPath(logsPath);

  safeWrite(
    process.stdout,
    `[desktop:paths] appData=${appDataPath} overrideUserData=${overrideUserDataPath ?? "<unset>"} userData=${userDataPath} sessionData=${sessionDataPath} logs=${logsPath}\n`,
  );
}

loadDesktopDevEnv();
configurePackagedPaths();
configureLocalDevPaths();

await import("./index");
