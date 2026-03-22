import * as Sentry from "@sentry/electron/main";
import { BrowserWindow, app, crashReporter, ipcMain, shell } from "electron";
import {
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  hostInvokeChannels,
} from "../shared/host";
import type { DesktopRuntimeConfig } from "../shared/runtime-config";
import { ensureDesktopAuthSession } from "./desktop-bootstrap";
import { exportDiagnostics } from "./diagnostics-export";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import type { ComponentUpdater } from "./updater/component-updater";
import type { UpdateManager } from "./updater/update-manager";

const validChannels = new Set<string>(hostInvokeChannels);

let updateManager: UpdateManager | null = null;
let componentUpdater: ComponentUpdater | null = null;

const nativeCrashTestTitles = {
  main: "desktop.main.crash",
  renderer: "desktop.renderer.crash",
} as const;

const nativeCrashAnnotationKeys = {
  title: "nexu.crash_title",
  kind: "nexu.crash_kind",
} as const;

function setNativeCrashAnnotations(
  title: (typeof nativeCrashTestTitles)[keyof typeof nativeCrashTestTitles],
): void {
  crashReporter.addExtraParameter(nativeCrashAnnotationKeys.title, title);
  crashReporter.addExtraParameter(
    nativeCrashAnnotationKeys.kind,
    "native_crash",
  );
}

function clearNativeCrashAnnotations(): void {
  crashReporter.removeExtraParameter(nativeCrashAnnotationKeys.title);
  crashReporter.removeExtraParameter(nativeCrashAnnotationKeys.kind);
}

async function prepareNativeCrashScope(
  title: (typeof nativeCrashTestTitles)[keyof typeof nativeCrashTestTitles],
): Promise<void> {
  setNativeCrashAnnotations(title);

  if (!Sentry.isInitialized()) {
    return;
  }

  const scope = Sentry.getCurrentScope();
  scope.setTag("nexu.crash_title", title);
  scope.setTag("nexu.crash_kind", "native_crash");
  scope.setExtra("nexu.crash_title", title);
  scope.setFingerprint([title]);

  await new Promise((resolve) => setTimeout(resolve, 50));
}

export function setUpdateManager(manager: UpdateManager | null): void {
  updateManager = manager;
}

export function setComponentUpdater(updater: ComponentUpdater): void {
  componentUpdater = updater;
}

function assertValidChannel(
  channel: string,
): asserts channel is keyof HostInvokePayloadMap {
  if (!validChannels.has(channel)) {
    throw new Error(`Unsupported host channel: ${channel}`);
  }
}

export function registerIpcHandlers(
  orchestrator: RuntimeOrchestrator,
  runtimeConfig: DesktopRuntimeConfig,
): void {
  orchestrator.subscribe((runtimeEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("host:runtime-event", runtimeEvent);
    }
  });

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

        case "diagnostics:get-info": {
          const sentryDsn = runtimeConfig.sentryDsn;
          const sentryMainEnabled = Boolean(sentryDsn);
          const result: HostInvokeResultMap["diagnostics:get-info"] = {
            crashDumpsPath: app.getPath("crashDumps"),
            processType: process.type,
            sentryMainEnabled,
            sentryDsn,
            nativeCrashPipeline: sentryMainEnabled ? "sentry" : "local-only",
          };

          return result;
        }

        case "diagnostics:crash-main": {
          await prepareNativeCrashScope(nativeCrashTestTitles.main);
          process.crash();
          return undefined;
        }

        case "diagnostics:crash-renderer": {
          const browserWindow = BrowserWindow.fromWebContents(_event.sender);

          if (!browserWindow) {
            throw new Error("Could not resolve the active browser window.");
          }

          await prepareNativeCrashScope(nativeCrashTestTitles.renderer);
          browserWindow.webContents.forcefullyCrashRenderer();
          setTimeout(() => {
            clearNativeCrashAnnotations();
          }, 5000);
          return undefined;
        }

        case "diagnostics:export": {
          const typedPayload =
            payload as HostInvokePayloadMap["diagnostics:export"];
          return exportDiagnostics({
            orchestrator,
            runtimeConfig,
            source: typedPayload.source,
          });
        }

        case "env:get-controller-base-url": {
          const result: HostInvokeResultMap["env:get-controller-base-url"] = {
            controllerBaseUrl: runtimeConfig.urls.controllerBase,
          };

          return result;
        }

        case "env:get-runtime-config": {
          return runtimeConfig;
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

        case "runtime:query-events": {
          const typedPayload =
            payload as HostInvokePayloadMap["runtime:query-events"];
          return orchestrator.queryEvents(typedPayload);
        }

        case "desktop:ensure-auth-session": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:ensure-auth-session"];
          await ensureDesktopAuthSession({
            force: typedPayload.force === true,
            runtimeConfig,
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

        case "update:check": {
          if (!updateManager) {
            return { updateAvailable: false };
          }
          return updateManager.checkNow();
        }

        case "update:download": {
          if (!updateManager) {
            return { ok: false };
          }
          return updateManager.downloadUpdate();
        }

        case "update:install": {
          if (!updateManager) {
            return undefined;
          }
          await updateManager.quitAndInstall();
          return undefined;
        }

        case "update:get-current-version": {
          return { version: app.getVersion() };
        }

        case "update:set-channel": {
          const typedPayload =
            payload as HostInvokePayloadMap["update:set-channel"];
          updateManager?.setChannel(typedPayload.channel);
          return { ok: true };
        }

        case "update:set-source": {
          const typedPayload =
            payload as HostInvokePayloadMap["update:set-source"];
          updateManager?.setSource(typedPayload.source);
          return { ok: true };
        }

        case "component:check": {
          if (!componentUpdater) {
            return { updates: [] };
          }
          const updates = await componentUpdater.checkForUpdates(
            app.getVersion(),
          );
          return {
            updates: updates.map((u) => ({
              id: u.id,
              currentVersion: u.currentVersion,
              newVersion: u.newVersion,
              size: u.size,
            })),
          };
        }

        case "component:install": {
          if (!componentUpdater) {
            return { ok: false };
          }
          const typedPayload =
            payload as HostInvokePayloadMap["component:install"];
          const updates = await componentUpdater.checkForUpdates(
            app.getVersion(),
          );
          const update = updates.find((u) => u.id === typedPayload.id);
          if (!update) {
            return { ok: false };
          }
          await componentUpdater.installUpdate(update);
          return { ok: true };
        }

        default:
          throw new Error(`Unhandled host channel: ${channel satisfies never}`);
      }
    },
  );
}
