import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";

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
  const userDataPath = electronRoot;
  const sessionDataPath = resolve(electronRoot, "session");
  const logsPath = resolve(electronRoot, "logs");

  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });

  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);

  safeWrite(
    process.stdout,
    `[desktop:paths] runtimeRoot=${runtimeRoot} userData=${userDataPath} sessionData=${sessionDataPath} logs=${logsPath}\n`,
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

  safeWrite(
    process.stdout,
    `[desktop:paths] appData=${appDataPath} overrideUserData=${overrideUserDataPath ?? "<unset>"} userData=${userDataPath} sessionData=${sessionDataPath} logs=${logsPath}\n`,
  );
}

loadDesktopDevEnv();
configurePackagedPaths();
configureLocalDevPaths();

await import("./index");
