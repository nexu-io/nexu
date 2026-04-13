import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";
import { getDesktopNexuHomeDir } from "../shared/desktop-paths";
import { resolveRuntimePlatform } from "./platforms/platform-resolver";
import { resolveNonWindowsPackagedUserDataPath } from "./platforms/shared/packaged-user-data-path";
import { resolveWindowsPackagedUserDataPath } from "./platforms/windows/user-data-path";
import {
  getLegacyPackagedNexuHomeDir,
  migrateNexuHomeFromUserData,
} from "./services/nexu-home-migration";

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

    const source = readFileSync(envPath, "utf8");
    for (const rawLine of source.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const rawValue = line.slice(separatorIndex + 1).trim();
      if (
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ) {
        process.env[key] = rawValue.slice(1, -1);
        continue;
      }

      process.env[key] = rawValue;
    }
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
  const nexuHomePath = process.env.NEXU_HOME
    ? resolve(process.env.NEXU_HOME)
    : getDesktopNexuHomeDir(userDataPath);

  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });
  mkdirSync(nexuHomePath, { recursive: true });

  // Only set NEXU_HOME if not already provided externally (e.g. by
  // dev-launchd.sh). Unconditionally overwriting it breaks the data
  // directory when the caller explicitly sets NEXU_HOME to a custom path.
  if (!process.env.NEXU_HOME) {
    process.env.NEXU_HOME = nexuHomePath;
  }

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
  const registryUserDataPath =
    process.platform === "win32" ? readWindowsRegistryUserDataRoot() : null;
  const runtimePlatform = resolveRuntimePlatform();
  const packagedUserDataPath =
    runtimePlatform === "win"
      ? resolveWindowsPackagedUserDataPath({
          appDataPath,
          overrideUserDataPath,
          registryUserDataPath,
        })
      : resolveNonWindowsPackagedUserDataPath({
          appDataPath,
        });
  const effectiveUserDataPath = packagedUserDataPath.resolvedUserDataPath;

  const sessionDataPath = join(effectiveUserDataPath, "session");
  const logsPath = join(effectiveUserDataPath, "logs");
  const nexuHomePath = getDesktopNexuHomeDir(effectiveUserDataPath);
  const legacyPackagedNexuHomePath = getLegacyPackagedNexuHomeDir(
    effectiveUserDataPath,
  );

  mkdirSync(effectiveUserDataPath, { recursive: true });
  mkdirSync(sessionDataPath, { recursive: true });
  mkdirSync(logsPath, { recursive: true });
  mkdirSync(nexuHomePath, { recursive: true });

  if (legacyPackagedNexuHomePath !== nexuHomePath) {
    migrateNexuHomeFromUserData({
      targetNexuHome: nexuHomePath,
      sourceNexuHome: legacyPackagedNexuHomePath,
      log: (message) => {
        safeWrite(
          process.stdout,
          `[desktop:paths] nexu-home-migration: ${message}\n`,
        );
      },
    });
  }

  process.env.NEXU_HOME = nexuHomePath;

  app.setPath("userData", effectiveUserDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.setAppLogsPath(logsPath);

  safeWrite(
    process.stdout,
    runtimePlatform === "win"
      ? `[desktop:paths:win] appData=${appDataPath} defaultUserData=${packagedUserDataPath.defaultUserDataPath} overrideUserData=${overrideUserDataPath ?? "<unset>"} registryUserData=${registryUserDataPath ?? "<unset>"} resolvedUserData=${effectiveUserDataPath} sessionData=${sessionDataPath} logs=${logsPath} nexuHome=${nexuHomePath}\n`
      : `[desktop:paths] appData=${appDataPath} defaultUserData=${packagedUserDataPath.defaultUserDataPath} overrideUserData=${overrideUserDataPath ?? "<unset>"} registryUserData=${registryUserDataPath ?? "<unset>"} userData=${effectiveUserDataPath} sessionData=${sessionDataPath} logs=${logsPath} nexuHome=${nexuHomePath}\n`,
  );
}

function readWindowsRegistryUserDataRoot(): string | null {
  try {
    const output = execFileSync(
      "reg.exe",
      ["query", "HKCU\\Software\\Nexu\\Desktop", "/v", "UserDataRoot"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );

    for (const line of output.split(/\r?\n/u)) {
      const match = line.match(/^\s*UserDataRoot\s+REG_\w+\s+(.+)$/u);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  } catch {}

  return null;
}

loadDesktopDevEnv();
configurePackagedPaths();
configureLocalDevPaths();

await import("./index");
