import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_API_PORT = 50_800;
export const DEFAULT_WEB_PORT = 50_810;
export const DEFAULT_PGLITE_PORT = 50_832;
export const DEFAULT_OPENCLAW_BASE_URL = "http://127.0.0.1:18789";
export const DEFAULT_GATEWAY_TOKEN = "gw-secret-token";
export const DEFAULT_SKILL_TOKEN = "skill-secret-token";
export const DEFAULT_GATEWAY_POOL_ID = "desktop-local-pool";
export const DEFAULT_PGLITE_DATABASE_URL = (port: number) =>
  `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

// Cloud connection defaults (production)
export const DEFAULT_NEXU_CLOUD_URL = "https://nexu.io";
export const DEFAULT_NEXU_LINK_URL: string | null = null;

/**
 * Read build-time configuration from bundled config file.
 * This allows CI to inject environment-specific values at build time.
 */
function loadBuildConfig(resourcesPath?: string): Record<string, string> {
  if (!resourcesPath) return {};

  const configPath = resolve(resourcesPath, "build-config.json");
  if (!existsSync(configPath)) return {};

  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

export type DesktopRuntimeConfig = {
  ports: {
    api: number;
    web: number;
    pglite: number;
  };
  urls: {
    apiBase: string;
    web: string;
    auth: string;
    openclawBase: string;
    nexuCloud: string;
    nexuLink: string | null;
    updateFeed: string | null;
  };
  tokens: {
    gateway: string;
    internalApi: string;
    skill: string;
  };
  database: {
    pgliteUrl: string;
  };
  gateway: {
    poolId: string;
  };
  paths: {
    openclawBin: string;
  };
  desktopAuth: {
    name: string;
    email: string;
    password: string;
    appUserId: string;
    onboardingRole: string;
  };
};

export function getDesktopRuntimeConfig(
  env: Record<string, string | undefined>,
  defaults?: {
    openclawBinPath?: string;
    resourcesPath?: string;
  },
): DesktopRuntimeConfig {
  // Load build-time config (for packaged apps)
  const buildConfig = loadBuildConfig(defaults?.resourcesPath);
  const ports = {
    api: Number.parseInt(env.NEXU_API_PORT ?? String(DEFAULT_API_PORT), 10),
    web: Number.parseInt(env.NEXU_WEB_PORT ?? String(DEFAULT_WEB_PORT), 10),
    pglite: Number.parseInt(
      env.NEXU_PGLITE_PORT ?? String(DEFAULT_PGLITE_PORT),
      10,
    ),
  };

  const urls = {
    apiBase:
      env.NEXU_API_URL ??
      env.NEXU_API_BASE_URL ??
      `http://127.0.0.1:${ports.api}`,
    web: env.NEXU_WEB_URL ?? `http://127.0.0.1:${ports.web}`,
    auth:
      env.NEXU_AUTH_URL ??
      env.NEXU_API_URL ??
      env.NEXU_API_BASE_URL ??
      `http://127.0.0.1:${ports.api}`,
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
    ports,
    urls,
    tokens: {
      gateway:
        env.NEXU_OPENCLAW_GATEWAY_TOKEN ??
        env.NEXU_INTERNAL_API_TOKEN ??
        DEFAULT_GATEWAY_TOKEN,
      internalApi: env.NEXU_INTERNAL_API_TOKEN ?? DEFAULT_GATEWAY_TOKEN,
      skill: env.NEXU_SKILL_API_TOKEN ?? DEFAULT_SKILL_TOKEN,
    },
    database: {
      pgliteUrl:
        env.NEXU_DATABASE_URL ?? DEFAULT_PGLITE_DATABASE_URL(ports.pglite),
    },
    gateway: {
      poolId: env.NEXU_GATEWAY_POOL_ID ?? DEFAULT_GATEWAY_POOL_ID,
    },
    paths: {
      openclawBin:
        env.NEXU_OPENCLAW_BIN ??
        defaults?.openclawBinPath ??
        "openclaw-wrapper",
    },
    desktopAuth: {
      name: "NexU Desktop",
      email: "desktop@nexu.local",
      password: "desktop-local-password",
      appUserId: "desktop-local-user",
      onboardingRole: "Founder / Manager",
    },
  };
}
