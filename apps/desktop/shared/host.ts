import type { DesktopBuildInfo, DesktopRuntimeConfig } from "./runtime-config";
export type { DesktopBuildInfo, DesktopRuntimeConfig } from "./runtime-config";

export const hostInvokeChannels = [
  "app:get-info",
  "diagnostics:get-info",
  "diagnostics:crash-main",
  "diagnostics:crash-renderer",
  "diagnostics:export",
  "env:get-controller-base-url",
  "env:get-runtime-config",
  "runtime:get-state",
  "runtime:start-unit",
  "runtime:stop-unit",
  "runtime:start-all",
  "runtime:stop-all",
  "runtime:show-log-file",
  "runtime:query-events",
  "desktop:get-cloud-status",
  "desktop:create-cloud-profile",
  "desktop:connect-cloud-profile",
  "desktop:disconnect-cloud-profile",
  "desktop:switch-cloud-profile",
  "desktop:import-cloud-profiles",
  "desktop:update-cloud-profile",
  "desktop:delete-cloud-profile",
  "desktop:get-minimax-oauth-status",
  "desktop:start-minimax-oauth",
  "desktop:cancel-minimax-oauth",
  "shell:open-external",
  "update:check",
  "update:download",
  "update:install",
  "update:get-current-version",
  "update:set-channel",
  "update:set-source",
  "component:check",
  "component:install",
] as const;

export type HostInvokeChannel = (typeof hostInvokeChannels)[number];

export type RuntimeEventQuery = {
  unitId?: RuntimeUnitId;
  actionId?: string;
  reasonCode?: RuntimeReasonCode;
  afterCursor?: number;
  limit?: number;
};

export type RuntimeEventQueryResult = {
  entries: RuntimeLogEntry[];
  nextCursor: number;
};

export type DiagnosticsExportResult = {
  status: "success" | "cancelled" | "failed";
  outputPath?: string;
  warnings?: string[];
  errorMessage?: string;
};

export type StartupProbeStatus = "ok" | "error";

export type StartupProbePayload = {
  source: "main" | "preload" | "renderer";
  stage: string;
  status: StartupProbeStatus;
  detail?: string | null;
};

export type HostInvokePayloadMap = {
  "app:get-info": undefined;
  "diagnostics:get-info": undefined;
  "diagnostics:crash-main": undefined;
  "diagnostics:crash-renderer": undefined;
  "diagnostics:export": { source: "diagnostics-page" | "help-menu" };
  "env:get-controller-base-url": undefined;
  "env:get-runtime-config": undefined;
  "runtime:get-state": undefined;
  "runtime:start-unit": {
    id: RuntimeUnitId;
  };
  "runtime:stop-unit": {
    id: RuntimeUnitId;
  };
  "runtime:start-all": undefined;
  "runtime:stop-all": undefined;
  "runtime:show-log-file": {
    id: RuntimeUnitId;
  };
  "runtime:query-events": RuntimeEventQuery;
  "desktop:get-cloud-status": undefined;
  "desktop:create-cloud-profile": {
    profile: {
      name: string;
      cloudUrl: string;
      linkUrl: string;
    };
  };
  "desktop:connect-cloud-profile": {
    name: string;
  };
  "desktop:disconnect-cloud-profile": {
    name: string;
  };
  "desktop:switch-cloud-profile": {
    name: string;
  };
  "desktop:import-cloud-profiles": {
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
    }>;
  };
  "desktop:update-cloud-profile": {
    previousName: string;
    profile: {
      name: string;
      cloudUrl: string;
      linkUrl: string;
    };
  };
  "desktop:delete-cloud-profile": {
    name: string;
  };
  "desktop:get-minimax-oauth-status": undefined;
  "desktop:start-minimax-oauth": {
    region: "global" | "cn";
  };
  "desktop:cancel-minimax-oauth": undefined;
  "shell:open-external": {
    url: string;
  };
  "update:check": undefined;
  "update:download": undefined;
  "update:install": undefined;
  "update:get-current-version": undefined;
  "update:set-channel": { channel: UpdateChannelName };
  "update:set-source": { source: UpdateSource };
  "component:check": undefined;
  "component:install": { id: string };
};

export type HostInvokeResultMap = {
  "app:get-info": AppInfo;
  "diagnostics:get-info": DiagnosticsInfo;
  "diagnostics:crash-main": undefined;
  "diagnostics:crash-renderer": undefined;
  "diagnostics:export": DiagnosticsExportResult;
  "env:get-controller-base-url": {
    controllerBaseUrl: string;
  };
  "env:get-runtime-config": DesktopRuntimeConfig;
  "runtime:get-state": RuntimeState;
  "runtime:start-unit": RuntimeState;
  "runtime:stop-unit": RuntimeState;
  "runtime:start-all": RuntimeState;
  "runtime:stop-all": RuntimeState;
  "runtime:show-log-file": {
    ok: boolean;
  };
  "runtime:query-events": RuntimeEventQueryResult;
  "desktop:get-cloud-status": {
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
  };
  "desktop:create-cloud-profile": {
    ok: boolean;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
    configPushed: boolean;
  };
  "desktop:connect-cloud-profile": {
    browserUrl?: string;
    error?: string;
    status: HostInvokeResultMap["desktop:get-cloud-status"];
    configPushed: boolean;
  };
  "desktop:disconnect-cloud-profile": {
    ok: boolean;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
    configPushed: boolean;
  };
  "desktop:switch-cloud-profile": {
    ok: boolean;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
    configPushed: boolean;
  };
  "desktop:import-cloud-profiles": {
    ok: boolean;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
    configPushed: boolean;
  };
  "desktop:update-cloud-profile": {
    ok: boolean;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
    configPushed: boolean;
  };
  "desktop:delete-cloud-profile": {
    ok: boolean;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    models?: Array<{
      id: string;
      name: string;
      provider?: string;
    }>;
    cloudUrl: string;
    linkUrl: string | null;
    activeProfileName: string;
    profiles: Array<{
      name: string;
      cloudUrl: string;
      linkUrl: string;
      connected: boolean;
      polling?: boolean;
      userName?: string | null;
      userEmail?: string | null;
      connectedAt?: string | null;
      modelCount: number;
    }>;
    configPushed: boolean;
  };
  "desktop:get-minimax-oauth-status": {
    connected: boolean;
    inProgress: boolean;
    region?: "global" | "cn" | null;
    error?: string | null;
  };
  "desktop:start-minimax-oauth": {
    connected: boolean;
    inProgress: boolean;
    region?: "global" | "cn" | null;
    error?: string | null;
    browserUrl?: string;
    started: boolean;
  };
  "desktop:cancel-minimax-oauth": {
    connected: boolean;
    inProgress: boolean;
    region?: "global" | "cn" | null;
    error?: string | null;
    cancelled: boolean;
  };
  "shell:open-external": {
    ok: boolean;
  };
  "update:check": { updateAvailable: boolean };
  "update:download": { ok: boolean };
  "update:install": undefined;
  "update:get-current-version": { version: string };
  "update:set-channel": { ok: boolean };
  "update:set-source": { ok: boolean };
  "component:check": {
    updates: Array<{
      id: string;
      currentVersion: string | null;
      newVersion: string;
      size: number;
    }>;
  };
  "component:install": { ok: boolean };
};

export type AppInfo = {
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  isDev: boolean;
};

export type DiagnosticsInfo = {
  crashDumpsPath: string;
  processType: string;
  sentryMainEnabled: boolean;
  sentryDsn: string | null;
  nativeCrashPipeline: "local-only" | "sentry";
};

export type DesktopSurface =
  | "web"
  | "openclaw"
  | "control"
  | "cloud-profile"
  | "diagnostics";

export type DesktopChromeMode = "full" | "immersive";

export type HostDesktopCommand =
  | {
      type: "develop:focus-surface";
      surface: Exclude<DesktopSurface, "control">;
      chromeMode: DesktopChromeMode;
    }
  | {
      type: "develop:show-shell";
      surface: DesktopSurface;
      chromeMode: DesktopChromeMode;
    }
  | {
      type: "desktop:check-for-updates";
    };

export type RuntimeUnitSnapshot = Omit<RuntimeUnitState, "logTail">;

export type RuntimeEvent =
  | {
      type: "runtime:unit-state";
      unit: RuntimeUnitSnapshot;
    }
  | {
      type: "runtime:unit-log";
      unitId: RuntimeUnitId;
      entry: RuntimeLogEntry;
    };

export type RuntimeUnitId = "web" | "control-plane" | "controller" | "openclaw";

export type RuntimeUnitKind = "surface" | "service" | "runtime";

export type RuntimeUnitLaunchStrategy =
  | "embedded"
  | "managed"
  | "delegated"
  | "launchd";

export type RuntimeUnitPhase =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type RuntimeLogStream = "stdout" | "stderr" | "system";

export type RuntimeLogKind = "app" | "lifecycle" | "probe";

export type RuntimeReasonCode =
  | "embedded_unit"
  | "start_requested"
  | "start_succeeded"
  | "port_ready"
  | "start_failed"
  | "stop_requested"
  | "managed_error"
  | "process_exited"
  | "delegated_process_detected"
  | "delegated_process_missing"
  | "stdout_line"
  | "stderr_line"
  | "auto_restart_scheduled"
  | "max_restarts_exceeded"
  | "launchd_running"
  | "launchd_stopped"
  | "launchd_start_requested"
  | "launchd_stop_requested"
  | "launchd_log_line";

export type RuntimeLogEntry = {
  id: string;
  cursor: number;
  ts: string;
  unitId: RuntimeUnitId;
  stream: RuntimeLogStream;
  kind: RuntimeLogKind;
  actionId: string | null;
  reasonCode: RuntimeReasonCode;
  message: string;
};

export type RuntimeUnitState = {
  id: RuntimeUnitId;
  label: string;
  kind: RuntimeUnitKind;
  launchStrategy: RuntimeUnitLaunchStrategy;
  phase: RuntimeUnitPhase;
  autoStart: boolean;
  pid: number | null;
  port: number | null;
  startedAt: string | null;
  exitedAt: string | null;
  exitCode: number | null;
  lastError: string | null;
  lastReasonCode: RuntimeReasonCode | null;
  lastProbeAt: string | null;
  restartCount: number;
  commandSummary: string | null;
  binaryPath: string | null;
  logFilePath: string | null;
  logTail: RuntimeLogEntry[];
};

export type RuntimeState = {
  startedAt: string;
  units: RuntimeUnitState[];
};

export type HostBridge = {
  bootstrap: HostBootstrap;
  invoke<TChannel extends HostInvokeChannel>(
    channel: TChannel,
    payload: HostInvokePayloadMap[TChannel],
  ): Promise<HostInvokeResultMap[TChannel]>;
  reportStartupProbe(payload: StartupProbePayload): void;
  onDesktopCommand(listener: (command: HostDesktopCommand) => void): () => void;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
};

export type HostBootstrap = {
  buildInfo: DesktopBuildInfo;
  sentryDsn: string | null;
  isPackaged: boolean;
};

export type UpdateSource = "r2" | "github";
export type UpdateChannelName = "stable" | "beta" | "nightly";

export const updaterEvents = [
  "update:checking",
  "update:available",
  "update:up-to-date",
  "update:progress",
  "update:downloaded",
  "update:error",
] as const;

export type UpdaterEvent = (typeof updaterEvents)[number];

export interface UpdateCheckDiagnostic {
  channel: UpdateChannelName;
  source: UpdateSource;
  feedUrl: string;
  currentVersion: string;
  remoteVersion?: string;
  remoteReleaseDate?: string;
}

export type UpdaterEventMap = {
  "update:checking": UpdateCheckDiagnostic;
  "update:available": {
    version: string;
    releaseNotes?: string;
    diagnostic: UpdateCheckDiagnostic;
  };
  "update:up-to-date": {
    diagnostic: UpdateCheckDiagnostic;
  };
  "update:progress": {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  "update:downloaded": { version: string };
  "update:error": {
    message: string;
    diagnostic?: UpdateCheckDiagnostic;
  };
};

export type UpdaterBridge = {
  onEvent<TEvent extends UpdaterEvent>(
    event: TEvent,
    callback: (data: UpdaterEventMap[TEvent]) => void,
  ): () => void;
};
