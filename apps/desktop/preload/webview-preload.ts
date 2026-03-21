/**
 * Webview preload — bridges Electron update IPC events and host invoke
 * to the web app running inside the <webview> tag. This allows the web
 * app's useAutoUpdate() hook to receive update events and trigger
 * download/install actions natively.
 */
import { contextBridge, ipcRenderer } from "electron";
import {
  type UpdaterBridge,
  type UpdaterEvent,
  type UpdaterEventMap,
  updaterEvents,
} from "../shared/host";

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

// Debug: mark that the preload ran
contextBridge.exposeInMainWorld("__webviewPreloadOk", true);

// Minimal host bridge — only update-related invoke channels
const updateChannels = new Set([
  "update:check",
  "update:download",
  "update:install",
  "update:get-current-version",
]);

contextBridge.exposeInMainWorld("nexuHost", {
  bootstrap: { isPackaged: true, buildInfo: {}, sentryDsn: null },
  invoke(channel: string, payload: unknown) {
    if (!updateChannels.has(channel)) {
      throw new Error(`Invalid webview host channel: ${channel}`);
    }
    return ipcRenderer.invoke("host:invoke", channel, payload);
  },
});
