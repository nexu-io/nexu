import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_CONTROLLER_PORT = 50_800;
export const DEFAULT_WEB_PORT = 50_810;
export const DEFAULT_OPENCLAW_BASE_URL = "http://127.0.0.1:18789";
export const DEFAULT_GATEWAY_TOKEN = "gw-secret-token";
export const DEFAULT_NEXU_HOME = "~/.nexu";

// Cloud connection defaults (production)
export const DEFAULT_NEXU_CLOUD_URL = "https://nexu.io";
export const DEFAULT_NEXU_LINK_URL: string | null = null;

/**
 * Read build-time configuration from bundled config file.
 * This allows CI to inject environment-specific values at build time.
 */
type BuildConfig = {
  NEXU_HOME?: string;
  NEXU_CLOUD_URL?: string;
  NEXU_LINK_URL?: string | null;
  NEXU_UPDATE_FEED_URL?: string;
  NEXU_DESKTOP_SENTRY_DSN?: string;
  NEXU_DESKTOP_BUILD_SOURCE?: string;
  NEXU_DESKTOP_BUILD_BRANCH?: string;
  NEXU_DESKTOP_BUILD_COMMIT?: string;
  NEXU_DESKTOP_BUILD_TIME?: string;
};

function readBuildConfigString(
  input: Record<string, unknown>,
  key: keyof BuildConfig,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBuildConfigNullableString(
  input: Record<string, unknown>,
  key: keyof BuildConfig,
): string | null | undefined {
  const value = input[key];
  if (value === null) {
    return null;
  }

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
      NEXU_CLOUD_URL: readBuildConfigString(record, "NEXU_CLOUD_URL"),
      NEXU_LINK_URL: readBuildConfigNullableString(record, "NEXU_LINK_URL"),
      NEXU_UPDATE_FEED_URL: readBuildConfigString(
        record,
        "NEXU_UPDATE_FEED_URL",
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
    };
  } catch {
    return {};
  }
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

export type DesktopRuntimeConfig = {
  buildInfo: DesktopBuildInfo;
  ports: {
    controller: number;
    web: number;
  };
  urls: {
    controllerBase: string;
    web: string;
    openclawBase: string;
    nexuCloud: string;
    nexuLink: string | null;
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
};

export function getDesktopRuntimeConfig(
  env: Record<string, string | undefined>,
  defaults?: {
    appVersion?: string;
    openclawBinPath?: string;
    resourcesPath?: string;
  },
): DesktopRuntimeConfig {
  // Load build-time config (for packaged apps)
  const buildConfig = loadBuildConfig(defaults?.resourcesPath);
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
    nexuCloud:
      env.NEXU_CLOUD_URL ??
      buildConfig.NEXU_CLOUD_URL ??
      DEFAULT_NEXU_CLOUD_URL,
    nexuLink:
      env.NEXU_LINK_URL ?? buildConfig.NEXU_LINK_URL ?? DEFAULT_NEXU_LINK_URL,
    updateFeed:
      env.NEXU_UPDATE_FEED_URL ?? buildConfig.NEXU_UPDATE_FEED_URL ?? null,
  };

  return {
    buildInfo: {
      version: defaults?.appVersion ?? env.npm_package_version ?? "0.0.0",
      source: normalizeBuildSource(
        env.NEXU_DESKTOP_BUILD_SOURCE ?? buildConfig.NEXU_DESKTOP_BUILD_SOURCE,
      ),
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
  };
}
