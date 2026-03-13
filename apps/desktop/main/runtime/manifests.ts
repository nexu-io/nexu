import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  type DesktopRuntimeConfig,
  getDesktopRuntimeConfig,
} from "../../shared/runtime-config";
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import type { RuntimeUnitManifest } from "./types";

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

export function createRuntimeUnitManifests(
  electronRoot: string,
  userDataPath: string,
): RuntimeUnitManifest[] {
  const repoRoot = getWorkspaceRoot();
  const nexuRoot = repoRoot;
  const runtimeConfig: DesktopRuntimeConfig = getDesktopRuntimeConfig(
    process.env,
  );
  const runtimeRoot = ensureDir(resolve(userDataPath, "runtime"));
  const pgliteDataPath = ensureDir(resolve(runtimeRoot, "pglite"));
  const sessionChatDbDataPath = ensureDir(
    resolve(runtimeRoot, "session-chat-db"),
  );
  const openclawRuntimeRoot = ensureDir(resolve(runtimeRoot, "openclaw"));
  const openclawConfigDir = ensureDir(resolve(openclawRuntimeRoot, "config"));
  const openclawStateDir = ensureDir(resolve(openclawRuntimeRoot, "state"));
  ensureDir(resolve(openclawStateDir, "skills"));
  ensureDir(resolve(openclawStateDir, "plugin-docs"));
  ensureDir(resolve(openclawStateDir, "agents"));
  const openclawPackageRoot = resolve(electronRoot, "node_modules/openclaw");
  const openclawSidecarRoot = resolve(repoRoot, ".tmp/sidecars/openclaw");
  const openclawBinPath = resolve(openclawSidecarRoot, "bin/openclaw");
  const apiSidecarRoot = resolve(repoRoot, ".tmp/sidecars/api");
  const apiModulePath = resolve(apiSidecarRoot, "dist/index.js");
  const gatewaySidecarRoot = resolve(repoRoot, ".tmp/sidecars/gateway");
  const gatewayModulePath = resolve(gatewaySidecarRoot, "dist/index.js");
  const pgliteSidecarRoot = resolve(repoRoot, ".tmp/sidecars/pglite");
  const pgliteModulePath = resolve(pgliteSidecarRoot, "index.js");
  const migrationsDir = resolve(nexuRoot, "apps/api/migrations");
  const sessionChatMigrationsDir = resolve(repoRoot, "apps/chat/migrations");
  const webSidecarRoot = resolve(repoRoot, ".tmp/sidecars/web");
  const webModulePath = resolve(webSidecarRoot, "index.js");
  const apiPort = runtimeConfig.apiPort;
  const pglitePort = runtimeConfig.pglitePort;
  const webPort = runtimeConfig.webPort;
  const sessionChatPort = runtimeConfig.sessionChatPort;
  const sessionChatDbPort = runtimeConfig.sessionChatDbPort;
  const internalApiToken =
    process.env.NEXU_INTERNAL_API_TOKEN ?? "gw-secret-token";
  const skillApiToken =
    process.env.NEXU_SKILL_API_TOKEN ?? "skill-secret-token";
  const gatewayPoolId =
    process.env.NEXU_GATEWAY_POOL_ID ?? "desktop-local-pool";
  const webUrl = runtimeConfig.webUrl;
  const authUrl = process.env.NEXU_AUTH_URL ?? runtimeConfig.apiBaseUrl;
  const sessionChatSidecarRoot = resolve(
    repoRoot,
    ".tmp/sidecars/session-chat",
  );
  const sessionChatAppRoot = resolve(sessionChatSidecarRoot, "apps/chat");
  const sessionChatModulePath = resolve(sessionChatAppRoot, "server.js");

  // Keep all default ports and local URLs defined from this one manifest factory. Other desktop
  // entry points still mirror a few of these defaults directly, so changes here should be treated
  // as contract changes until those call sites are centralized.

  return [
    {
      id: "web",
      label: "Nexu Web Surface",
      kind: "surface",
      launchStrategy: "managed",
      runner: "utility-process",
      modulePath: webModulePath,
      cwd: webSidecarRoot,
      port: webPort,
      startupTimeoutMs: 10_000,
      autoStart: true,
      env: {
        WEB_HOST: "127.0.0.1",
        WEB_PORT: String(webPort),
        WEB_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      },
    },
    {
      id: "session-chat-db",
      label: "Session Chat PGlite",
      kind: "service",
      launchStrategy: "managed",
      runner: "utility-process",
      modulePath: pgliteModulePath,
      cwd: pgliteSidecarRoot,
      port: sessionChatDbPort,
      startupTimeoutMs: 10_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_SESSION_CHAT_DB", true),
      env: {
        PGLITE_DATA_DIR: sessionChatDbDataPath,
        PGLITE_HOST: "127.0.0.1",
        PGLITE_PORT: String(sessionChatDbPort),
        PGLITE_MIGRATIONS_DIR: sessionChatMigrationsDir,
      },
    },
    {
      id: "session-chat",
      label: "Session Chat Surface",
      kind: "surface",
      launchStrategy: "managed",
      runner: "utility-process",
      modulePath: sessionChatModulePath,
      cwd: sessionChatAppRoot,
      port: sessionChatPort,
      startupTimeoutMs: 20_000,
      autoStart: true,
      env: {
        HOSTNAME: "127.0.0.1",
        PORT: String(sessionChatPort),
        // Session Chat currently talks to the local OpenClaw HTTP endpoint directly. It can cold
        // start before Gateway/OpenClaw is fully ready, so dispatch failures should be interpreted
        // as readiness/config issues rather than renderer boot failures.
        DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${sessionChatDbPort}/postgres?sslmode=disable`,
        SESSION_CHAT_MIGRATIONS_DIR: resolve(sessionChatAppRoot, "migrations"),
        OPENCLAW_BASE_URL:
          process.env.NEXU_OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789",
        OPENCLAW_GATEWAY_TOKEN: internalApiToken,
        OPENCLAW_MODEL: process.env.NEXU_OPENCLAW_MODEL ?? "openclaw",
      },
    },
    {
      id: "control-plane",
      label: "Desktop Control Plane",
      kind: "surface",
      launchStrategy: "embedded",
      port: null,
      autoStart: true,
    },
    {
      id: "pglite",
      label: "PGlite Socket",
      kind: "service",
      launchStrategy: "managed",
      runner: "spawn",
      command: process.execPath,
      args: [pgliteModulePath],
      cwd: pgliteSidecarRoot,
      port: pglitePort,
      startupTimeoutMs: 10_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_PGLITE", true),
      env: {
        PGLITE_DATA_DIR: pgliteDataPath,
        PGLITE_HOST: "127.0.0.1",
        PGLITE_PORT: String(pglitePort),
        PGLITE_MIGRATIONS_DIR: migrationsDir,
      },
    },
    {
      id: "api",
      label: "Nexu API",
      kind: "service",
      launchStrategy: "managed",
      runner: "utility-process",
      modulePath: apiModulePath,
      cwd: apiSidecarRoot,
      port: apiPort,
      startupTimeoutMs: 20_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_API", true),
      env: {
        FORCE_COLOR: "1",
        PORT: String(apiPort),
        DATABASE_URL:
          process.env.NEXU_DATABASE_URL ??
          `postgresql://postgres:postgres@127.0.0.1:${pglitePort}/postgres?sslmode=disable`,
        BETTER_AUTH_URL: authUrl,
        WEB_URL: webUrl,
        INTERNAL_API_TOKEN: internalApiToken,
        SKILL_API_TOKEN: skillApiToken,
      },
    },
    {
      id: "gateway",
      label: "Nexu Gateway",
      kind: "service",
      launchStrategy: "managed",
      runner: "utility-process",
      modulePath: gatewayModulePath,
      cwd: gatewaySidecarRoot,
      port: null,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_GATEWAY", true),
      env: {
        FORCE_COLOR: "1",
        NODE_ENV: "development",
        RUNTIME_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        RUNTIME_POOL_ID: gatewayPoolId,
        INTERNAL_API_TOKEN: internalApiToken,
        SKILL_API_TOKEN: skillApiToken,
        OPENCLAW_STATE_DIR: openclawStateDir,
        OPENCLAW_CONFIG_PATH: resolve(openclawConfigDir, "openclaw.json"),
        OPENCLAW_SKILLS_DIR: resolve(openclawStateDir, "skills"),
        OPENCLAW_BIN: process.env.NEXU_OPENCLAW_BIN ?? openclawBinPath,
        OPENCLAW_EXTENSIONS_DIR: resolve(openclawPackageRoot, "extensions"),
        RUNTIME_MANAGE_OPENCLAW_PROCESS: "true",
        RUNTIME_GATEWAY_PROBE_ENABLED: "false",
      },
    },
    {
      id: "openclaw",
      label: "OpenClaw Runtime",
      kind: "runtime",
      launchStrategy: "delegated",
      delegatedProcessMatch: "openclaw-gateway",
      port: null,
      autoStart: true,
    },
  ];
}
