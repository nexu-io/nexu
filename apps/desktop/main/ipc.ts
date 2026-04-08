import * as Sentry from "@sentry/electron/main";
import {
  BrowserWindow,
  app,
  crashReporter,
  ipcMain,
  shell,
  webContents,
} from "electron";
import {
  type HostInvokePayloadMap,
  type HostInvokeResultMap,
  type StartupProbePayload,
  hostInvokeChannels,
} from "../shared/host";
import type { DesktopRuntimeConfig } from "../shared/runtime-config";
import type { DesktopDiagnosticsReporter } from "./desktop-diagnostics";
import { exportDiagnostics } from "./diagnostics-export";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import {
  type QuitHandlerOptions,
  runTeardownAndExit,
} from "./services/quit-handler";
import type { ComponentUpdater } from "./updater/component-updater";
import type { UpdateManager } from "./updater/update-manager";

const validChannels = new Set<string>(hostInvokeChannels);

let updateManager: UpdateManager | null = null;
let componentUpdater: ComponentUpdater | null = null;
let quitHandlerOpts: QuitHandlerOptions | null = null;
let quitFallback: (() => Promise<void>) | null = null;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchControllerJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < 9) {
        await sleep(500);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to reach controller.");
}

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

export function setQuitHandlerOpts(opts: QuitHandlerOptions): void {
  quitHandlerOpts = opts;
}

export function setQuitFallback(fallback: () => Promise<void>): void {
  quitFallback = fallback;
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
  diagnosticsReporter: DesktopDiagnosticsReporter | null,
  coldStartReady?: Promise<void>,
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
            proxy: {
              source: runtimeConfig.proxy.source,
              httpProxyRedacted:
                runtimeConfig.proxy.diagnostics.httpProxyRedacted,
              httpsProxyRedacted:
                runtimeConfig.proxy.diagnostics.httpsProxyRedacted,
              allProxyRedacted:
                runtimeConfig.proxy.diagnostics.allProxyRedacted,
              noProxy: [...runtimeConfig.proxy.bypass],
            },
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
          // Wait for cold-start to finish so the renderer gets final ports
          // (web port may change due to fallback during bootstrap).
          if (coldStartReady) await coldStartReady;
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

        case "desktop:get-cloud-status": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:get-cloud-status"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-status`,
          );
        }

        case "desktop:create-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:create-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:create-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/create`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:connect-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:connect-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:connect-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/connect`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: typedPayload.name }),
            },
          );
        }

        case "desktop:disconnect-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:disconnect-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:disconnect-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/disconnect`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: typedPayload.name }),
            },
          );
        }

        case "desktop:switch-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:switch-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:switch-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/select`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: typedPayload.name }),
            },
          );
        }

        case "desktop:import-cloud-profiles": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:import-cloud-profiles"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:import-cloud-profiles"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profiles/import`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profiles: typedPayload.profiles }),
            },
          );
        }

        case "desktop:update-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:update-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:update-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/update`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:delete-cloud-profile": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:delete-cloud-profile"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:delete-cloud-profile"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/cloud-profile/delete`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:get-minimax-oauth-status": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:get-minimax-oauth-status"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/v1/providers/minimax/oauth/status`,
          );
        }

        case "desktop:start-minimax-oauth": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:start-minimax-oauth"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:start-minimax-oauth"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/v1/providers/minimax/oauth/login`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(typedPayload),
            },
          );
        }

        case "desktop:cancel-minimax-oauth": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:cancel-minimax-oauth"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/v1/providers/minimax/oauth/login`,
            {
              method: "DELETE",
            },
          );
        }

        case "desktop:get-rewards-status": {
          return fetchControllerJson<
            HostInvokeResultMap["desktop:get-rewards-status"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/rewards`,
          );
        }

        case "desktop:set-reward-balance": {
          const typedPayload =
            payload as HostInvokePayloadMap["desktop:set-reward-balance"];
          return fetchControllerJson<
            HostInvokeResultMap["desktop:set-reward-balance"]
          >(
            `${runtimeConfig.urls.controllerBase}/api/internal/desktop/rewards/set-balance`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ balance: typedPayload.balance }),
            },
          );
        }

        case "desktop:rewards-updated": {
          for (const contents of webContents.getAllWebContents()) {
            if (!contents.isDestroyed()) {
              contents.send("host:desktop-command", {
                type: "desktop:rewards-updated",
              });
            }
          }

          const result: HostInvokeResultMap["desktop:rewards-updated"] = {
            ok: true,
          };

          return result;
        }

        case "shell:open-external": {
          const typedPayload =
            payload as HostInvokePayloadMap["shell:open-external"];
          console.info("[host:invoke:shell-open-external]", typedPayload.url);
          await shell.openExternal(typedPayload.url);
          console.info(
            "[host:invoke:shell-open-external:done]",
            typedPayload.url,
          );

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

        case "setup:animation-complete": {
          // Restore vibrancy now that the white-background animation
          // overlay has been removed.
          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.setMinimumSize(1120, 720);
            if (process.platform === "darwin") {
              win.setBackgroundColor("#00000000");
              win.setVibrancy("sidebar");
            }
          }
          return undefined;
        }

        case "app:quit": {
          const typedPayload = payload as HostInvokePayloadMap["app:quit"];
          if (typedPayload.decision === "run-in-background") {
            const bgWin = BrowserWindow.getAllWindows()[0];
            if (bgWin) bgWin.hide();
            return undefined;
          }
          // quit-completely: use the fail-safe teardown path (finally → app.exit(0))
          // so the process always exits even if teardown throws.
          if (quitHandlerOpts) {
            void runTeardownAndExit(quitHandlerOpts, "ipc-quit");
          } else if (quitFallback) {
            void quitFallback();
          } else {
            console.warn(
              "[app:quit] quit fallback unavailable, forcing app.exit(0)",
            );
            app.exit(0);
          }
          return undefined;
        }

        default:
          throw new Error(`Unhandled host channel: ${channel satisfies never}`);
      }
    },
  );

  ipcMain.on("host:startup-probe", (_event, payload: StartupProbePayload) => {
    diagnosticsReporter?.recordStartupProbe(payload);
  });
}
