import { contextBridge, ipcRenderer } from "electron";
import {
  type HostBridge,
  type HostDesktopCommand,
  type HostInvokeChannel,
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  type RuntimeEvent,
  type StartupProbePayload,
  type UpdaterBridge,
  type UpdaterEvent,
  type UpdaterEventMap,
  hostInvokeChannels,
  updaterEvents,
} from "../shared/host";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";

const validChannels = new Set<string>(hostInvokeChannels);

const runtimeConfig = getDesktopRuntimeConfig(process.env, {
  resourcesPath: process.defaultApp ? undefined : process.resourcesPath,
  useBuildConfig: !process.defaultApp,
});

function reportStartupProbe(payload: StartupProbePayload): void {
  try {
    ipcRenderer.send("host:startup-probe", payload);
  } catch (error) {
    console.error("[desktop] failed to report startup probe", error);
  }
}

reportStartupProbe({
  source: "preload",
  stage: "preload:module-start",
  status: "ok",
});

process.on("uncaughtException", (error) => {
  reportStartupProbe({
    source: "preload",
    stage: "preload:uncaught-exception",
    status: "error",
    detail:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
});

process.on("unhandledRejection", (reason) => {
  reportStartupProbe({
    source: "preload",
    stage: "preload:unhandled-rejection",
    status: "error",
    detail:
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason),
  });
});

const hostBridge: HostBridge = {
  bootstrap: {
    buildInfo: runtimeConfig.buildInfo,
    sentryDsn: runtimeConfig.sentryDsn,
    posthogApiKey: runtimeConfig.posthogApiKey,
    posthogHost: runtimeConfig.posthogHost,
    isPackaged: !process.defaultApp,
    needsSetupAnimation: process.env.NEXU_NEEDS_SETUP_ANIMATION === "1",
    webviewPreloadUrl: new URL(
      "./webview-preload.js",
      import.meta.url,
    ).toString(),
  },

  invoke<TChannel extends HostInvokeChannel>(
    channel: TChannel,
    payload: HostInvokePayloadMap[TChannel],
  ): Promise<HostInvokeResultMap[TChannel]> {
    if (!validChannels.has(channel)) {
      throw new Error(`Invalid host channel: ${channel}`);
    }

    return ipcRenderer.invoke("host:invoke", channel, payload) as Promise<
      HostInvokeResultMap[TChannel]
    >;
  },

  reportStartupProbe(payload) {
    reportStartupProbe(payload);
  },

  onDesktopCommand(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      command: HostDesktopCommand,
    ) => {
      listener(command);
    };

    ipcRenderer.on("host:desktop-command", wrapped);

    return () => {
      ipcRenderer.removeListener("host:desktop-command", wrapped);
    };
  },

  onRuntimeEvent(listener) {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      event: RuntimeEvent,
    ) => {
      listener(event);
    };

    ipcRenderer.on("host:runtime-event", wrapped);

    return () => {
      ipcRenderer.removeListener("host:runtime-event", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("nexuHost", hostBridge);

reportStartupProbe({
  source: "preload",
  stage: "preload:bridge-exposed",
  status: "ok",
});

const validUpdaterEvents = new Set<string>(updaterEvents);

const updaterBridge: UpdaterBridge = {
  onEvent<TEvent extends UpdaterEvent>(
    event: TEvent,
    callback: (data: UpdaterEventMap[TEvent]) => void,
  ): () => void {
    if (!validUpdaterEvents.has(event)) {
      throw new Error(`Invalid updater event: ${event}`);
    }

    const handler = (
      _event: Electron.IpcRendererEvent,
      data: UpdaterEventMap[TEvent],
    ) => {
      callback(data);
    };

    ipcRenderer.on(event, handler);

    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("nexuUpdater", updaterBridge);

reportStartupProbe({
  source: "preload",
  stage: "preload:updater-bridge-exposed",
  status: "ok",
});
