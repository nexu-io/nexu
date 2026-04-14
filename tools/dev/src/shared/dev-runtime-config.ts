import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { devTmpPath, repoRootPath } from "@nexu/dev-utils";
import { resolveSlimclawRuntimePaths } from "@nexu/slimclaw";

import { controllerWorkingDirectoryPath, toolsDevPath } from "./paths.js";

type ToolsDevRuntimeConfig = {
  devLogLevel: string;
  devLogPretty: boolean;
  controllerPort: number;
  webPort: number;
  openclawPort: number;
  desktopDevHost: string;
  desktopDevPort: number;
  desktopInspectPort: number;
  controllerUrl: string;
  webUrl: string;
  openclawBaseUrl: string;
  desktopDevServerUrl: string;
  desktopInspectUrl: string;
  nexuHomeDir: string;
  openclawStateDir: string;
  openclawConfigPath: string;
  openclawLogDir: string;
  openclawEntryPath: string;
  openclawBuiltinExtensionsDir: string;
  openclawLogLevel: string;
  openclawGatewayToken: string;
};

const toolsDevEnvPath = join(toolsDevPath, ".env");

let cachedConfig: ToolsDevRuntimeConfig | null = null;
const slimclawRuntimePaths = resolveSlimclawRuntimePaths({
  workspaceRoot: repoRootPath,
  requirePrepared: false,
});

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const source = readFileSync(filePath, "utf8");
  const values: Record<string, string> = {};

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
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      values[key] = rawValue.slice(1, -1);
      continue;
    }

    values[key] = rawValue;
  }

  return values;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function resolvePath(value: string | undefined, fallback: string): string {
  if (!value?.trim()) {
    return fallback;
  }

  return resolve(repoRootPath, value);
}

export function getToolsDevRuntimeConfig(): ToolsDevRuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const fileEnv = parseEnvFile(toolsDevEnvPath);
  const mergedEnv = {
    ...fileEnv,
    ...process.env,
  };

  const controllerPort = readNumber(mergedEnv.NEXU_DEV_CONTROLLER_PORT, 50800);
  const webPort = readNumber(mergedEnv.NEXU_DEV_WEB_PORT, 50810);
  const openclawPort = readNumber(mergedEnv.NEXU_DEV_OPENCLAW_PORT, 18789);
  const desktopDevHost = mergedEnv.NEXU_DEV_DESKTOP_HOST ?? "127.0.0.1";
  const desktopDevPort = readNumber(mergedEnv.NEXU_DEV_DESKTOP_PORT, 5180);
  const desktopInspectPort = readNumber(
    mergedEnv.NEXU_DEV_DESKTOP_INSPECT_PORT,
    5181,
  );
  const nexuHomeDir = resolvePath(
    mergedEnv.NEXU_DEV_NEXU_HOME_DIR,
    join(devTmpPath, "nexu-home"),
  );
  const openclawStateDir = resolvePath(
    mergedEnv.NEXU_DEV_OPENCLAW_STATE_DIR,
    join(devTmpPath, "openclaw", "state"),
  );
  const openclawConfigPath = resolvePath(
    mergedEnv.NEXU_DEV_OPENCLAW_CONFIG_PATH,
    join(openclawStateDir, "openclaw.json"),
  );
  const openclawLogDir = resolvePath(
    mergedEnv.NEXU_DEV_OPENCLAW_LOG_DIR,
    join(devTmpPath, "openclaw", "logs"),
  );
  const openclawEntryPath = resolvePath(
    mergedEnv.NEXU_DEV_OPENCLAW_ENTRY_PATH,
    slimclawRuntimePaths.entryPath,
  );
  const openclawBuiltinExtensionsDir = resolvePath(
    mergedEnv.OPENCLAW_EXTENSIONS_DIR,
    join(dirname(openclawEntryPath), "extensions"),
  );

  cachedConfig = {
    devLogLevel: mergedEnv.NEXU_DEV_LOG_LEVEL ?? "info",
    devLogPretty: readBoolean(mergedEnv.NEXU_DEV_LOG_PRETTY, false),
    controllerPort,
    webPort,
    openclawPort,
    desktopDevHost,
    desktopDevPort,
    desktopInspectPort,
    controllerUrl:
      mergedEnv.NEXU_DEV_CONTROLLER_URL ??
      `http://127.0.0.1:${String(controllerPort)}`,
    webUrl: mergedEnv.NEXU_DEV_WEB_URL ?? `http://127.0.0.1:${String(webPort)}`,
    openclawBaseUrl:
      mergedEnv.NEXU_DEV_OPENCLAW_BASE_URL ??
      `http://127.0.0.1:${String(openclawPort)}`,
    desktopDevServerUrl:
      mergedEnv.NEXU_DEV_DESKTOP_SERVER_URL ??
      `http://${desktopDevHost}:${String(desktopDevPort)}`,
    desktopInspectUrl:
      mergedEnv.NEXU_DEV_DESKTOP_INSPECT_URL ??
      `http://${desktopDevHost}:${String(desktopInspectPort)}`,
    nexuHomeDir,
    openclawStateDir,
    openclawConfigPath,
    openclawLogDir,
    openclawEntryPath,
    openclawBuiltinExtensionsDir,
    openclawLogLevel: mergedEnv.NEXU_DEV_OPENCLAW_LOG_LEVEL ?? "info",
    openclawGatewayToken:
      mergedEnv.NEXU_DEV_OPENCLAW_GATEWAY_TOKEN ?? "gw-secret-token",
  };

  return cachedConfig;
}

export function createControllerInjectedEnv(): NodeJS.ProcessEnv {
  const config = getToolsDevRuntimeConfig();

  return {
    PORT: String(config.controllerPort),
    HOST: "127.0.0.1",
    WEB_URL: config.webUrl,
    NEXU_HOME: config.nexuHomeDir,
    NEXU_CONTROLLER_OPENCLAW_MODE: "external",
    OPENCLAW_BASE_URL: config.openclawBaseUrl,
    OPENCLAW_STATE_DIR: config.openclawStateDir,
    OPENCLAW_CONFIG_PATH: config.openclawConfigPath,
    OPENCLAW_LOG_DIR: config.openclawLogDir,
    OPENCLAW_EXTENSIONS_DIR: config.openclawBuiltinExtensionsDir,
    OPENCLAW_GATEWAY_PORT: String(config.openclawPort),
    OPENCLAW_GATEWAY_TOKEN: config.openclawGatewayToken,
    PLATFORM_TEMPLATES_DIR: join(
      repoRootPath,
      "apps",
      "controller",
      "static",
      "platform-templates",
    ),
  };
}

export function createWebInjectedEnv(): NodeJS.ProcessEnv {
  const config = getToolsDevRuntimeConfig();

  return {
    WEB_HOST: "127.0.0.1",
    WEB_PORT: String(config.webPort),
    WEB_API_ORIGIN: config.controllerUrl,
    VITE_DESKTOP_PLATFORM: process.platform,
  };
}

export function createOpenclawInjectedEnv(): NodeJS.ProcessEnv {
  const config = getToolsDevRuntimeConfig();

  return {
    OPENCLAW_STATE_DIR: config.openclawStateDir,
    OPENCLAW_CONFIG_PATH: config.openclawConfigPath,
    OPENCLAW_LOG_LEVEL: config.openclawLogLevel,
    OPENCLAW_GATEWAY_TOKEN: config.openclawGatewayToken,
  };
}

export function createDesktopInjectedEnv(): NodeJS.ProcessEnv {
  const config = getToolsDevRuntimeConfig();

  return {
    VITE_DESKTOP_PLATFORM: process.platform,
    NEXU_DESKTOP_RUNTIME_MODE: "external",
    NEXU_DESKTOP_EXTERNAL_RUNTIME: "1",
    NEXU_CONTROLLER_PORT: String(config.controllerPort),
    NEXU_CONTROLLER_URL: config.controllerUrl,
    NEXU_WEB_PORT: String(config.webPort),
    NEXU_WEB_URL: config.webUrl,
    NEXU_OPENCLAW_BASE_URL: config.openclawBaseUrl,
    NEXU_OPENCLAW_GATEWAY_TOKEN: config.openclawGatewayToken,
    NEXU_DESKTOP_DEV_HOST: config.desktopDevHost,
    NEXU_DESKTOP_DEV_PORT: String(config.desktopDevPort),
    NEXU_DESKTOP_DEV_SERVER_URL: config.desktopDevServerUrl,
    NEXU_DESKTOP_DEV_INSPECT_HOST: config.desktopDevHost,
    NEXU_DESKTOP_DEV_INSPECT_PORT: String(config.desktopInspectPort),
    NEXU_DESKTOP_DEV_API_ORIGIN: config.controllerUrl,
    NEXU_HOME: config.nexuHomeDir,
  };
}

export function getToolsDevEnvPath(): string {
  return toolsDevEnvPath;
}

export function getOpenclawWorkingDirectoryPath(): string {
  return dirname(getToolsDevRuntimeConfig().openclawConfigPath);
}

export function getControllerWorkingDirectoryPath(): string {
  return controllerWorkingDirectoryPath;
}
