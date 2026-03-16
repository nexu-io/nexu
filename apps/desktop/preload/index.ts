import { contextBridge, ipcRenderer } from "electron";
import {
  type HostBridge,
  type HostInvokeChannel,
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  hostInvokeChannels,
} from "../shared/host";

const validChannels = new Set<string>(hostInvokeChannels);

const hostBridge: HostBridge = {
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
};

contextBridge.exposeInMainWorld("nexuHost", hostBridge);
