import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/electron/main";
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  Tray,
  app,
  crashReporter,
  dialog,
  globalShortcut,
  nativeImage,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  session,
  shell,
} from "electron";
import { getOpenclawSkillsDir } from "../shared/desktop-paths";
import type {
  DesktopChromeMode,
  DesktopSurface,
  HostDesktopCommand,
} from "../shared/host";
import { buildChildProcessProxyEnv } from "../shared/proxy-config";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { getDesktopSentryBuildMetadata } from "../shared/sentry-build-metadata";
import {
  shouldEnableDesktopUpdateManager,
  shouldStartDesktopPeriodicUpdateChecks,
} from "../shared/update-policy";
import { getDesktopAppRoot, getWorkspaceRoot } from "../shared/workspace-paths";
import { DesktopDiagnosticsReporter } from "./desktop-diagnostics";
import { exportDiagnostics } from "./diagnostics-export";
import {
  registerIpcHandlers,
  setComponentUpdater,
  setQuitFallback,
  setQuitHandlerOpts,
  setUpdateManager,
} from "./ipc";
import { getDesktopRuntimePlatformAdapter } from "./platforms";
import { resolveLaunchdPaths } from "./platforms/mac/launchd-paths";
import type { PrepareForUpdateInstallArgs } from "./platforms/types";
import { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import {
  buildSkillNodePath,
  checkOpenclawExtractionNeeded,
  createRuntimeUnitManifests,
  extractOpenclawSidecarAsync,
} from "./runtime/manifests";
import {
  type PortAllocation,
  PortAllocationError,
  allocateDesktopRuntimePorts,
} from "./runtime/port-allocation";
import {
  flushRuntimeLoggers,
  rotateDesktopLogSession,
  writeDesktopMainLog,
} from "./runtime/runtime-logger";
import {
  type LaunchdBootstrapResult,
  SERVICE_LABELS,
  bootstrapWithLaunchd,
  getDefaultPlistDir,
  getLogDir,
  installLaunchdQuitHandler,
  runTeardownAndExit,
  teardownLaunchdServices,
} from "./services";
import {
  type DesktopShellPreferences,
  applyDesktopShellPreferencesOnStartup,
  getDesktopShellPreferences,
  setDesktopShellPreferencesRuntimeHandler,
} from "./services/desktop-shell-preferences";
import {
  startDesktopDevInspectServer,
  stopDesktopDevInspectServer,
} from "./services/dev-inspect-server";
import { isLaunchdBootstrapEnabled } from "./services/launchd-bootstrap";
import { ProxyManager } from "./services/proxy-manager";
import { flushV8CoverageIfEnabled } from "./services/v8-coverage";
import { readPendingWindowsUserDataMigration } from "./services/windows-user-data-migration";
import { SleepGuard, type SleepGuardLogEntry } from "./sleep-guard";
import { ComponentUpdater } from "./updater/component-updater";
import { StartupHealthCheck } from "./updater/rollback";
import { UpdateManager } from "./updater/update-manager";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
const baseRuntimeConfig = getDesktopRuntimeConfig(process.env, {
  appVersion: app.getVersion(),
  resourcesPath: app.isPackaged ? electronRoot : undefined,
  useBuildConfig: app.isPackaged,
});
const runtimePlatformAdapter =
  getDesktopRuntimePlatformAdapter(baseRuntimeConfig);
const useExternalRuntime = baseRuntimeConfig.runtimeMode === "external";
// In launchd mode, skip port probing — the bootstrap has its own port
// recovery via runtime-ports.json and handles leftover processes gracefully.
// Probing here would waste time and the results get overridden by attach anyway.
const useLaunchdMode = !useExternalRuntime && isLaunchdBootstrapEnabled();
const runtimeLifecycle = runtimePlatformAdapter.lifecycle;
const { allocations: runtimePortAllocations, runtimeConfig } =
  useLaunchdMode || useExternalRuntime
    ? {
        allocations: [] as PortAllocation[],
        runtimeConfig: baseRuntimeConfig,
      }
    : await allocateDesktopRuntimePorts(process.env, baseRuntimeConfig).catch(
        (error: unknown) => {
          if (error instanceof PortAllocationError) {
            throw new Error(
              `[desktop:ports] ${error.code} purpose=${error.purpose} ` +
                `preferredPort=${error.preferredPort ?? "n/a"} ${error.message}`,
            );
          }

          throw error;
        },
      );

const pendingUserDataMigration =
  app.isPackaged && process.platform === "win32"
    ? readPendingWindowsUserDataMigration()
    : null;
const runtimeRoots = runtimePlatformAdapter.capabilities.resolveRuntimeRoots({
  app,
  electronRoot,
  runtimeConfig,
});
if (!useLaunchdMode) {
  runtimePlatformAdapter.capabilities.stateMigrationPolicy.run({
    runtimeConfig,
    runtimeRoots,
    isPackaged: app.isPackaged,
    pendingUserDataMigration,
    log: (message) => {
      writeDesktopMainLog({
        source: "state-migration",
        stream: "system",
        kind: "lifecycle",
        message,
        logFilePath: resolve(
          app.getPath("userData"),
          "logs",
          "desktop-main.log",
        ),
      });
    },
  });
}

const needsSetupExtraction = checkOpenclawExtractionNeeded(
  electronRoot,
  app.getPath("userData"),
  app.isPackaged,
);

// Set env var BEFORE window creation so the preload can read it for bootstrap data.
if (needsSetupExtraction) {
  process.env.NEXU_NEEDS_SETUP_ANIMATION = "1";
}

const runtimeUnitManifests = createRuntimeUnitManifests(
  electronRoot,
  app.getPath("userData"),
  app.isPackaged,
  runtimeConfig,
);
const orchestrator = new RuntimeOrchestrator(runtimeUnitManifests);

// Disable Chromium's popup blocker.  window.open() inside webviews can lose
// "transient user activation" after async work (fetch → response → open),
// causing silent popup blocking.  All popups are already caught by
// setWindowOpenHandler and redirected to shell.openExternal, so this is safe.
app.commandLine.appendSwitch("disable-popup-blocking");

// Keep the renderer running at full speed when backgrounded — without
// these, Chromium pauses the setup-animation video the moment the user
// switches to another app, making the cold-start hand-off look broken.
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const sentryDsn = runtimeConfig.sentryDsn;
const embeddedWorkspaceTransparentCss = `
  html,
  body,
  #root {
    background: transparent !important;
    background-color: transparent !important;
  }
`;
const desktopDevInspectHost =
  process.env.NEXU_DESKTOP_DEV_INSPECT_HOST ?? "127.0.0.1";
const desktopDevInspectPort = Number.parseInt(
  process.env.NEXU_DESKTOP_DEV_INSPECT_PORT ?? "5181",
  10,
);
const desktopDevInspectToken =
  process.env.NEXU_DESKTOP_DEV_INSPECT_TOKEN ?? null;
const desktopDevServerUrl = process.env.NEXU_DESKTOP_DEV_SERVER_URL ?? null;

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

let mainWindow: BrowserWindow | null = null;
let residentTray: Tray | null = null;
let launchdQuitOptsForResidentEntry:
  | Parameters<typeof installLaunchdQuitHandler>[0]
  | null = null;
let diagnosticsReporter: DesktopDiagnosticsReporter | null = null;
let systemTray: Tray | null = null;
let pendingMacResidentEntryPreferences: DesktopShellPreferences | null = null;

function isZhLocale(): boolean {
  return app.getLocale().toLowerCase().startsWith("zh");
}

function getWindowsTrayStrings(): {
  show: string;
  hide: string;
  quit: string;
} {
  if (isZhLocale()) {
    return {
      show: "显示 Nexu",
      hide: "隐藏 Nexu",
      quit: "退出 Nexu",
    };
  }

  return {
    show: "Show Nexu",
    hide: "Hide Nexu",
    quit: "Quit Nexu",
  };
}

function resolveWindowsTrayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "tray-icon.ico")
    : resolve(getDesktopAppRoot(), "build", "icon.ico");
}

function isForceQuitInProgress(): boolean {
  return Boolean((app as unknown as Record<string, unknown>).__nexuForceQuit);
}

function markForceQuitInProgress(): void {
  (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
}

/** True if this is the x86_64 build running under Rosetta 2 on Apple Silicon. */
function isRunningUnderRosetta(): boolean {
  if (process.platform !== "darwin") return false;
  if (process.arch !== "x64") return false;
  try {
    const out = execFileSync(
      "/usr/sbin/sysctl",
      ["-n", "sysctl.proc_translated"],
      {
        encoding: "utf8",
        timeout: 1000,
      },
    ).trim();
    return out === "1";
  } catch {
    return false;
  }
}

/**
 * Resolve the latest arm64 dmg URL from the same update feed (channel) the
 * user is currently on, so the link mirrors what auto-update would install.
 * Reads runtimeConfig (not process.env) because packaged builds bake the
 * channel + feed URL into build-config.json, not live env vars.
 */
async function resolveLatestArm64DownloadUrl(): Promise<string> {
  const R2_BASE = "https://desktop-releases.nexu.io";
  const channel = runtimeConfig.updates.channel ?? "stable";

  let baseUrl = `${R2_BASE}/${channel}/arm64`;
  const feedOverride = runtimeConfig.urls.updateFeed;
  if (feedOverride) {
    try {
      const u = new URL(feedOverride);
      const trimmed = u.pathname.replace(/\/+$/, "");
      const swapped = trimmed.replace(/\/x64$/, "/arm64");
      u.pathname = swapped.endsWith("/arm64") ? swapped : `${swapped}/arm64`;
      u.search = "";
      u.hash = "";
      baseUrl = u.toString().replace(/\/+$/, "");
    } catch {}
  }

  const ymlUrl = `${baseUrl}/latest-mac.yml`;
  try {
    const res = await fetch(ymlUrl, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      // electron-builder latest-mac.yml lists both .zip (for delta updates)
      // and .dmg under `files:`. We want the dmg.
      const match = (await res.text()).match(/url:\s*(\S+\.dmg)/);
      if (match?.[1]) return `${baseUrl}/${match[1]}`;
    }
  } catch {}
  return ymlUrl;
}

/**
 * Block startup with a warning if the Intel build is running on Apple
 * Silicon under Rosetta 2 — the symptoms (slow startup, high CPU, sidecar
 * native bindings failing to load) give users no hint of the root cause.
 * Skipped in dev and skippable via NEXU_SKIP_ARCH_WARNING=1.
 */
async function warnIfRunningUnderRosetta(): Promise<void> {
  if (!app.isPackaged) return;
  if (process.env.NEXU_SKIP_ARCH_WARNING === "1") return;
  if (!isRunningUnderRosetta()) return;

  const downloadUrl = await resolveLatestArm64DownloadUrl();
  const isZh = app.getLocale().toLowerCase().startsWith("zh");
  const messageBox = isZh
    ? {
        title: "检测到架构不匹配",
        message: "正在 Apple Silicon Mac 上运行 Intel 版 Nexu",
        detail:
          "macOS 通过 Rosetta 2 翻译运行 Intel 版本，会导致：\n• 启动比正常慢 3-5 倍\n• 界面卡顿、CPU 占用过高\n• 部分原生模块可能加载失败\n\n请下载 Apple Silicon (arm64) 版本以获得最佳体验。",
        // Trailing space on the default-button label is a workaround for
        // electron/electron#40466 — non-standard button labels otherwise do
        // not get the macOS blue default-button highlight. The "(推荐)"
        // suffix is a textual fallback so the recommended action is still
        // obvious if the visual highlight ever stops working.
        downloadButton: "下载 arm64 版本（推荐） ",
        continueButton: "继续运行",
      }
    : {
        title: "Architecture mismatch detected",
        message: "Running the Intel build of Nexu on an Apple Silicon Mac",
        detail:
          "macOS is running this build through Rosetta 2 translation, which causes:\n• 3-5x slower startup\n• Laggy UI and high CPU usage\n• Possible native module load failures\n\nPlease download the Apple Silicon (arm64) build for the best experience.",
        downloadButton: "Download arm64 build (recommended) ",
        continueButton: "Continue anyway",
      };

  const result = await dialog.showMessageBox({
    type: "warning",
    title: messageBox.title,
    message: messageBox.message,
    detail: messageBox.detail,
    buttons: [messageBox.downloadButton, messageBox.continueButton],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (result.response === 0) {
    void shell.openExternal(downloadUrl);
    app.exit(0);
  }
}

/**
 * Controls whether the Develop menu is visible. In local dev it starts enabled
 * so the menu matches today's default behavior, but the same shortcut can
 * still toggle it for validation. In packaged builds it starts disabled.
 */
let productionDebugMode = !app.isPackaged;
let sleepGuard: SleepGuard | null = null;
let launchdResult: LaunchdBootstrapResult | null = null;
let proxyManager: ProxyManager | null = null;

async function refreshProxyDiagnostics(): Promise<void> {
  if (!proxyManager) {
    return;
  }
  const targets = [
    { label: "controller", url: runtimeConfig.urls.controllerBase },
    { label: "openclaw", url: runtimeConfig.urls.openclawBase },
    { label: "external", url: "https://nexu.io" },
  ];
  const snapshot = await proxyManager.collectDiagnostics(
    runtimeConfig.proxy,
    targets,
  );
  diagnosticsReporter?.setProxySnapshot(snapshot);
}

// ---------------------------------------------------------------------------
// Unified graceful shutdown — single authoritative teardown path.
// Called by: before-quit, SIGTERM, SIGINT, quit-handler, system shutdown.
// Idempotent: safe to call multiple times (second call is a no-op).
// ---------------------------------------------------------------------------

let shutdownInProgress = false;
const SHUTDOWN_HARD_TIMEOUT_MS = 8_000;

async function gracefulShutdown(reason: string): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  writeDesktopMainLog({
    source: "shutdown",
    stream: "system",
    kind: "lifecycle",
    message: `graceful shutdown started: ${reason}`,
    logFilePath: null,
    windowId: null,
  });

  // Hard timeout: if teardown hangs, force exit after 8 seconds.
  const hardTimer = setTimeout(() => {
    writeDesktopMainLog({
      source: "shutdown",
      stream: "system",
      kind: "lifecycle",
      message: `graceful shutdown hard timeout (${SHUTDOWN_HARD_TIMEOUT_MS}ms), forcing exit`,
      logFilePath: null,
      windowId: null,
    });
    process.exit(1);
  }, SHUTDOWN_HARD_TIMEOUT_MS);

  try {
    sleepGuard?.dispose(reason);
    await diagnosticsReporter?.flushNow().catch(() => undefined);
    flushRuntimeLoggers();
    flushV8CoverageIfEnabled();

    if (launchdResult) {
      await teardownLaunchdServices({
        launchd: launchdResult.launchd,
        labels: launchdResult.labels,
        plistDir: getDefaultPlistDir(!app.isPackaged),
      });
    }

    await orchestrator.dispose().catch(() => undefined);
  } finally {
    clearTimeout(hardTimer);
  }
}

// Cold-start gate: IPC handler for `env:get-runtime-config` waits for this
// promise to resolve before returning, ensuring the renderer always gets the
// final config with correct ports (not the pre-cold-start defaults).
let resolveColdStartReady: () => void;
const coldStartReady = new Promise<void>((r) => {
  resolveColdStartReady = r;
});

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

function sendHostDesktopCommand(command: HostDesktopCommand): void {
  mainWindow?.webContents.send("host:desktop-command", command);
}

function showAboutDialog(): void {
  const version = app.getVersion();
  const detailLines = [
    `Version ${version}`,
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node ${process.versions.node}`,
  ];
  const options = {
    type: "info" as const,
    title: "About Nexu",
    message: "Nexu",
    detail: detailLines.join("\n"),
    buttons: ["OK"],
    noLink: true,
  };
  void (mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options));
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
      { type: "separator" },
      {
        label: "Set Test Balance…",
        click: () =>
          sendHostDesktopCommand({ type: "develop:open-set-balance" }),
      },
    ],
  };

  const helpSubmenu: MenuItemConstructorOptions[] = [
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
  ];

  // On macOS About/Check-for-Updates live in the application menu by
  // platform convention. On Windows/Linux there is no app menu, so surface
  // them in Help instead (issue nexu-io/nexu#784).
  if (process.platform !== "darwin") {
    helpSubmenu.push(
      { type: "separator" },
      {
        id: "about-nexu",
        label: `About Nexu (v${app.getVersion()})`,
        click: () => showAboutDialog(),
      },
    );
  }

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: helpSubmenu,
  };

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? ([
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
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
    {
      label: "View",
      submenu: [
        // Reload shortcuts are dev-only — in production they expose
        // internal "starting local service" screens (see #399).
        // They can be unlocked at runtime via Cmd/Ctrl+Shift+Alt+D.
        ...(productionDebugMode
          ? ([
              { role: "reload" },
              { role: "forceReload" },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    ...(productionDebugMode ? [developMenu] : []),
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

async function runDesktopColdStart(): Promise<void> {
  diagnosticsReporter?.markColdStartRunning("starting controller");
  logColdStart("starting controller");
  await orchestrator.startOne("controller");

  diagnosticsReporter?.markColdStartRunning("waiting for controller readiness");
  logColdStart("waiting for controller readiness");
  await waitForControllerReadiness();

  diagnosticsReporter?.markColdStartRunning("starting web");
  logColdStart("starting web");
  await orchestrator.startOne("web");

  const sessionId = rotateDesktopLogSession();
  logColdStart(`cold start session ready sessionId=${sessionId}`);

  logColdStart("cold start complete");
  diagnosticsReporter?.markColdStartSucceeded();
}

async function runLaunchdColdStart(): Promise<void> {
  diagnosticsReporter?.markColdStartRunning("launchd bootstrap");
  logColdStart("starting launchd bootstrap");

  const isDev = !app.isPackaged;
  const paths = await resolveLaunchdPaths(
    app.isPackaged,
    electronRoot,
    app.getVersion(),
  );

  const nexuHome = runtimeConfig.paths.nexuHome.replace(
    /^~/,
    process.env.HOME ?? "",
  );
  const runtimeRoots = runtimePlatformAdapter.capabilities.resolveRuntimeRoots({
    app,
    electronRoot,
    runtimeConfig,
  });

  const { openclawRuntimeRoot, openclawStateDir, openclawConfigPath } =
    runtimeRoots;

  runtimePlatformAdapter.capabilities.stateMigrationPolicy.run({
    runtimeConfig,
    runtimeRoots,
    isPackaged: app.isPackaged,
    pendingUserDataMigration: null,
    log: (message) => logColdStart(`state-migration: ${message}`),
  });

  // In dev mode, serve web app from apps/web/dist
  // In packaged mode, serve from resources/web
  const webRoot = isDev
    ? resolve(getWorkspaceRoot(), "apps", "web", "dist")
    : resolve(electronRoot, "runtime", "web", "dist");

  const repoRoot = getWorkspaceRoot();
  const userDataPath = app.getPath("userData");
  const openclawSkillsDir = getOpenclawSkillsDir(userDataPath);
  const openclawTmpDir = resolve(openclawRuntimeRoot, "tmp");
  const openclawBinPath =
    process.env.NEXU_OPENCLAW_BIN ?? paths.openclawBinPath;
  const openclawExtensionsDir = paths.openclawExtensionsDir;
  const skillhubStaticSkillsDir = app.isPackaged
    ? resolve(electronRoot, "static/bundled-skills")
    : resolve(repoRoot, "apps/desktop/static/bundled-skills");
  const platformTemplatesDir = app.isPackaged
    ? resolve(electronRoot, "static/platform-templates")
    : resolve(repoRoot, "apps/controller/static/platform-templates");
  const skillNodePath = buildSkillNodePath(electronRoot, app.isPackaged);
  const proxyEnv = buildChildProcessProxyEnv(runtimeConfig.proxy);

  launchdResult = await bootstrapWithLaunchd({
    isDev,
    controllerPort: runtimeConfig.ports.controller,
    openclawPort: Number(
      new URL(runtimeConfig.urls.openclawBase).port || 18789,
    ),
    nexuHome,
    gatewayToken: isDev ? undefined : runtimeConfig.tokens.gateway,
    webPort: runtimeConfig.ports.web,
    webRoot,
    plistDir: getDefaultPlistDir(isDev),
    ...paths,
    openclawConfigPath,
    openclawStateDir,
    // Controller-specific env vars
    webUrl: runtimeConfig.urls.web,
    openclawSkillsDir,
    skillhubStaticSkillsDir,
    platformTemplatesDir,
    openclawBinPath,
    openclawExtensionsDir,
    skillNodePath,
    openclawTmpDir,
    proxyEnv,
    posthogApiKey:
      process.env.POSTHOG_API_KEY ?? runtimeConfig.posthogApiKey ?? undefined,
    posthogHost:
      process.env.POSTHOG_HOST ?? runtimeConfig.posthogHost ?? undefined,
    langfusePublicKey:
      process.env.LANGFUSE_PUBLIC_KEY ??
      runtimeConfig.langfusePublicKey ??
      undefined,
    langfuseSecretKey:
      process.env.LANGFUSE_SECRET_KEY ??
      runtimeConfig.langfuseSecretKey ??
      undefined,
    langfuseBaseUrl:
      process.env.LANGFUSE_BASE_URL ??
      runtimeConfig.langfuseBaseUrl ??
      undefined,
    log: (message: string) => logColdStart(message),
    nodeV8Coverage: process.env.NODE_V8_COVERAGE,
    desktopE2ECoverage: process.env.NEXU_DESKTOP_E2E_COVERAGE,
    desktopE2ECoverageRunId: process.env.NEXU_DESKTOP_E2E_COVERAGE_RUN_ID,
    appVersion: app.getVersion(),
    userDataPath: app.getPath("userData"),
    buildSource:
      process.env.NEXU_DESKTOP_BUILD_SOURCE ??
      (app.isPackaged ? "packaged" : "local-dev"),
  });

  // Wire launchd-managed units into the orchestrator so the control plane
  // shows correct status, and Start/Stop buttons work via launchd.
  const launchdLogDir = getLogDir(isDev ? nexuHome : undefined);
  orchestrator.enableLaunchdMode(
    launchdResult.launchd,
    {
      controller: SERVICE_LABELS.controller(isDev),
      openclaw: SERVICE_LABELS.openclaw(isDev),
    },
    launchdLogDir,
  );

  // Always sync runtimeConfig with actual effective ports — these may differ
  // from the initial config if ports were recovered from a previous session or
  // OS-assigned due to conflicts.
  const { controllerPort, openclawPort, webPort } =
    launchdResult.effectivePorts;
  runtimeConfig.ports.controller = controllerPort;
  runtimeConfig.ports.web = webPort;
  runtimeConfig.urls.controllerBase = `http://127.0.0.1:${controllerPort}`;
  runtimeConfig.urls.web = `http://127.0.0.1:${webPort}`;
  runtimeConfig.urls.openclawBase = `http://127.0.0.1:${openclawPort}`;

  if (launchdResult.isAttach) {
    logColdStart(
      `attached to running services (controller=${controllerPort} openclaw=${openclawPort} web=${webPort})`,
    );
  } else {
    logColdStart("launchd services started, waiting for controller readiness");
    diagnosticsReporter?.markColdStartRunning(
      "waiting for controller readiness",
    );
  }

  const controllerReady = await launchdResult.controllerReady;
  if (!controllerReady.ok) {
    throw controllerReady.error;
  }
  if (!launchdResult.isAttach) {
    logColdStart("controller ready");
  }

  const sessionId = rotateDesktopLogSession();
  logColdStart(`launchd cold start complete sessionId=${sessionId}`);
  diagnosticsReporter?.markColdStartSucceeded();
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

function shouldUseResidentEntry(preferences: DesktopShellPreferences): boolean {
  if (process.platform === "darwin") {
    return true;
  }

  return !preferences.showInDock;
}

function resolveTrayIconPath(): string | null {
  const candidate =
    process.platform === "darwin"
      ? app.isPackaged
        ? join(process.resourcesPath, "tray-icon-mac.png")
        : resolve(getDesktopAppRoot(), "build", "tray-icon-mac.png")
      : resolve(
          app.isPackaged ? process.resourcesPath : getDesktopAppRoot(),
          "build",
          process.platform === "win32" ? "icon.ico" : "icon.png",
        );

  return existsSync(candidate) ? candidate : null;
}

function hideMainWindowToBackground(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
}

function hideMainWindowToTray(): void {
  hideMainWindowToBackground();
}

function updateSystemTrayMenu(): void {
  if (!systemTray) {
    return;
  }

  const trayStrings = getWindowsTrayStrings();

  const isVisible = Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
  );

  systemTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isVisible ? trayStrings.hide : trayStrings.show,
        click: () => {
          if (isVisible) {
            hideMainWindowToBackground();
            return;
          }

          showMainWindowFromResidentEntry();
        },
      },
      { type: "separator" },
      {
        label: trayStrings.quit,
        click: () => {
          markForceQuitInProgress();
          app.quit();
        },
      },
    ]),
  );
}

function showSystemTrayMenu(): void {
  if (!systemTray) {
    return;
  }

  updateSystemTrayMenu();
  systemTray.popUpContextMenu();
}

function showMainWindowFromResidentEntry(): void {
  const preferences = getDesktopShellPreferences();

  if (process.platform === "darwin" && preferences.showInDock) {
    void app.dock?.show();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  focusMainWindow();
}

function destroyResidentTray(): void {
  residentTray?.destroy();
  residentTray = null;
}

function showResidentTrayMenu(): void {
  if (!residentTray) {
    return;
  }

  residentTray.popUpContextMenu();
}

function ensureResidentTray(): void {
  if (residentTray) {
    return;
  }

  const trayIconPath = resolveTrayIconPath();
  if (!trayIconPath) {
    return;
  }

  let trayIcon = nativeImage.createFromPath(trayIconPath);
  if (trayIcon.isEmpty()) {
    return;
  }

  if (process.platform === "darwin") {
    trayIcon = trayIcon.resize({ height: 18 });
    trayIcon.setTemplateImage(true);
  }

  const tray = new Tray(trayIcon);
  residentTray = tray;
  tray.setToolTip("nexu");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open nexu",
        click: () => {
          showMainWindowFromResidentEntry();
        },
      },
      {
        label: "Quit",
        click: () => {
          if (app.isPackaged && launchdQuitOptsForResidentEntry) {
            void runTeardownAndExit(
              launchdQuitOptsForResidentEntry,
              "tray-quit",
            );
            return;
          }

          markForceQuitInProgress();
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    showResidentTrayMenu();
  });
  tray.on("right-click", () => {
    showResidentTrayMenu();
  });
}

async function ensureWindowsTray(): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged || systemTray) {
    return;
  }

  const trayIconPath = resolveWindowsTrayIconPath();
  const trayIcon = nativeImage.createFromPath(trayIconPath);

  if (!trayIcon || trayIcon.isEmpty()) {
    return;
  }

  systemTray = new Tray(trayIcon);
  systemTray.setToolTip("Nexu");
  updateSystemTrayMenu();

  systemTray.on("click", () => {
    showSystemTrayMenu();
  });

  systemTray.on("right-click", () => {
    showSystemTrayMenu();
  });
}

function applyResidentEntryPreferences(
  preferences: DesktopShellPreferences,
): void {
  if (process.platform === "darwin") {
    const window = mainWindow;
    if (window && !window.isDestroyed() && window.isFullScreen()) {
      pendingMacResidentEntryPreferences = preferences;
      window.setFullScreen(false);
      return;
    }

    pendingMacResidentEntryPreferences = null;
    app.setActivationPolicy(preferences.showInDock ? "regular" : "accessory");
    if (preferences.showInDock) {
      void app.dock?.show();
    } else {
      app.dock?.hide();
    }
  }

  if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSkipTaskbar(!preferences.showInDock);
  }

  if (process.platform !== "win32" && shouldUseResidentEntry(preferences)) {
    ensureResidentTray();
  } else {
    destroyResidentTray();
  }
}

function shouldHideOnWindowClose(): boolean {
  if (!app.isPackaged) {
    return false;
  }

  if (process.platform === "darwin") {
    return true;
  }

  if (process.platform === "win32") {
    return systemTray !== null;
  }

  return shouldUseResidentEntry(getDesktopShellPreferences());
}
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  showMainWindowFromResidentEntry();
  focusMainWindow();
});

app.on("before-quit", () => {
  void stopDesktopDevInspectServer();
});

function createMainWindow(): BrowserWindow {
  logLaunchTimeline("main window creation requested");
  const isMacOS = process.platform === "darwin";
  const shellPreferences = getDesktopShellPreferences();
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: needsSetupExtraction ? 1280 : 1120,
    minHeight: 720,
    backgroundColor: isMacOS ? "#00000000" : "#0B1020",
    title: "nexu",
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
      // Window-level backup for the disable-renderer-backgrounding flag.
      backgroundThrottling: false,
    },
  });

  if (process.platform === "win32") {
    window.setSkipTaskbar(!shellPreferences.showInDock);
  }

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
      diagnosticsReporter?.recordStartupProbe({
        source: "main",
        stage: "main:renderer-did-fail-load",
        status: "error",
        detail: `${errorCode} ${errorDescription} ${validatedUrl}`,
      });
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
    diagnosticsReporter?.recordStartupProbe({
      source: "main",
      stage: "main:renderer-did-finish-load",
      status: "ok",
      detail: window.webContents.getURL(),
    });
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
    diagnosticsReporter?.recordStartupProbe({
      source: "main",
      stage: "main:renderer-process-gone",
      status: "error",
      detail: `reason=${details.reason} exitCode=${details.exitCode}`,
    });
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
    diagnosticsReporter?.recordStartupProbe({
      source: "main",
      stage: "main:window-ready-to-show",
      status: "ok",
      detail: window.webContents.getURL(),
    });
    logLaunchTimeline("main window ready-to-show");
    if (isMacOS && !needsSetupExtraction) {
      // Only apply vibrancy after ready-to-show when NOT in setup mode.
      // During setup, vibrancy is applied after the animation finishes
      // to avoid the transparent background showing through the video.
      window.setBackgroundColor("#00000000");
      window.setVibrancy("sidebar");
    }
    if (!window.isVisible()) {
      window.show();
      focusMainWindow();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }

    updateSystemTrayMenu();
  });

  window.on("close", (event) => {
    if (process.platform !== "win32" || !app.isPackaged) {
      return;
    }

    if (!systemTray) {
      return;
    }

    if (isForceQuitInProgress()) {
      return;
    }

    event.preventDefault();
    hideMainWindowToTray();
  });

  window.on("show", () => {
    updateSystemTrayMenu();
  });

  window.on("hide", () => {
    updateSystemTrayMenu();
  });

  window.on("leave-full-screen", () => {
    if (mainWindow !== window || !pendingMacResidentEntryPreferences) {
      return;
    }

    const pendingPreferences = pendingMacResidentEntryPreferences;
    pendingMacResidentEntryPreferences = null;
    applyResidentEntryPreferences(pendingPreferences);
  });

  window.on("close", (event) => {
    if ((app as unknown as Record<string, unknown>).__nexuForceQuit) {
      return;
    }

    if (!launchdResult && shouldHideOnWindowClose()) {
      event.preventDefault();
      hideMainWindowToBackground();
    }
  });

  // During first install / post-update, show the window IMMEDIATELY with a
  // white background — before loadFile, before React, before anything.
  // This eliminates the 10-20s blank screen while the Electron main process
  // is doing sidecar extraction / launchd bootstrap in the background.
  // The white background matches the animation overlay seamlessly.
  if (needsSetupExtraction) {
    logLaunchTimeline("setup animation: showing window immediately");
    window.setBackgroundColor("#ffffff");
    window.show();
    focusMainWindow();
  }

  const desktopRendererEntryPath = resolve(__dirname, "../../dist/index.html");
  const desktopRendererTarget =
    !app.isPackaged && desktopDevServerUrl
      ? desktopDevServerUrl
      : desktopRendererEntryPath;

  if (!app.isPackaged && desktopDevServerUrl) {
    void window.loadURL(desktopDevServerUrl);
  } else {
    void window.loadFile(desktopRendererEntryPath);
  }
  diagnosticsReporter?.recordStartupProbe({
    source: "main",
    stage: "main:window-load-dispatched",
    status: "ok",
    detail: desktopRendererTarget,
  });
  logLaunchTimeline(
    !app.isPackaged && desktopDevServerUrl
      ? "main window loadURL dispatched"
      : "main window loadFile dispatched",
  );
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

  // In packaged builds, block reload shortcuts (Cmd+R, Ctrl+R, Ctrl+Shift+R,
  // F5) at the webContents level to prevent exposing internal startup screens
  // (#399). The same focused-window event path also toggles the Develop menu in
  // dev so the shortcut can be validated without a packaged build.
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    // Toggle debug mode: Cmd+Shift+Alt+D (mac) / Ctrl+Shift+Alt+D (win/linux).
    // Handled here in addition to globalShortcut so it works on Windows even
    // when system-level registration is blocked by other software.
    if (
      input.key.toLowerCase() === "d" &&
      input.shift &&
      input.alt &&
      (input.meta || input.control)
    ) {
      event.preventDefault();
      productionDebugMode = !productionDebugMode;
      installApplicationMenu();
      return;
    }
    if (!app.isPackaged || productionDebugMode) return;
    const isReload =
      (input.key.toLowerCase() === "r" && (input.meta || input.control)) ||
      input.key === "F5";
    if (isReload) {
      event.preventDefault();
    }
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

app.whenReady().then(async () => {
  logLaunchTimeline("app.whenReady resolved");
  // Short-circuit before any heavy startup if running under Rosetta.
  await warnIfRunningUnderRosetta();
  proxyManager = new ProxyManager(session.defaultSession);
  await proxyManager.applyPolicy(runtimeConfig.proxy);
  installApplicationMenu();

  // Hidden shortcut to toggle the Develop menu and packaged-only reload items.
  // Registered in both dev and packaged builds so the shortcut itself can be
  // validated locally, while before-input-event remains the Windows fallback.
  globalShortcut.register("CommandOrControl+Shift+Alt+D", () => {
    productionDebugMode = !productionDebugMode;
    installApplicationMenu();
  });
  diagnosticsReporter = new DesktopDiagnosticsReporter(orchestrator);
  await refreshProxyDiagnostics();
  diagnosticsReporter.recordStartupProbe({
    source: "main",
    stage: "main:app-when-ready",
    status: "ok",
    detail: app.getVersion(),
  });
  if (
    !app.isPackaged &&
    desktopDevInspectToken &&
    Number.isInteger(desktopDevInspectPort) &&
    desktopDevInspectPort > 0
  ) {
    try {
      await startDesktopDevInspectServer({
        host: desktopDevInspectHost,
        port: desktopDevInspectPort,
        token: desktopDevInspectToken,
      });
    } catch (error) {
      writeDesktopMainLog({
        source: "dev-inspect",
        stream: "stderr",
        kind: "app",
        message: `desktop dev inspect server failed to start host=${desktopDevInspectHost} port=${desktopDevInspectPort} error=${error instanceof Error ? error.message : String(error)}`,
        logFilePath: null,
      });
    }
  }
  setDesktopShellPreferencesRuntimeHandler((preferences) => {
    applyResidentEntryPreferences(preferences);
  });
  applyDesktopShellPreferencesOnStartup();
  registerIpcHandlers(
    orchestrator,
    runtimeConfig,
    diagnosticsReporter,
    coldStartReady,
  );
  // Provide orchestrator-mode quit fallback for app:quit IPC when launchd
  // quit handler is not available (e.g. CI, orchestrator mode).
  setQuitFallback(() =>
    gracefulShutdown("ipc-quit").finally(() => {
      (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
      app.exit(0);
    }),
  );
  const unsubscribeDiagnostics = diagnosticsReporter.start();
  sleepGuard = new SleepGuard({
    powerMonitor,
    powerSaveBlocker,
    log: logSleepGuard,
    onSnapshot: (snapshot) => {
      diagnosticsReporter?.setSleepGuardSnapshot(snapshot);
    },
  });
  const win = createMainWindow();
  await ensureWindowsTray();
  sleepGuard.start("desktop-runtime-active");

  void (async () => {
    const healthCheck = new StartupHealthCheck();
    const health = healthCheck.check();

    if (!health.healthy) {
      logColdStart(
        `unhealthy: ${health.consecutiveFailures} consecutive cold-start failures`,
      );
    }

    try {
      if (needsSetupExtraction) {
        logColdStart("starting async openclaw sidecar extraction");
        diagnosticsReporter?.markColdStartRunning(
          "extracting openclaw sidecar",
        );
        await extractOpenclawSidecarAsync(
          electronRoot,
          app.getPath("userData"),
        );
        logColdStart("openclaw sidecar extraction complete");
      }

      logColdStart(
        `bootstrap mode: ${useExternalRuntime ? "external" : useLaunchdMode ? "launchd" : "orchestrator"}`,
      );

      if (useExternalRuntime) {
        await runtimeLifecycle.coldStartOrAttach({
          app,
          electronRoot,
          runtimeConfig,
          orchestrator,
          diagnosticsReporter,
          logColdStart,
          logStartupStep: logLaunchTimeline,
          rotateDesktopLogSession,
          waitForControllerReadiness,
        });
      } else if (useLaunchdMode) {
        await runLaunchdColdStart();
      } else {
        await runDesktopColdStart();
      }
      await refreshProxyDiagnostics();
      healthCheck.recordSuccess();
    } catch (error) {
      await refreshProxyDiagnostics().catch(() => undefined);
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

    // Install launchd quit handler regardless of cold-start success/failure
    // so services can always be stopped cleanly on quit.
    if (launchdResult) {
      const quitOpts = {
        launchd: launchdResult.launchd,
        labels: launchdResult.labels,
        webServer: launchdResult.webServer,
        plistDir: getDefaultPlistDir(!app.isPackaged),
        onBeforeQuit: async () => {
          sleepGuard?.dispose("launchd-quit");
          await diagnosticsReporter?.flushNow().catch(() => undefined);
          flushRuntimeLoggers();
          flushV8CoverageIfEnabled();
        },
      };
      installLaunchdQuitHandler(quitOpts);
      setQuitHandlerOpts(quitOpts);
      launchdQuitOptsForResidentEntry = quitOpts;
    }

    const shouldEnableUpdates =
      app.isPackaged &&
      runtimeConfig.updates.autoUpdateEnabled &&
      shouldEnableDesktopUpdateManager({
        buildSource: runtimeConfig.buildInfo.source,
        updateFeed: runtimeConfig.urls.updateFeed,
      });

    if (shouldEnableUpdates) {
      const updateMgr = new UpdateManager(win, orchestrator, {
        channel: runtimeConfig.updates.channel,
        feedUrl: runtimeConfig.urls.updateFeed,
        autoDownload: true,
        initialDelayMs: process.platform === "win32" ? 30_000 : 0,
        prepareForUpdateInstall: runtimeLifecycle.prepareForUpdateInstall
          ? async (args: PrepareForUpdateInstallArgs) => {
              await runtimeLifecycle.prepareForUpdateInstall?.(args);
            }
          : undefined,
        launchd: launchdResult
          ? {
              manager: launchdResult.launchd,
              labels: launchdResult.labels,
              plistDir: getDefaultPlistDir(!app.isPackaged),
            }
          : undefined,
      });
      setUpdateManager(updateMgr);

      if (
        shouldStartDesktopPeriodicUpdateChecks({
          buildSource: runtimeConfig.buildInfo.source,
          updateFeed: runtimeConfig.urls.updateFeed,
        })
      ) {
        updateMgr.startPeriodicCheck();
      }
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
  if (process.platform !== "darwin") {
    if (shouldUseResidentEntry(getDesktopShellPreferences())) {
      return;
    }
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// Signal handlers — route to unified gracefulShutdown.
// SIGTERM: sent by launchctl stop, systemd, Docker, Activity Monitor "Quit".
// SIGINT: sent by Ctrl+C in terminal.
// ---------------------------------------------------------------------------

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void gracefulShutdown(`signal:${signal}`).finally(() => {
      (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
      app.exit(0);
    });
  });
}

// ---------------------------------------------------------------------------
// before-quit handler — uses gracefulShutdown for non-launchd mode.
// In launchd mode, quit-handler.ts intercepts window close and calls
// gracefulShutdown via teardownLaunchdServices directly.
// ---------------------------------------------------------------------------

const beforeQuitHandler = (event: Electron.Event) => {
  // If using launchd mode, the quit handler (quit-handler.ts) manages
  // the quit flow via window close dialog. This handler only does
  // lightweight cleanup.
  if (launchdResult) {
    return;
  }

  // Legacy orchestrator mode: run unified shutdown, then quit.
  event.preventDefault();
  void gracefulShutdown("before-quit").finally(() => {
    markForceQuitInProgress();
    // P1-2: Remove only this specific handler (not all before-quit listeners).
    app.removeListener("before-quit", beforeQuitHandler);
    app.quit();
  });
};

app.on("before-quit", beforeQuitHandler);
app.on("before-quit", () => {
  systemTray?.destroy();
  systemTray = null;
});
