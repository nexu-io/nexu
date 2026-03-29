import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/electron/main";
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  crashReporter,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  shell,
} from "electron";
import type { DesktopChromeMode, DesktopSurface } from "../shared/host";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { getDesktopSentryBuildMetadata } from "../shared/sentry-build-metadata";
import { getDesktopAppRoot } from "../shared/workspace-paths";
import { DesktopDiagnosticsReporter } from "./desktop-diagnostics";
import { exportDiagnostics } from "./diagnostics-export";
import {
  registerIpcHandlers,
  setComponentUpdater,
  setUpdateManager,
} from "./ipc";
import { getDesktopRuntimePlatformAdapter } from "./platforms";
import { resolveRuntimePlatform } from "./platforms/platform-resolver";
import type { DesktopRuntimeResidencyContext } from "./platforms/types";
import { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import { createRuntimeUnitManifests } from "./runtime/manifests";
import {
  flushRuntimeLoggers,
  rotateDesktopLogSession,
  writeDesktopMainLog,
} from "./runtime/runtime-logger";
import { SleepGuard, type SleepGuardLogEntry } from "./sleep-guard";
import { ComponentUpdater } from "./updater/component-updater";
import { StartupHealthCheck } from "./updater/rollback";
import { UpdateManager } from "./updater/update-manager";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const startupEpochMs = Date.now();
let mainWindow: BrowserWindow | null = null;
let diagnosticsReporter: DesktopDiagnosticsReporter | null = null;
let sleepGuard: SleepGuard | null = null;
let residencyContext: DesktopRuntimeResidencyContext = null;

let resolveColdStartReady: () => void;
const coldStartReady = new Promise<void>((resolve) => {
  resolveColdStartReady = resolve;
});

// Set display name early (matches productName in package.json).
app.setName("nexu");
nativeTheme.themeSource = "light";

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

// Info.plist declares LSUIElement=true so that child processes (spawned with
// ELECTRON_RUN_AS_NODE) don't create extra Dock icons.  Show the dock icon
// BEFORE any blocking initialization (tar extraction, directory creation, etc.)
// so users see it immediately on first launch.
void app.dock?.show();

const electronRoot = app.isPackaged
  ? process.resourcesPath
  : getDesktopAppRoot();
logStartupStep(
  `electron root resolved packaged=${String(app.isPackaged)} path=${electronRoot}`,
);
const baseRuntimeConfig = getDesktopRuntimeConfig(process.env, {
  appVersion: app.getVersion(),
  resourcesPath: app.isPackaged ? electronRoot : undefined,
  useBuildConfig: app.isPackaged,
});
logStartupStep("base runtime config created");
const runtimePlatform = getDesktopRuntimePlatformAdapter(baseRuntimeConfig);
const runtimeLifecycle = runtimePlatform.lifecycle;
const { allocations: runtimePortAllocations, runtimeConfig } =
  await runtimeLifecycle.prepareRuntimeConfig({
    baseRuntimeConfig,
    env: process.env,
    logStartupStep,
  });
logStartupStep(
  `runtime config ready platform=${runtimePlatform.id} residency=${runtimeLifecycle.residency} runtimeMode=${runtimeConfig.runtimeMode}`,
);
const orchestrator = new RuntimeOrchestrator(
  await measureStartupStep("createRuntimeUnitManifests", () =>
    createRuntimeUnitManifests(
      electronRoot,
      app.getPath("userData"),
      app.isPackaged,
      runtimeConfig,
      runtimePlatform.capabilities,
    ),
  ),
);
logStartupStep("runtime orchestrator created");

// Disable Chromium's popup blocker.  window.open() inside webviews can lose
// "transient user activation" after async work (fetch → response → open),
// causing silent popup blocking.  All popups are already caught by
// setWindowOpenHandler and redirected to shell.openExternal, so this is safe.
app.commandLine.appendSwitch("disable-popup-blocking");

const sentryDsn = runtimeConfig.sentryDsn;
const embeddedWorkspaceTransparentCss = `
  html,
  body,
  #root {
    background: transparent !important;
    background-color: transparent !important;
  }
`;

function readNativeCrashTestTitle(event: Sentry.Event): string | null {
  const taggedTitle =
    typeof event.tags?.["nexu.crash_title"] === "string"
      ? event.tags["nexu.crash_title"]
      : typeof event.extra?.["nexu.crash_title"] === "string"
        ? event.extra["nexu.crash_title"]
        : null;

  if (taggedTitle) {
    return taggedTitle;
  }

  const electronContext = event.contexts?.electron as
    | Record<string, unknown>
    | undefined;
  const crashpadTitle = electronContext?.["crashpad.nexu.crash_title"];

  return typeof crashpadTitle === "string" ? crashpadTitle : null;
}

function readNativeCrashTestKind(event: Sentry.Event): string | null {
  const taggedKind =
    typeof event.tags?.["nexu.crash_kind"] === "string"
      ? event.tags["nexu.crash_kind"]
      : null;

  if (taggedKind) {
    return taggedKind;
  }

  const electronContext = event.contexts?.electron as
    | Record<string, unknown>
    | undefined;
  const crashpadKind = electronContext?.["crashpad.nexu.crash_kind"];

  return typeof crashpadKind === "string" ? crashpadKind : null;
}

if (sentryDsn) {
  const sentryBuildMetadata = getDesktopSentryBuildMetadata(
    runtimeConfig.buildInfo,
  );

  Sentry.init({
    dsn: sentryDsn,
    environment: app.isPackaged ? "production" : "development",
    release: sentryBuildMetadata.release,
    ...(sentryBuildMetadata.dist ? { dist: sentryBuildMetadata.dist } : {}),
    beforeSend(event) {
      const testTitle = readNativeCrashTestTitle(event);

      if (!testTitle) {
        return event;
      }

      const testKind = readNativeCrashTestKind(event);
      const firstException = event.exception?.values?.[0];
      const updatedException = event.exception?.values
        ? {
            ...event.exception,
            values: [
              {
                ...firstException,
                type: "Error",
                value: testTitle,
              },
              ...event.exception.values.slice(1),
            ],
          }
        : {
            values: [
              {
                type: "Error",
                value: testTitle,
              },
            ],
          };

      return {
        ...event,
        message: testTitle,
        exception: updatedException,
        fingerprint: [testTitle],
        tags: {
          ...event.tags,
          "nexu.crash_title": testTitle,
          ...(testKind ? { "nexu.crash_kind": testKind } : {}),
        },
      };
    },
  });

  Sentry.setContext("build", sentryBuildMetadata.buildContext);
} else {
  crashReporter.start({
    companyName: "nexu",
    productName: app.getName(),
    submitURL: "https://127.0.0.1/desktop-crash-reporter-disabled",
    uploadToServer: false,
    compress: true,
    ignoreSystemCrashHandler: false,
    extra: {
      environment: app.isPackaged ? "production" : "development",
    },
  });
}

logLaunchTimeline(
  `runtime ports ${runtimePortAllocations
    .map(
      (allocation) =>
        `${allocation.purpose}=${allocation.preferredPort}->${allocation.port} ` +
        `strategy=${allocation.strategy} attemptDelta=${allocation.attemptDelta}`,
    )
    .join(" ")}`,
);

function sendDesktopCommand(
  surface: DesktopSurface,
  chromeMode: DesktopChromeMode,
): void {
  mainWindow?.webContents.send("host:desktop-command", {
    type:
      chromeMode === "immersive" && surface !== "control"
        ? "develop:focus-surface"
        : "develop:show-shell",
    surface,
    chromeMode,
  });
}

function triggerUpdateCheck(): void {
  mainWindow?.webContents.send("host:desktop-command", {
    type: "desktop:check-for-updates",
  });
}

function installApplicationMenu(): void {
  const runtimePlatform = resolveRuntimePlatform();
  const developMenu: MenuItemConstructorOptions = {
    label: "Develop",
    submenu: [
      {
        label: "Focus Web Surface",
        accelerator: "CmdOrCtrl+Shift+1",
        click: () => sendDesktopCommand("web", "immersive"),
      },
      {
        label: "Focus OpenClaw Surface",
        accelerator: "CmdOrCtrl+Shift+2",
        click: () => sendDesktopCommand("openclaw", "immersive"),
      },
      { type: "separator" },
      {
        label: "Show Desktop Shell",
        accelerator: "CmdOrCtrl+Shift+0",
        click: () => sendDesktopCommand("control", "full"),
      },
      {
        label: "Show Web In Shell",
        click: () => sendDesktopCommand("web", "full"),
      },
      {
        label: "Show OpenClaw In Shell",
        click: () => sendDesktopCommand("openclaw", "full"),
      },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      {
        label: "Export Diagnostics…",
        click: () => {
          void exportDiagnostics({
            orchestrator,
            runtimeConfig,
            source: "help-menu",
          }).catch(() => undefined);
        },
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(runtimePlatform === "mac"
      ? ([
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
              {
                id: "check-for-updates",
                label: "Check for Updates…",
                enabled:
                  app.isPackaged && runtimeConfig.updates.autoUpdateEnabled,
                click: () => triggerUpdateCheck(),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    developMenu,
    { role: "windowMenu" },
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getDesktopLogFilePath(name: string): string {
  return resolve(app.getPath("userData"), "logs", name);
}

function getMainWindowId(): number | null {
  return mainWindow?.webContents.id ?? null;
}

function logColdStart(message: string): void {
  writeDesktopMainLog({
    source: "cold-start",
    stream: "system",
    kind: "lifecycle",
    message,
    logFilePath: getDesktopLogFilePath("cold-start.log"),
    windowId: getMainWindowId(),
  });
}

function logLaunchTimeline(message: string): void {
  const launchId = process.env.NEXU_DESKTOP_LAUNCH_ID ?? "unknown";
  writeDesktopMainLog({
    source: "launch-timeline",
    stream: "system",
    kind: "lifecycle",
    message: `${message} launchId=${launchId}`,
    logFilePath: getDesktopLogFilePath("desktop-main.log"),
    windowId: getMainWindowId(),
  });
}

function logStartupStep(message: string): void {
  logLaunchTimeline(`[startup +${Date.now() - startupEpochMs}ms] ${message}`);
}

async function measureStartupStep<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  logStartupStep(`${name}:start`);
  try {
    const result = await operation();
    logStartupStep(`${name}:done`);
    return result;
  } catch (error) {
    logStartupStep(
      `${name}:fail ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}
function logRendererEvent({
  source,
  stream,
  kind,
  message,
  windowId,
}: {
  source: string;
  stream: "stdout" | "stderr";
  kind: "app" | "lifecycle";
  message: string;
  windowId?: number | null;
}): void {
  writeDesktopMainLog({
    source,
    stream,
    kind,
    message,
    logFilePath: getDesktopLogFilePath("desktop-main.log"),
    windowId,
  });
}

function logSleepGuard(entry: SleepGuardLogEntry): void {
  writeDesktopMainLog({
    source: "sleep-guard",
    stream: entry.stream,
    kind: entry.kind,
    message: entry.message,
    logFilePath: getDesktopLogFilePath("desktop-main.log"),
    windowId: getMainWindowId(),
  });
}

async function waitForControllerReadiness(): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 15_000;
  const probeUrl = new URL("/health", runtimeConfig.urls.controllerBase);
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(probeUrl, {
        headers: {
          Accept: "application/json",
        },
      });

      if (response.status < 500) {
        logColdStart(
          `controller ready via ${probeUrl.pathname} status=${response.status} after ${Date.now() - startedAt}ms`,
        );
        return;
      }
    } catch {
      // Ignore transient startup failures while the controller starts.
    }

    // Adaptive polling: start aggressive (50ms), increase to 250ms
    const delay = Math.min(50 + attempt * 50, 250);
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt++;
  }

  throw new Error(
    `Controller readiness probe timed out for ${probeUrl.toString()}`,
  );
}

function focusMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

app.on("second-instance", () => {
  focusMainWindow();
});

function createMainWindow(): BrowserWindow {
  logLaunchTimeline("main window creation requested");
  logStartupStep("createMainWindow:start");
  const isMacOS = resolveRuntimePlatform() === "mac";
  const window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: isMacOS ? "#00000000" : "#0B1020",
    title: "nexu",
    autoHideMenuBar: !isMacOS,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    ...(isMacOS
      ? {
          transparent: true,
          vibrancy: "sidebar" as const,
          visualEffectState: "followWindow" as const,
        }
      : {}),
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Disable sandbox for webviews so preload scripts have access to Node.js APIs
  // (needed for contextBridge/ipcRenderer in ESM-built preloads)
  window.webContents.on(
    "will-attach-webview",
    (_event, webPreferences, _params) => {
      webPreferences.sandbox = false;
    },
  );

  // Per-webContents handler is set globally via app.on('web-contents-created')
  // so we don't need one here on the main window.

  if (isMacOS) {
    window.setBackgroundColor("#00000000");
    window.setVibrancy("sidebar");
  }

  window.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const levelLabel =
        ["verbose", "info", "warning", "error"][level] ?? String(level);
      logRendererEvent({
        source: `renderer:${levelLabel}`,
        stream: level >= 3 ? "stderr" : "stdout",
        kind: "app",
        message: `${message} (${sourceId}:${line})`,
        windowId: window.webContents.id,
      });
    },
  );

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl) => {
      diagnosticsReporter?.recordRendererDidFailLoad({
        errorCode,
        errorDescription,
        validatedUrl,
      });
      logRendererEvent({
        source: "renderer:fail-load",
        stream: "stderr",
        kind: "lifecycle",
        message: `${errorCode} ${errorDescription} ${validatedUrl}`,
        windowId: window.webContents.id,
      });
    },
  );

  window.webContents.on("did-finish-load", () => {
    logStartupStep(
      `main window did-finish-load url=${window.webContents.getURL()}`,
    );
    diagnosticsReporter?.recordRendererDidFinishLoad(
      window.webContents.getURL(),
    );
    logRendererEvent({
      source: "renderer",
      stream: "stdout",
      kind: "lifecycle",
      message: `did-finish-load ${window.webContents.getURL()}`,
      windowId: window.webContents.id,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    diagnosticsReporter?.recordRendererProcessGone({
      reason: details.reason,
      exitCode: details.exitCode,
    });
    logRendererEvent({
      source: "renderer:gone",
      stream: "stderr",
      kind: "lifecycle",
      message: `reason=${details.reason} exitCode=${details.exitCode}`,
      windowId: window.webContents.id,
    });
  });

  window.once("ready-to-show", () => {
    logLaunchTimeline("main window ready-to-show");
    logStartupStep("main window ready-to-show");
    if (isMacOS) {
      window.setBackgroundColor("#00000000");
      window.setVibrancy("sidebar");
    }
    window.show();
    if (!isMacOS) {
      window.setMenuBarVisibility(false);
    }
    logStartupStep("main window show called");
    focusMainWindow();
    logStartupStep("main window focus requested");
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  const desktopDevServerUrl = process.env.NEXU_DESKTOP_DEV_SERVER_URL;

  if (desktopDevServerUrl) {
    void window.loadURL(desktopDevServerUrl);
    logLaunchTimeline(
      `main window loadURL dispatched url=${desktopDevServerUrl}`,
    );
    logStartupStep("createMainWindow:loadURL-dispatched");
  } else {
    void window.loadFile(resolve(__dirname, "../../dist/index.html"));
    logLaunchTimeline("main window loadFile dispatched");
    logStartupStep("createMainWindow:loadFile-dispatched");
  }
  mainWindow = window;
  return window;
}

// Intercept window.open() in ALL webContents (main window + webviews) and open
// the URL in the user's default system browser instead.
app.on("web-contents-created", (_event, contents) => {
  const contentType = contents.getType();

  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      setImmediate(() => {
        void shell.openExternal(url);
      });
    }
    return { action: "deny" };
  });

  if (contentType !== "webview") {
    return;
  }

  contents.on("console-message", (_event, level, message, line, sourceId) => {
    const levelLabel =
      ["verbose", "info", "warning", "error"][level] ?? String(level);
    logRendererEvent({
      source: `embedded:${contentType}:${levelLabel}`,
      stream: level >= 3 ? "stderr" : "stdout",
      kind: "app",
      message: `${message} (${sourceId}:${line})`,
      windowId: contents.id,
    });
  });

  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl) => {
      diagnosticsReporter?.recordEmbeddedDidFailLoad({
        id: contents.id,
        type: contentType,
        errorCode,
        errorDescription,
        validatedUrl,
      });
      logRendererEvent({
        source: `embedded:${contentType}:fail-load`,
        stream: "stderr",
        kind: "lifecycle",
        message: `${errorCode} ${errorDescription} ${validatedUrl}`,
        windowId: contents.id,
      });
    },
  );

  contents.on("did-finish-load", () => {
    const url = contents.getURL();
    if (url.startsWith(runtimeConfig.urls.web)) {
      void contents
        .insertCSS(embeddedWorkspaceTransparentCss)
        .catch((error) => {
          writeDesktopMainLog({
            source: `embedded:${contentType}:transparent-css`,
            stream: "stderr",
            kind: "app",
            message: `failed to inject transparent workspace CSS url=${url} error=${
              error instanceof Error ? error.message : String(error)
            }`,
            logFilePath: null,
          });
        });
    }
    diagnosticsReporter?.recordEmbeddedDidFinishLoad({
      id: contents.id,
      type: contentType,
      url,
    });
    logRendererEvent({
      source: `embedded:${contentType}`,
      stream: "stdout",
      kind: "lifecycle",
      message: `did-finish-load ${url}`,
      windowId: contents.id,
    });
  });

  contents.on("render-process-gone", (_event, details) => {
    diagnosticsReporter?.recordEmbeddedProcessGone({
      id: contents.id,
      type: contentType,
      reason: details.reason,
      exitCode: details.exitCode,
    });
    logRendererEvent({
      source: `embedded:${contentType}:gone`,
      stream: "stderr",
      kind: "lifecycle",
      message: `reason=${details.reason} exitCode=${details.exitCode}`,
      windowId: contents.id,
    });
  });
});

logLaunchTimeline("electron main module evaluated");
logStartupStep("electron main module evaluated");

app.whenReady().then(async () => {
  logLaunchTimeline("app.whenReady resolved");
  logStartupStep("app.whenReady resolved");
  logStartupStep("installApplicationMenu:start");
  installApplicationMenu();
  logStartupStep("installApplicationMenu:done");
  diagnosticsReporter = new DesktopDiagnosticsReporter(orchestrator);
  logStartupStep("DesktopDiagnosticsReporter:created");
  logStartupStep("registerIpcHandlers:start");
  registerIpcHandlers(
    orchestrator,
    runtimeConfig,
    diagnosticsReporter,
    coldStartReady,
  );
  logStartupStep("registerIpcHandlers:done");
  const unsubscribeDiagnostics = diagnosticsReporter.start();
  logStartupStep("DesktopDiagnosticsReporter:started");
  sleepGuard = new SleepGuard({
    powerMonitor,
    powerSaveBlocker,
    log: logSleepGuard,
    onSnapshot: (snapshot) => {
      diagnosticsReporter?.setSleepGuardSnapshot(snapshot);
    },
  });
  logStartupStep("SleepGuard:created");
  const win = createMainWindow();
  logStartupStep(`main window created id=${win.webContents.id}`);
  sleepGuard.start("desktop-runtime-active");
  logStartupStep("SleepGuard:started");

  void (async () => {
    const healthCheck = new StartupHealthCheck();
    const health = healthCheck.check();

    if (!health.healthy) {
      logColdStart(
        `unhealthy: ${health.consecutiveFailures} consecutive cold-start failures`,
      );
    }

    try {
      const recoveredSession = await runtimeLifecycle.recoverSession?.({
        app,
        electronRoot,
        runtimeConfig,
        logLifecycleStep: logColdStart,
      });
      if (recoveredSession?.snapshot) {
        const bindings = recoveredSession.snapshot.bindings;
        logColdStart(
          `recovery snapshot store=${recoveredSession.snapshot.store} controller=${bindings.controllerPort ?? "n/a"} web=${bindings.webPort ?? "n/a"} openclaw=${bindings.openclawPort ?? "n/a"}`,
        );
      }

      logColdStart(`bootstrap residency: ${runtimeLifecycle.residency}`);
      logColdStart(`runtime mode: ${runtimeConfig.runtimeMode}`);
      logColdStart(
        `runtime targets controller=${runtimeConfig.urls.controllerBase} web=${runtimeConfig.urls.web} openclaw=${runtimeConfig.urls.openclawBase}`,
      );
      const coldStartResult = await runtimeLifecycle.coldStartOrAttach({
        app,
        electronRoot,
        runtimeConfig,
        orchestrator,
        diagnosticsReporter,
        logColdStart,
        logStartupStep,
        rotateDesktopLogSession,
        waitForControllerReadiness,
      });
      residencyContext = coldStartResult.residencyContext;
      healthCheck.recordSuccess();
    } catch (error) {
      healthCheck.recordFailure();
      diagnosticsReporter?.markColdStartFailed(
        error instanceof Error ? error.message : String(error),
      );
      writeDesktopMainLog({
        source: "cold-start",
        stream: "stderr",
        kind: "lifecycle",
        message: error instanceof Error ? error.message : String(error),
        logFilePath: getDesktopLogFilePath("cold-start.log"),
        windowId: getMainWindowId(),
      });
    } finally {
      // Unblock renderer — it will get the final config (or show error state)
      resolveColdStartReady();
    }

    runtimeLifecycle.installShutdownCoordinator({
      app,
      mainWindow: win,
      residencyContext,
      orchestrator,
      diagnosticsReporter,
      sleepGuardDispose: (reason) => sleepGuard?.dispose(reason),
      flushRuntimeLoggers,
    });

    if (app.isPackaged && runtimeConfig.updates.autoUpdateEnabled) {
      const updateMgr = new UpdateManager(win, orchestrator, {
        channel: runtimeConfig.updates.channel,
        feedUrl: runtimeConfig.urls.updateFeed,
        prepareForUpdateInstall: runtimeLifecycle.prepareForUpdateInstall,
      });
      setUpdateManager(updateMgr);
      updateMgr.startPeriodicCheck();
    } else {
      setUpdateManager(null);
    }

    const compUpdater = new ComponentUpdater();
    setComponentUpdater(compUpdater);
  })();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      return;
    }

    focusMainWindow();
  });

  app.once("before-quit", () => {
    unsubscribeDiagnostics();
  });
});

app.on("window-all-closed", () => {
  switch (resolveRuntimePlatform()) {
    case "mac":
      return;
    case "win":
      app.quit();
      return;
  }
});
