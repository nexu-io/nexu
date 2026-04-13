import type {
  AppInfo,
  DesktopRuntimeConfig,
  DesktopUpdateCapability,
  DiagnosticsExportResult,
  DiagnosticsInfo,
  HostDesktopCommand,
  RuntimeEvent,
  RuntimeEventQuery,
  RuntimeEventQueryResult,
  RuntimeState,
  RuntimeUnitId,
  StartupProbePayload,
  UpdateChannelName,
  UpdateSource,
} from "@shared/host";
function getHostBridge() {
  if (typeof window === "undefined" || !window.nexuHost) {
    throw new Error("nexu host bridge is unavailable.");
  }

  return window.nexuHost;
}

export async function getAppInfo(): Promise<AppInfo> {
  return getHostBridge().invoke("app:get-info", undefined);
}

export async function getDiagnosticsInfo(): Promise<DiagnosticsInfo> {
  return getHostBridge().invoke("diagnostics:get-info", undefined);
}

export async function exportDiagnostics(
  source: "diagnostics-page" | "help-menu" = "diagnostics-page",
): Promise<DiagnosticsExportResult> {
  return getHostBridge().invoke("diagnostics:export", { source });
}

export function reportStartupProbe(payload: StartupProbePayload): void {
  getHostBridge().reportStartupProbe(payload);
}

export function reportDesktopDevPageError(input: {
  level: "error";
  message: string;
  url: string | null;
  sourceId: string | null;
  line: number | null;
}): void {
  getHostBridge().reportRendererDiagnosticsLog({
    source: "page-error",
    ...input,
  });
}

export async function triggerMainProcessCrash(): Promise<void> {
  await getHostBridge().invoke("diagnostics:crash-main", undefined);
}

export async function triggerRendererProcessCrash(): Promise<void> {
  await getHostBridge().invoke("diagnostics:crash-renderer", undefined);
}

export async function getControllerBaseUrl(): Promise<string> {
  const result = await getHostBridge().invoke(
    "env:get-controller-base-url",
    undefined,
  );
  return result.controllerBaseUrl;
}

export async function getRuntimeConfig(): Promise<DesktopRuntimeConfig> {
  return getHostBridge().invoke("env:get-runtime-config", undefined);
}

export async function openExternal(url: string): Promise<void> {
  await getHostBridge().invoke("shell:open-external", { url });
}

export async function notifySetupAnimationComplete(): Promise<void> {
  await getHostBridge().invoke("setup:animation-complete", undefined);
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

export async function showRuntimeLogFile(id: RuntimeUnitId): Promise<boolean> {
  const result = await getHostBridge().invoke("runtime:show-log-file", { id });
  return result.ok;
}

export async function queryRuntimeEvents(
  input: RuntimeEventQuery,
): Promise<RuntimeEventQueryResult> {
  const result = await getHostBridge().invoke("runtime:query-events", input);
  return result;
}

export async function getDesktopCloudStatus() {
  return getHostBridge().invoke("desktop:get-cloud-status", undefined);
}

export async function getDesktopRewardsStatus() {
  return getHostBridge().invoke("desktop:get-rewards-status", undefined);
}

export async function setDesktopRewardBalance(balance: number) {
  return getHostBridge().invoke("desktop:set-reward-balance", { balance });
}

export async function notifyDesktopRewardsUpdated(): Promise<void> {
  await getHostBridge().invoke("desktop:rewards-updated", undefined);
}

export async function createCloudProfile(profile: {
  name: string;
  cloudUrl: string;
  linkUrl: string;
}) {
  return getHostBridge().invoke("desktop:create-cloud-profile", { profile });
}

export async function connectCloudProfile(name: string) {
  return getHostBridge().invoke("desktop:connect-cloud-profile", { name });
}

export async function disconnectCloudProfile(name: string) {
  return getHostBridge().invoke("desktop:disconnect-cloud-profile", { name });
}

export async function switchCloudProfile(name: string) {
  return getHostBridge().invoke("desktop:switch-cloud-profile", { name });
}

export async function importCloudProfiles(
  profiles: Array<{ name: string; cloudUrl: string; linkUrl: string }>,
) {
  return getHostBridge().invoke("desktop:import-cloud-profiles", { profiles });
}

export async function updateCloudProfile(
  previousName: string,
  profile: { name: string; cloudUrl: string; linkUrl: string },
) {
  return getHostBridge().invoke("desktop:update-cloud-profile", {
    previousName,
    profile,
  });
}

export async function deleteCloudProfile(name: string) {
  return getHostBridge().invoke("desktop:delete-cloud-profile", { name });
}

export async function getMiniMaxOauthStatus() {
  return getHostBridge().invoke("desktop:get-minimax-oauth-status", undefined);
}

export async function startMiniMaxOauth(region: "global" | "cn") {
  return getHostBridge().invoke("desktop:start-minimax-oauth", { region });
}

export async function cancelMiniMaxOauth() {
  return getHostBridge().invoke("desktop:cancel-minimax-oauth", undefined);
}

export function onDesktopCommand(
  listener: (command: HostDesktopCommand) => void,
): () => void {
  return getHostBridge().onDesktopCommand(listener);
}

export function onRuntimeEvent(
  listener: (event: RuntimeEvent) => void,
): () => void {
  return getHostBridge().onRuntimeEvent(listener);
}

export async function checkForUpdate(): Promise<boolean> {
  const result = await getHostBridge().invoke("update:check", undefined);
  return result.updateAvailable;
}

export async function getUpdateCapability(): Promise<DesktopUpdateCapability> {
  return getHostBridge().invoke("update:get-capability", undefined);
}

export async function downloadUpdate(): Promise<boolean> {
  const result = await getHostBridge().invoke("update:download", undefined);
  return result.ok;
}

export async function installUpdate(): Promise<void> {
  await getHostBridge().invoke("update:install", undefined);
}

export async function getCurrentVersion(): Promise<string> {
  const result = await getHostBridge().invoke(
    "update:get-current-version",
    undefined,
  );
  return result.version;
}

export async function setUpdateChannel(
  channel: UpdateChannelName,
): Promise<boolean> {
  const result = await getHostBridge().invoke("update:set-channel", {
    channel,
  });
  return result.ok;
}

export async function setUpdateSource(source: UpdateSource): Promise<boolean> {
  const result = await getHostBridge().invoke("update:set-source", { source });
  return result.ok;
}

export async function checkComponentUpdates(): Promise<{
  updates: Array<{
    id: string;
    currentVersion: string | null;
    newVersion: string;
    size: number;
  }>;
}> {
  return getHostBridge().invoke("component:check", undefined);
}

export async function installComponent(id: string): Promise<{ ok: boolean }> {
  return getHostBridge().invoke("component:install", { id });
}
