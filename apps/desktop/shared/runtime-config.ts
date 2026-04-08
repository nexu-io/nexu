import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { UpdateChannelName } from "./host";
import type { ProxyPolicy } from "./proxy-config";
import { readProxyPolicy } from "./proxy-config";
import { getDesktopAppRoot } from "./workspace-paths";

export const DEFAULT_CONTROLLER_PORT = 50_800;
export const DEFAULT_WEB_PORT = 50_810;
export const DEFAULT_OPENCLAW_BASE_URL = "http://127.0.0.1:18789";
export const DEFAULT_GATEWAY_TOKEN = "gw-secret-token";
export const DEFAULT_NEXU_HOME = "~/.nexu";

/**
 * Read build-time configuration from bundled config file.
 * This allows CI to inject environment-specific values at build time.
 */
type BuildConfig = {
  NEXU_HOME?: string;
  NEXU_UPDATE_FEED_URL?: string;
  NEXU_DESKTOP_AUTO_UPDATE_ENABLED?: string;
  NEXU_DESKTOP_APP_VERSION?: string;
  NEXU_DESKTOP_SENTRY_DSN?: string;
  NEXU_DESKTOP_BUILD_SOURCE?: string;
  NEXU_DESKTOP_BUILD_BRANCH?: string;
  NEXU_DESKTOP_BUILD_COMMIT?: string;
  NEXU_DESKTOP_BUILD_TIME?: string;
  NEXU_DESKTOP_UPDATE_CHANNEL?: UpdateChannelName;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
};

function readBuildConfigString(
  input: Record<string, unknown>,
  key: keyof BuildConfig,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function loadBuildConfig(resourcesPath?: string): BuildConfig {
  if (!resourcesPath) return {};

  const configPath = resolve(resourcesPath, "build-config.json");
  if (!existsSync(configPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    return {
      NEXU_UPDATE_FEED_URL: readBuildConfigString(
        record,
        "NEXU_UPDATE_FEED_URL",
      ),
      NEXU_DESKTOP_APP_VERSION: readBuildConfigString(
        record,
        "NEXU_DESKTOP_APP_VERSION",
      ),
      NEXU_DESKTOP_AUTO_UPDATE_ENABLED: readBuildConfigString(
        record,
        "NEXU_DESKTOP_AUTO_UPDATE_ENABLED",
      ),
      NEXU_DESKTOP_SENTRY_DSN: readBuildConfigString(
        record,
        "NEXU_DESKTOP_SENTRY_DSN",
      ),
      NEXU_DESKTOP_BUILD_SOURCE: readBuildConfigString(
        record,
        "NEXU_DESKTOP_BUILD_SOURCE",
      ),
      NEXU_DESKTOP_BUILD_BRANCH: readBuildConfigString(
        record,
        "NEXU_DESKTOP_BUILD_BRANCH",
      ),
      NEXU_DESKTOP_BUILD_COMMIT: readBuildConfigString(
        record,
        "NEXU_DESKTOP_BUILD_COMMIT",
      ),
      NEXU_DESKTOP_BUILD_TIME: readBuildConfigString(
        record,
        "NEXU_DESKTOP_BUILD_TIME",
      ),
      NEXU_DESKTOP_UPDATE_CHANNEL: readUpdateChannel(
        readBuildConfigString(record, "NEXU_DESKTOP_UPDATE_CHANNEL"),
      ),
      POSTHOG_API_KEY: readBuildConfigString(record, "POSTHOG_API_KEY"),
      POSTHOG_HOST: readBuildConfigString(record, "POSTHOG_HOST"),
    };
  } catch {
    return {};
  }
}

function readUpdateChannel(
  value: string | undefined,
): UpdateChannelName | undefined {
  switch (value) {
    case "stable":
    case "beta":
    case "nightly":
      return value;
    default:
      return undefined;
  }
}

function readJsonVersion(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" && version.length > 0
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

function readPackagedAppVersion(resourcesPath?: string): string | undefined {
  if (!resourcesPath) {
    return undefined;
  }

  return (
    readJsonVersion(resolve(resourcesPath, "app.asar", "package.json")) ??
    readJsonVersion(resolve(resourcesPath, "app", "package.json"))
  );
}

function readDesktopPackageVersion(): string | undefined {
  return readJsonVersion(resolve(getDesktopAppRoot(), "package.json"));
}

export type DesktopBuildSource =
  | "local-dev"
  | "local-dist"
  | "nightly-test"
  | "nightly-prod"
  | "unknown";

export type DesktopBuildInfo = {
  version: string;
  source: DesktopBuildSource;
  branch: string | null;
  commit: string | null;
  builtAt: string | null;
};

function normalizeBuildSource(value: string | undefined): DesktopBuildSource {
  switch (value) {
    case "local-dev":
    case "local-dist":
    case "nightly-test":
    case "nightly-prod":
      return value;
    default:
      return "unknown";
  }
}

function parseEnvBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  return null;
}

export type DesktopRuntimeConfig = {
  runtimeMode: "internal" | "external";
  buildInfo: DesktopBuildInfo;
  proxy: ProxyPolicy;
  updates: {
    autoUpdateEnabled: boolean;
    channel: UpdateChannelName;
  };
  ports: {
    controller: number;
    web: number;
  };
  urls: {
    controllerBase: string;
    web: string;
    openclawBase: string;
    updateFeed: string | null;
  };
  tokens: {
    gateway: string;
  };
  paths: {
    nexuHome: string;
    openclawBin: string;
  };
  desktopAuth: {
    name: string;
    email: string;
    password: string;
  };
  sentryDsn: string | null;
  posthogApiKey: string | null;
  posthogHost: string | null;
};

export function getDesktopRuntimeConfig(
  env: Record<string, string | undefined>,
  defaults?: {
    appVersion?: string;
    openclawBinPath?: string;
    resourcesPath?: string;
    useBuildConfig?: boolean;
  },
): DesktopRuntimeConfig {
  const runtimeMode =
    env.NEXU_DESKTOP_RUNTIME_MODE === "external" ||
    env.NEXU_DESKTOP_EXTERNAL_RUNTIME === "1" ||
    env.NEXU_DESKTOP_EXTERNAL_RUNTIME?.toLowerCase() === "true"
      ? "external"
      : "internal";
  const buildConfig =
    defaults?.useBuildConfig === false
      ? {}
      : loadBuildConfig(defaults?.resourcesPath);
  const buildSource = normalizeBuildSource(
    env.NEXU_DESKTOP_BUILD_SOURCE ?? buildConfig.NEXU_DESKTOP_BUILD_SOURCE,
  );
  const autoUpdateEnabled =
    parseEnvBoolean(
      env.NEXU_DESKTOP_AUTO_UPDATE_ENABLED ??
        buildConfig.NEXU_DESKTOP_AUTO_UPDATE_ENABLED,
    ) ?? true;
  const updateChannel =
    readUpdateChannel(env.NEXU_DESKTOP_UPDATE_CHANNEL) ??
    buildConfig.NEXU_DESKTOP_UPDATE_CHANNEL ??
    "stable";
  const fallbackPackageVersion =
    readPackagedAppVersion(defaults?.resourcesPath) ??
    readDesktopPackageVersion();
  const ports = {
    controller: Number.parseInt(
      env.NEXU_CONTROLLER_PORT ??
        env.NEXU_API_PORT ??
        String(DEFAULT_CONTROLLER_PORT),
      10,
    ),
    web: Number.parseInt(env.NEXU_WEB_PORT ?? String(DEFAULT_WEB_PORT), 10),
  };

  const urls = {
    controllerBase:
      env.NEXU_CONTROLLER_URL ??
      env.NEXU_CONTROLLER_BASE_URL ??
      env.NEXU_API_URL ??
      env.NEXU_API_BASE_URL ??
      `http://127.0.0.1:${ports.controller}`,
    web: env.NEXU_WEB_URL ?? `http://127.0.0.1:${ports.web}`,
    openclawBase: env.NEXU_OPENCLAW_BASE_URL ?? DEFAULT_OPENCLAW_BASE_URL,
    updateFeed:
      env.NEXU_UPDATE_FEED_URL ?? buildConfig.NEXU_UPDATE_FEED_URL ?? null,
  };

  return {
    runtimeMode,
    buildInfo: {
      version:
        defaults?.appVersion ??
        env.NEXU_DESKTOP_APP_VERSION ??
        buildConfig.NEXU_DESKTOP_APP_VERSION ??
        env.npm_package_version ??
        fallbackPackageVersion ??
        "0.0.0",
      source: buildSource,
      branch:
        env.NEXU_DESKTOP_BUILD_BRANCH ??
        buildConfig.NEXU_DESKTOP_BUILD_BRANCH ??
        null,
      commit:
        env.NEXU_DESKTOP_BUILD_COMMIT ??
        buildConfig.NEXU_DESKTOP_BUILD_COMMIT ??
        null,
      builtAt:
        env.NEXU_DESKTOP_BUILD_TIME ??
        buildConfig.NEXU_DESKTOP_BUILD_TIME ??
        null,
    },
    proxy: readProxyPolicy(env),
    updates: {
      autoUpdateEnabled,
      channel: updateChannel,
    },
    ports,
    urls,
    tokens: {
      gateway: env.NEXU_OPENCLAW_GATEWAY_TOKEN ?? DEFAULT_GATEWAY_TOKEN,
    },
    paths: {
      nexuHome: env.NEXU_HOME ?? buildConfig.NEXU_HOME ?? DEFAULT_NEXU_HOME,
      openclawBin:
        env.NEXU_OPENCLAW_BIN ??
        defaults?.openclawBinPath ??
        "openclaw-wrapper",
    },
    desktopAuth: {
      name: "NexU Desktop",
      email: "desktop@nexu.local",
      password: "desktop-local-password",
    },
    sentryDsn:
      env.NEXU_DESKTOP_SENTRY_DSN ??
      buildConfig.NEXU_DESKTOP_SENTRY_DSN ??
      null,
    posthogApiKey: env.POSTHOG_API_KEY ?? buildConfig.POSTHOG_API_KEY ?? null,
    posthogHost: env.POSTHOG_HOST ?? buildConfig.POSTHOG_HOST ?? null,
  };
}
