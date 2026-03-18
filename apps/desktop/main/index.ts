import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/electron/main";
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  crashReporter,
  session,
  shell,
} from "electron";
import type { DesktopChromeMode, DesktopSurface } from "../shared/host";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { getDesktopAppRoot } from "../shared/workspace-paths";
import { ensureDesktopAuthSession } from "./desktop-bootstrap";
import { DesktopDiagnosticsReporter } from "./desktop-diagnostics";
import {
  registerIpcHandlers,
  setCatalogManager,
  setComponentUpdater,
  setUpdateManager,
} from "./ipc";
import { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import { createRuntimeUnitManifests } from "./runtime/manifests";
import {
  flushRuntimeLoggers,
  rotateDesktopLogSession,
  writeDesktopMainLog,
} from "./runtime/runtime-logger";
import { CatalogManager } from "./skillhub/catalog-manager";
import { ComponentUpdater } from "./updater/component-updater";
import { StartupHealthCheck } from "./updater/rollback";
import { UpdateManager } from "./updater/update-manager";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const electronRoot = app.isPackaged
  ? process.resourcesPath
  : getDesktopAppRoot();
const runtimeConfig = getDesktopRuntimeConfig(process.env, {
  resourcesPath: electronRoot,
});
const orchestrator = new RuntimeOrchestrator(
  createRuntimeUnitManifests(
    electronRoot,
    app.getPath("userData"),
    app.isPackaged,
  ),
);

app.setName("Nexu Desktop");

// Disable Chromium's popup blocker.  window.open() inside webviews can lose
// "transient user activation" after async work (fetch → response → open),
// causing silent popup blocking.  All popups are already caught by
// setWindowOpenHandler and redirected to shell.openExternal, so this is safe.
app.commandLine.appendSwitch("disable-popup-blocking");

const sentryDsn = runtimeConfig.sentryDsn;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: app.isPackaged ? "production" : "development",
    release: `@nexu/desktop@${app.getVersion()}`,
    beforeSend(event) {
      const testTitle =
        typeof event.tags?.["nexu.test_title"] === "string"
          ? event.tags["nexu.test_title"]
          : typeof event.extra?.["nexu.test_title"] === "string"
            ? event.extra["nexu.test_title"]
            : null;

      if (!testTitle) {
        return event;
      }

      return {
        ...event,
        message: testTitle,
        fingerprint: [testTitle],
      };
    },
  });
} else {
  crashReporter.start({
    companyName: "Nexu",
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

let mainWindow: BrowserWindow | null = null;
let catalogMgr: CatalogManager | null = null;
let diagnosticsReporter: DesktopDiagnosticsReporter | null = null;

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

function notifyDesktopAuthSessionRestored(): void {
  mainWindow?.webContents.send("host:desktop-command", {
    type: "desktop:auth-session-restored",
    surface: "web",
  });
}

function installApplicationMenu(): void {
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

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? ([{ role: "appMenu" }] satisfies MenuItemConstructorOptions[])
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    developMenu,
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getDesktopLogFilePath(name: string): string {
  return resolve(app.getPath("logs"), name);
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

function logAuthRecovery(message: string, stream: "stdout" | "stderr"): void {
  writeDesktopMainLog({
    source: "auth-recovery",
    stream,
    kind: "lifecycle",
    message,
    logFilePath: getDesktopLogFilePath("desktop-main.log"),
    windowId: getMainWindowId(),
  });
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

async function waitForApiReadiness(): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = 15_000;
  const probeUrl = new URL("/api/auth/get-session", runtimeConfig.urls.apiBase);

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(probeUrl, {
        headers: {
          Accept: "application/json",
        },
      });

      if (response.status < 500) {
        logColdStart(
          `api ready via ${probeUrl.pathname} status=${response.status}`,
        );
        return;
      }
    } catch {
      // Ignore transient startup failures while the socket and DB warm up.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`API readiness probe timed out for ${probeUrl.toString()}`);
}

async function runDesktopColdStart(): Promise<void> {
  diagnosticsReporter?.markColdStartRunning("starting pglite");
  logColdStart("starting pglite");
  await orchestrator.startOne("pglite");

  diagnosticsReporter?.markColdStartRunning("starting api");
  logColdStart("starting api");
  await orchestrator.startOne("api");

  diagnosticsReporter?.markColdStartRunning("waiting for api readiness");
  logColdStart("waiting for api readiness");
  await waitForApiReadiness();

  diagnosticsReporter?.markColdStartRunning(
    "bootstrapping desktop auth session",
  );
  logColdStart("bootstrapping desktop auth session");
  await ensureDesktopAuthSession();
  const sessionId = rotateDesktopLogSession();
  logColdStart(`desktop auth session ready sessionId=${sessionId}`);

  diagnosticsReporter?.markColdStartRunning("starting web");
  logColdStart("starting web");
  await orchestrator.startOne("web");

  diagnosticsReporter?.markColdStartRunning("starting gateway");
  logColdStart("starting gateway");
  await orchestrator.startOne("gateway");

  logColdStart("cold start complete");
  diagnosticsReporter?.markColdStartSucceeded();
}

let authRecoveryPromise: Promise<void> | null = null;

function triggerDesktopAuthRecovery(reason: string): void {
  if (authRecoveryPromise) {
    return;
  }

  authRecoveryPromise = (async () => {
    logAuthRecovery(reason, "stdout");

    try {
      await ensureDesktopAuthSession({ force: true });
      const sessionId = rotateDesktopLogSession();
      logAuthRecovery(
        `desktop auth session restored sessionId=${sessionId}`,
        "stdout",
      );
      notifyDesktopAuthSessionRestored();
    } catch (error) {
      logAuthRecovery(
        error instanceof Error ? error.message : String(error),
        "stderr",
      );
    } finally {
      authRecoveryPromise = null;
    }
  })();
}

function installDesktopAuthRecoveryHooks(): void {
  session.defaultSession.webRequest.onCompleted(
    {
      urls: [`${runtimeConfig.urls.apiBase}/api/auth/*`],
    },
    (details) => {
      if (
        details.method === "POST" &&
        details.statusCode < 400 &&
        details.url.includes("/api/auth/sign-out")
      ) {
        triggerDesktopAuthRecovery("detected desktop sign-out");
      }
    },
  );
}

function focusMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  focusMainWindow();
});

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#0B1020",
    title: "Nexu Desktop",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Per-webContents handler is set globally via app.on('web-contents-created')
  // so we don't need one here on the main window.

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
    window.show();
    focusMainWindow();
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  void window.loadFile(resolve(__dirname, "../../dist/index.html"));
  mainWindow = window;
  return window;
}

// Intercept window.open() in ALL webContents (main window + webviews) and open
// the URL in the user's default system browser instead.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      setImmediate(() => {
        void shell.openExternal(url);
      });
    }
    return { action: "deny" };
  });
});

app.whenReady().then(async () => {
  installApplicationMenu();
  installDesktopAuthRecoveryHooks();
  registerIpcHandlers(orchestrator, runtimeConfig);
  diagnosticsReporter = new DesktopDiagnosticsReporter(orchestrator);
  const unsubscribeDiagnostics = diagnosticsReporter.start();

  void (async () => {
    const healthCheck = new StartupHealthCheck();
    const health = healthCheck.check();

    if (!health.healthy) {
      logColdStart(
        `unhealthy: ${health.consecutiveFailures} consecutive cold-start failures`,
      );
    }

    try {
      await runDesktopColdStart();
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
    }

    catalogMgr = new CatalogManager(app.getPath("userData"));
    setCatalogManager(catalogMgr);
    catalogMgr.start();

    const win = createMainWindow();

    if (app.isPackaged) {
      const updateMgr = new UpdateManager(win, orchestrator, {
        feedUrl: runtimeConfig.urls.updateFeed,
      });
      setUpdateManager(updateMgr);
      updateMgr.startPeriodicCheck();
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  catalogMgr?.dispose();
  void diagnosticsReporter?.flushNow().catch(() => undefined);
  flushRuntimeLoggers();
  void orchestrator.dispose();
});
