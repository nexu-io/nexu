import type {
  AppInfo,
  DesktopChromeMode,
  DesktopRuntimeConfig,
  DesktopSurface,
  HostDesktopCommand,
  RuntimeState,
  RuntimeUnitId,
} from "@shared/host";

function getHostBridge() {
  if (typeof window === "undefined" || !window.nexuHost) {
    throw new Error("Nexu host bridge is unavailable.");
  }

  return window.nexuHost;
}

export async function getAppInfo(): Promise<AppInfo> {
  return getHostBridge().invoke("app:get-info", undefined);
}

export async function getApiBaseUrl(): Promise<string> {
  const result = await getHostBridge().invoke(
    "env:get-api-base-url",
    undefined,
  );
  return result.apiBaseUrl;
}

export async function getRuntimeConfig(): Promise<DesktopRuntimeConfig> {
  return getHostBridge().invoke("env:get-runtime-config", undefined);
}

export async function openExternal(url: string): Promise<void> {
  await getHostBridge().invoke("shell:open-external", { url });
}

export async function getRuntimeState(): Promise<RuntimeState> {
  return getHostBridge().invoke("runtime:get-state", undefined);
}

export async function startAllUnits(): Promise<RuntimeState> {
  return getHostBridge().invoke("runtime:start-all", undefined);
}

export async function stopAllUnits(): Promise<RuntimeState> {
  return getHostBridge().invoke("runtime:stop-all", undefined);
}

export async function startUnit(id: RuntimeUnitId): Promise<RuntimeState> {
  return getHostBridge().invoke("runtime:start-unit", { id });
}

export async function stopUnit(id: RuntimeUnitId): Promise<RuntimeState> {
  return getHostBridge().invoke("runtime:stop-unit", { id });
}

export function onDesktopCommand(
  listener: (command: HostDesktopCommand) => void,
): () => void {
  return getHostBridge().onDesktopCommand(listener);
}

export function isDesktopSurfaceFocused(
  activeSurface: DesktopSurface,
  chromeMode: DesktopChromeMode,
): boolean {
  return chromeMode === "immersive" && activeSurface !== "control";
}
