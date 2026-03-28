import { resolve } from "node:path";
import type { DesktopRuntimeRoots, PlatformCapabilitiesArgs } from "../types";

function expandHomePath(input: string): string {
  return input.replace(/^~/, process.env.HOME ?? "");
}

export function resolveManagedRuntimeRoots({
  app,
  electronRoot,
  runtimeConfig,
}: PlatformCapabilitiesArgs): DesktopRuntimeRoots {
  const userDataPath = app.getPath("userData");
  const runtimeRoot = resolve(userDataPath, "runtime");
  const openclawRuntimeRoot = resolve(runtimeRoot, "openclaw");

  return {
    nexuHome: expandHomePath(runtimeConfig.paths.nexuHome),
    runtimeRoot,
    openclawRuntimeRoot,
    openclawStateDir: resolve(openclawRuntimeRoot, "state"),
    openclawConfigPath: resolve(openclawRuntimeRoot, "config", "openclaw.json"),
    openclawTmpDir: resolve(openclawRuntimeRoot, "tmp"),
    webRoot: app.isPackaged
      ? resolve(electronRoot, "runtime", "web", "dist")
      : resolve(electronRoot, "..", "web", "dist"),
    logsRoot: resolve(userDataPath, "logs"),
  };
}

export function resolveLaunchdRuntimeRoots({
  app,
  electronRoot,
  runtimeConfig,
}: PlatformCapabilitiesArgs): DesktopRuntimeRoots {
  const nexuHome = expandHomePath(runtimeConfig.paths.nexuHome);
  const openclawRuntimeRoot = app.isPackaged
    ? resolve(app.getPath("userData"), "runtime", "openclaw")
    : resolve(nexuHome, "runtime", "openclaw");

  return {
    nexuHome,
    runtimeRoot: app.isPackaged
      ? resolve(app.getPath("userData"), "runtime")
      : resolve(nexuHome, "runtime"),
    openclawRuntimeRoot,
    openclawStateDir: resolve(openclawRuntimeRoot, "state"),
    openclawConfigPath: resolve(openclawRuntimeRoot, "state", "openclaw.json"),
    openclawTmpDir: resolve(openclawRuntimeRoot, "tmp"),
    webRoot: app.isPackaged
      ? resolve(electronRoot, "runtime", "web", "dist")
      : resolve(electronRoot, "..", "web", "dist"),
    logsRoot: resolve(nexuHome, "logs"),
  };
}
