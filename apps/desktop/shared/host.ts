import type { DesktopRuntimeConfig } from "./runtime-config";
export type { DesktopRuntimeConfig } from "./runtime-config";

export const hostInvokeChannels = [
  "app:get-info",
  "env:get-api-base-url",
  "env:get-runtime-config",
  "runtime:get-state",
  "runtime:start-unit",
  "runtime:stop-unit",
  "runtime:start-all",
  "runtime:stop-all",
  "runtime:show-log-file",
  "desktop:ensure-auth-session",
  "shell:open-external",
  "update:check",
  "update:download",
  "update:install",
  "update:get-current-version",
  "update:set-channel",
  "update:set-source",
] as const;

export type HostInvokeChannel = (typeof hostInvokeChannels)[number];

export type HostInvokePayloadMap = {
  "app:get-info": undefined;
  "env:get-api-base-url": undefined;
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
  "desktop:ensure-auth-session": {
    force?: boolean;
  };
  "shell:open-external": {
    url: string;
  };
  "update:check": undefined;
  "update:download": undefined;
  "update:install": undefined;
  "update:get-current-version": undefined;
  "update:set-channel": { channel: UpdateChannelName };
  "update:set-source": { source: UpdateSource };
};

export type HostInvokeResultMap = {
  "app:get-info": AppInfo;
  "env:get-api-base-url": {
    apiBaseUrl: string;
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
  "desktop:ensure-auth-session": {
    ok: boolean;
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
};

export type AppInfo = {
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  isDev: boolean;
};

export type DesktopSurface = "web" | "openclaw" | "control";

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
      type: "desktop:auth-session-restored";
      surface: "web";
    };

export type RuntimeUnitId =
  | "web"
  | "control-plane"
  | "pglite"
  | "api"
  | "gateway"
  | "openclaw";

export type RuntimeUnitKind = "surface" | "service" | "runtime";

export type RuntimeUnitLaunchStrategy = "embedded" | "managed" | "delegated";

export type RuntimeUnitPhase =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

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
  commandSummary: string | null;
  binaryPath: string | null;
  logFilePath: string | null;
  logTail: string[];
};

export type RuntimeState = {
  startedAt: string;
  units: RuntimeUnitState[];
};

export type HostBridge = {
  invoke<TChannel extends HostInvokeChannel>(
    channel: TChannel,
    payload: HostInvokePayloadMap[TChannel],
  ): Promise<HostInvokeResultMap[TChannel]>;
  onDesktopCommand(listener: (command: HostDesktopCommand) => void): () => void;
};

export type UpdateSource = "oss" | "github";
export type UpdateChannelName = "stable" | "beta";

export const updaterEvents = [
  "update:checking",
  "update:available",
  "update:up-to-date",
  "update:progress",
  "update:downloaded",
  "update:error",
] as const;

export type UpdaterEvent = (typeof updaterEvents)[number];

export type UpdaterEventMap = {
  "update:checking": Record<string, never>;
  "update:available": { version: string; releaseNotes?: string };
  "update:up-to-date": Record<string, never>;
  "update:progress": {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  "update:downloaded": { version: string };
  "update:error": { message: string };
};

export type UpdaterBridge = {
  onEvent<TEvent extends UpdaterEvent>(
    event: TEvent,
    callback: (data: UpdaterEventMap[TEvent]) => void,
  ): () => void;
};
