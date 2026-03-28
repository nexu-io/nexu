import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { getOpenclawSkillsDir } from "../../shared/desktop-paths";
import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import { getWorkspaceRoot } from "../../shared/workspace-paths";
import type { DesktopPlatformCapabilities } from "../platforms/types";
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

function resolveElectronNodeRunner(): string {
  return process.execPath;
}

function isExternalRuntimeMode(runtimeConfig: DesktopRuntimeConfig): boolean {
  return runtimeConfig.runtimeMode === "external";
}

export async function createRuntimeUnitManifests(
  electronRoot: string,
  userDataPath: string,
  isPackaged: boolean,
  runtimeConfig: DesktopRuntimeConfig,
  platformCapabilities: DesktopPlatformCapabilities,
): Promise<RuntimeUnitManifest[]> {
  const repoRoot = getWorkspaceRoot();
  const _nexuRoot = repoRoot;
  const runtimeSidecarBaseRoot = isPackaged
    ? path.resolve(electronRoot, "runtime")
    : path.resolve(repoRoot, ".tmp/sidecars");
  const runtimeRoot = ensureDir(path.resolve(userDataPath, "runtime"));
  const openclawSidecarRoot = isPackaged
    ? await platformCapabilities.sidecarMaterializer.materializePackagedOpenclawSidecar(
        {
          runtimeSidecarBaseRoot,
          runtimeRoot,
        },
      )
    : path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const logsDir = ensureDir(path.resolve(userDataPath, "logs/runtime-units"));
  const openclawRuntimeRoot = ensureDir(path.resolve(runtimeRoot, "openclaw"));
  const openclawConfigDir = ensureDir(
    path.resolve(openclawRuntimeRoot, "config"),
  );
  const openclawStateDir = ensureDir(
    path.resolve(openclawRuntimeRoot, "state"),
  );
  const openclawTempDir = ensureDir(path.resolve(openclawRuntimeRoot, "tmp"));
  ensureDir(getOpenclawSkillsDir(userDataPath));
  ensureDir(path.resolve(openclawStateDir, "plugin-docs"));
  ensureDir(path.resolve(openclawStateDir, "agents"));
  const openclawPackageRoot = path.resolve(
    openclawSidecarRoot,
    "node_modules/openclaw",
  );
  const controllerSidecarRoot = path.resolve(
    runtimeSidecarBaseRoot,
    "controller",
  );
  const controllerModulePath = path.resolve(
    controllerSidecarRoot,
    "dist/index.js",
  );
  const webSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "web");
  const webModulePath = path.resolve(webSidecarRoot, "index.js");
  const openclawBinPath =
    process.env.NEXU_OPENCLAW_BIN ??
    path.resolve(openclawSidecarRoot, "bin/openclaw");
  const controllerPort = runtimeConfig.ports.controller;
  const webPort = runtimeConfig.ports.web;
  const webUrl = runtimeConfig.urls.web;
  const externalRuntimeMode = isExternalRuntimeMode(runtimeConfig);
  const electronNodeRunner = resolveElectronNodeRunner();
  const openclawNodePath =
    platformCapabilities.runtimeExecutables.resolveOpenclawNodePath({
      electronRoot,
      isPackaged,
      openclawSidecarRoot,
    });
  const skillNodePath =
    platformCapabilities.runtimeExecutables.resolveSkillNodePath({
      electronRoot,
      isPackaged,
      openclawSidecarRoot,
    });

  // Keep all default ports and local URLs defined from this one manifest factory. Other desktop
  // entry points still mirror a few of these defaults directly, so changes here should be treated
  // as contract changes until those call sites are centralized.

  return [
    {
      id: "web",
      label: "nexu Web Surface",
      kind: "surface",
      launchStrategy: externalRuntimeMode ? "external" : "managed",
      runner: "spawn",
      command: electronNodeRunner,
      args: [webModulePath],
      cwd: webSidecarRoot,
      port: webPort,
      startupTimeoutMs: 10_000,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "web.log"),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        WEB_HOST: "127.0.0.1",
        WEB_PORT: String(webPort),
        WEB_API_ORIGIN: runtimeConfig.urls.controllerBase,
      },
    },
    {
      id: "control-plane",
      label: "Desktop Control Plane",
      kind: "surface",
      launchStrategy: "embedded",
      port: null,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "control-plane.log"),
    },
    {
      id: "controller",
      label: "nexu Controller",
      kind: "service",
      launchStrategy: externalRuntimeMode ? "external" : "managed",
      // Use spawn instead of utility-process due to Electron bugs:
      // - https://github.com/electron/electron/issues/43186
      //   Network requests fail with ECONNRESET after event loop blocking
      // - https://github.com/electron/electron/issues/44727
      //   Utility process uses hidden network context, not session.defaultSession
      runner: "spawn",
      command: electronNodeRunner,
      args: [controllerModulePath],
      cwd: controllerSidecarRoot,
      port: controllerPort,
      startupTimeoutMs: 20_000,
      autoStart: getBooleanEnv("NEXU_DESKTOP_AUTOSTART_CONTROLLER", true),
      logFilePath: path.resolve(logsDir, "controller.log"),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        FORCE_COLOR: "1",
        PORT: String(controllerPort),
        HOST: "127.0.0.1",
        WEB_URL: webUrl,
        NEXU_HOME: runtimeConfig.paths.nexuHome,
        OPENCLAW_STATE_DIR: openclawStateDir,
        OPENCLAW_CONFIG_PATH: path.resolve(openclawConfigDir, "openclaw.json"),
        OPENCLAW_SKILLS_DIR: getOpenclawSkillsDir(userDataPath),
        SKILLHUB_STATIC_SKILLS_DIR: isPackaged
          ? path.resolve(electronRoot, "static/bundled-skills")
          : path.resolve(repoRoot, "apps/desktop/static/bundled-skills"),
        PLATFORM_TEMPLATES_DIR: isPackaged
          ? path.resolve(electronRoot, "static/platform-templates")
          : path.resolve(repoRoot, "apps/controller/static/platform-templates"),
        OPENCLAW_BIN: openclawBinPath,
        OPENCLAW_ELECTRON_EXECUTABLE: process.execPath,
        OPENCLAW_EXTENSIONS_DIR: path.resolve(
          openclawPackageRoot,
          "extensions",
        ),
        OPENCLAW_GATEWAY_PORT: String(
          new URL(runtimeConfig.urls.openclawBase).port || 18789,
        ),
        OPENCLAW_GATEWAY_TOKEN: runtimeConfig.tokens.gateway,
        NODE_PATH: skillNodePath,
        OPENCLAW_DISABLE_BONJOUR: "1",
        TMPDIR: openclawTempDir,
        RUNTIME_MANAGE_OPENCLAW_PROCESS: "true",
        RUNTIME_GATEWAY_PROBE_ENABLED: "false",
        ...(openclawNodePath ? { PATH: openclawNodePath } : {}),
      },
    },
    {
      id: "openclaw",
      label: "OpenClaw Runtime",
      kind: "runtime",
      launchStrategy: externalRuntimeMode ? "external" : "delegated",
      delegatedProcessMatch: "openclaw-gateway",
      binaryPath: openclawBinPath,
      port: new URL(runtimeConfig.urls.openclawBase).port
        ? Number.parseInt(new URL(runtimeConfig.urls.openclawBase).port, 10)
        : 18_789,
      autoStart: true,
      logFilePath: path.resolve(logsDir, "openclaw.log"),
    },
  ];
}
