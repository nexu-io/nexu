import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
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

  const controllerEnvPath = resolve(workspaceRoot, "apps/controller/.env");

  if (!existsSync(controllerEnvPath)) {
    return;
  }

  process.loadEnvFile(controllerEnvPath);
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
  const nexuHomePath = getDesktopNexuHomeDir(userDataPath);

  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });
  mkdirSync(nexuHomePath, { recursive: true });

  process.env.NEXU_HOME = nexuHomePath;

  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.setPath("logs", logsPath);

  safeWrite(
    process.stdout,
    `[desktop:paths] runtimeRoot=${runtimeRoot} userData=${userDataPath} sessionData=${sessionDataPath} logs=${logsPath} nexuHome=${nexuHomePath}\n`,
  );
}

loadDesktopDevEnv();
configureLocalDevPaths();

await import("./index");
