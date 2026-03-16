import { app, ipcMain, shell } from "electron";
import {
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  hostInvokeChannels,
} from "../shared/host";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { ensureDesktopAuthSession } from "./desktop-bootstrap";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";

const validChannels = new Set<string>(hostInvokeChannels);

function assertValidChannel(
  channel: string,
): asserts channel is keyof HostInvokePayloadMap {
  if (!validChannels.has(channel)) {
    throw new Error(`Unsupported host channel: ${channel}`);
  }
}

export function registerIpcHandlers(orchestrator: RuntimeOrchestrator): void {
  ipcMain.handle(
    "host:invoke",
    async (_event, channel: string, payload: unknown) => {
      assertValidChannel(channel);

      switch (channel) {
        case "app:get-info": {
          const result: HostInvokeResultMap["app:get-info"] = {
            appName: app.getName(),
            appVersion: app.getVersion(),
            platform: process.platform,
            isDev: !app.isPackaged,
          };

          return result;
        }

        case "env:get-api-base-url": {
          const apiBaseUrl = getDesktopRuntimeConfig(process.env).apiBaseUrl;

          const result: HostInvokeResultMap["env:get-api-base-url"] = {
            apiBaseUrl,
          };

          return result;
        }

        case "env:get-runtime-config": {
          return getDesktopRuntimeConfig(process.env);
        }

        case "runtime:get-state": {
          return orchestrator.getRuntimeState();
        }

        case "runtime:start-unit": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:start-unit"];
          return orchestrator.startOne(typedPayload.id);
        }

        case "runtime:stop-unit": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:stop-unit"];
          return orchestrator.stopOne(typedPayload.id);
        }

        case "runtime:start-all": {
          return orchestrator.startAll();
        }

        case "runtime:stop-all": {
          return orchestrator.stopAll();
        }

        case "runtime:show-log-file": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:show-log-file"];
          const logFilePath = orchestrator.getLogFilePath(typedPayload.id);

          if (logFilePath) {
            shell.showItemInFolder(logFilePath);
          }

          const result: HostInvokeResultMap["runtime:show-log-file"] = {
            ok: logFilePath !== null,
          };

          return result;
        }

        case "desktop:ensure-auth-session": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:ensure-auth-session"];
          await ensureDesktopAuthSession({
            force: typedPayload.force === true,
          });

          const result: HostInvokeResultMap["desktop:ensure-auth-session"] = {
            ok: true,
          };

          return result;
        }

        case "shell:open-external": {
          const typedPayload =
            payload as HostInvokePayloadMap["shell:open-external"];
          await shell.openExternal(typedPayload.url);

          const result: HostInvokeResultMap["shell:open-external"] = {
            ok: true,
          };

          return result;
        }

        default:
          throw new Error(`Unhandled host channel: ${channel satisfies never}`);
      }
    },
  );
}
