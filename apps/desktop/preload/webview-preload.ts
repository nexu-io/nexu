import { contextBridge, ipcRenderer } from "electron";
import {
  type HostBridge,
  type HostDesktopCommand,
  type HostInvokeChannel,
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  type RuntimeEvent,
  type StartupProbePayload,
  hostInvokeChannels,
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

const hostBridge: HostBridge = {
  bootstrap: {
    buildInfo: runtimeConfig.buildInfo,
    sentryDsn: runtimeConfig.sentryDsn,
    posthogApiKey: runtimeConfig.posthogApiKey,
    posthogHost: runtimeConfig.posthogHost,
    isPackaged: !process.defaultApp,
    needsSetupAnimation: false,
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
