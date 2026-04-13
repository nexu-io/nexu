import { type BrowserWindow, app, shell, webContents } from "electron";
import type {
  DesktopUpdateCapability,
  UpdateChannelName,
  UpdateCheckDiagnostic,
  UpdateSource,
} from "../../shared/host";
import type { PrepareForUpdateInstallArgs } from "../platforms/types";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
import { writeDesktopMainLog } from "../runtime/runtime-logger";
import {
  checkCriticalPathsLocked,
  ensureNexuProcessesDead,
  teardownLaunchdServices,
} from "../services/launchd-bootstrap";
import type { LaunchdManager } from "../services/launchd-manager";
import {
  MacUpdateDriver,
  resolveMacUpdateFeedUrlForTests,
} from "./mac-update-driver";
import { UnsupportedUpdateDriver } from "./unsupported-update-driver";
import type {
  PlatformUpdateDriver,
  UpdateDriverEventHandlers,
} from "./update-driver";
import { WindowsUpdateDriver } from "./windows-update-driver";

type DownloadMode = "idle" | "background" | "foreground";

export interface UpdateManagerOptions {
  source?: UpdateSource;
  channel?: UpdateChannelName;
  feedUrl?: string | null;
  platform?: NodeJS.Platform;
  autoDownload?: boolean;
  checkIntervalMs?: number;
  initialDelayMs?: number;
  /** Launchd context — required for clean service teardown before update install */
  launchd?: {
    manager: LaunchdManager;
    labels: { controller: string; openclaw: string };
    plistDir: string;
  };
  prepareForUpdateInstall?: (
    args: PrepareForUpdateInstallArgs,
  ) => Promise<void>;
}

function sanitizeFeedUrl(feedUrl: string): string {
  try {
    if (feedUrl.startsWith("github://")) {
      return feedUrl;
    }

    const url = new URL(feedUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return feedUrl;
  }
}

export function resolveUpdateFeedUrlForTests(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
  arch?: string;
}): string {
  return resolveMacUpdateFeedUrlForTests(options);
}

function createUpdateDriver(
  platform: NodeJS.Platform,
  currentVersion: string,
  autoDownload: boolean,
): PlatformUpdateDriver {
  const context = {
    currentVersion,
    autoDownload,
    openExternal: async (url: string) => {
      await shell.openExternal(url);
    },
    writeLog: (_message: string, _diagnostic: UpdateCheckDiagnostic) => {},
  };

  switch (platform) {
    case "darwin":
      return new MacUpdateDriver(context);
    case "win32":
      return new WindowsUpdateDriver(context);
    default:
      return new UnsupportedUpdateDriver(context);
  }
}

export class UpdateManager {
  private readonly win: BrowserWindow;
  private readonly orchestrator: RuntimeOrchestrator;
  private source: UpdateSource;
  private channel: UpdateChannelName;
  private readonly feedUrl: string | null;
  private readonly checkIntervalMs: number;
  private readonly initialDelayMs: number;
  private readonly launchdCtx: UpdateManagerOptions["launchd"];
  private readonly options?: UpdateManagerOptions;
  private currentFeedUrl: string;
  private readonly platform: NodeJS.Platform;
  private readonly driver: PlatformUpdateDriver;
  private readonly autoDownload: boolean;
  private downloadMode: DownloadMode = "idle";
  private pendingVersion: string | null = null;
  private pendingReleaseDate: string | undefined = undefined;
  private pendingReleaseNotes: string | undefined = undefined;
  private pendingActionUrl: string | undefined = undefined;
  private downloadComplete = false;
  private userInitiatedCheck = false;
  private checkInProgress: Promise<{ updateAvailable: boolean }> | null = null;
  private lastProgressLogAt = 0;
  private lastProgressLogPercent: number | null = null;
  private lastProgress:
    | Parameters<UpdateDriverEventHandlers["onProgress"]>[0]
    | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    win: BrowserWindow,
    orchestrator: RuntimeOrchestrator,
    options?: UpdateManagerOptions,
  ) {
    this.win = win;
    this.orchestrator = orchestrator;
    // Default to R2 - GitHub is unreliable in China and requires auth for private repos
    this.source = options?.source ?? "r2";
    this.channel = options?.channel ?? "stable";
    this.feedUrl = options?.feedUrl ?? null;
    this.checkIntervalMs = options?.checkIntervalMs ?? 15 * 60 * 1000;
    this.initialDelayMs = options?.initialDelayMs ?? 0;
    this.launchdCtx = options?.launchd;
    this.options = options;
    this.autoDownload = options?.autoDownload ?? false;
    this.platform = options?.platform ?? process.platform;
    this.driver = createUpdateDriver(
      this.platform,
      app.getVersion(),
      options?.autoDownload ?? false,
    );
    this.currentFeedUrl = this.driver.getCurrentFeedUrl();

    this.configureFeedUrl();
    this.bindEvents();
  }

  private configureFeedUrl(): void {
    this.driver.configure({
      source: this.source,
      channel: this.channel,
      feedUrl: this.feedUrl,
    });
    this.currentFeedUrl = this.driver.getCurrentFeedUrl();

    this.logCheck("update feed configured", {
      channel: this.channel,
      source: this.source,
      feedUrl: sanitizeFeedUrl(this.currentFeedUrl),
      currentVersion: app.getVersion(),
      remoteVersion: undefined,
      remoteReleaseDate: undefined,
    });
  }

  getCapability(): DesktopUpdateCapability {
    return this.driver.capability;
  }

  getStatus(): {
    phase: "idle" | "downloading" | "ready";
    version: string | null;
    percent: number;
  } {
    if (this.downloadComplete) {
      return { phase: "ready", version: this.pendingVersion, percent: 100 };
    }
    if (
      this.downloadMode === "background" ||
      this.downloadMode === "foreground"
    ) {
      return {
        phase: "downloading",
        version: this.pendingVersion,
        percent: this.lastProgress?.percent ?? 0,
      };
    }
    return { phase: "idle", version: null, percent: 0 };
  }

  private getDiagnostic(partial?: {
    remoteVersion?: string;
    remoteReleaseDate?: string;
  }): UpdateCheckDiagnostic {
    return {
      channel: this.channel,
      source: this.source,
      feedUrl: sanitizeFeedUrl(this.currentFeedUrl),
      currentVersion: app.getVersion(),
      remoteVersion: partial?.remoteVersion,
      remoteReleaseDate: partial?.remoteReleaseDate,
    };
  }

  private logCheck(message: string, diagnostic: UpdateCheckDiagnostic): void {
    writeDesktopMainLog({
      source: "auto-update",
      stream: "system",
      kind: "app",
      message: `${message} ${JSON.stringify(diagnostic)}`,
      logFilePath: null,
      windowId: this.win.isDestroyed() ? null : this.win.id,
    });
  }

  private bindEvents(): void {
    this.driver.bindEvents({
      onChecking: () => {
        const diagnostic = this.getDiagnostic();
        this.logCheck("update check event: checking for update", diagnostic);
        this.send("update:checking", diagnostic);
      },
      onAvailable: (info) => {
        const diagnostic = this.getDiagnostic({
          remoteVersion: info.version,
          remoteReleaseDate: info.releaseDate,
        });
        this.logCheck("update event: update available", diagnostic);

        // Always store pending info for later surfacing
        this.pendingVersion = info.version;
        this.pendingReleaseDate = info.releaseDate;
        this.pendingReleaseNotes = info.releaseNotes;
        this.pendingActionUrl = info.actionUrl;

        if (this.autoDownload && !this.userInitiatedCheck) {
          // Periodic check: suppress UI, start downloading silently
          this.downloadMode = "background";
          this.logCheck(
            "auto-download: starting background download",
            diagnostic,
          );

          // On Windows, trigger download manually (Mac electron-updater
          // auto-downloads when autoDownload is true)
          if (this.platform === "win32") {
            void this.driver.downloadUpdate();
          }
          return;
        }

        // User-initiated check: always send the event so the renderer
        // can exit "checking" state. Background download still proceeds.
        if (this.autoDownload) {
          this.downloadMode = "background";
          this.logCheck(
            "auto-download: user-initiated check, sending available event and starting background download",
            diagnostic,
          );
          if (this.platform === "win32") {
            void this.driver.downloadUpdate();
          }
        }

        this.send("update:available", {
          version: info.version,
          releaseNotes: info.releaseNotes,
          actionUrl: info.actionUrl,
          diagnostic,
        });
      },
      onUnavailable: (info) => {
        const diagnostic = this.getDiagnostic({
          remoteVersion: info.version,
          remoteReleaseDate: info.releaseDate,
        });
        this.logCheck("update event: update not available", diagnostic);
        this.send("update:up-to-date", { diagnostic });
      },
      onProgress: (progress) => {
        this.lastProgress = progress;
        const now = Date.now();
        const percent = Math.round(progress.percent);
        this.logCheck(
          `update progress raw: percent=${progress.percent.toFixed(2)} transferred=${progress.transferred} total=${progress.total} bps=${progress.bytesPerSecond}`,
          this.getDiagnostic({
            remoteVersion: this.pendingVersion ?? undefined,
            remoteReleaseDate: this.pendingReleaseDate,
          }),
        );
        const shouldLog =
          this.lastProgressLogPercent === null ||
          Math.abs(percent - this.lastProgressLogPercent) >= 5 ||
          now - this.lastProgressLogAt >= 5_000 ||
          percent === 100;
        if (shouldLog) {
          this.lastProgressLogAt = now;
          this.lastProgressLogPercent = percent;
          this.logCheck(
            `update event: download progress ${percent}%`,
            this.getDiagnostic(),
          );
        }

        // Suppress progress events during background download
        if (this.downloadMode === "background") {
          return;
        }

        this.send("update:progress", {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        });
      },
      onDownloaded: (info) => {
        this.logCheck(
          "update event: downloaded",
          this.getDiagnostic({
            remoteVersion: info.version,
            remoteReleaseDate: info.releaseDate,
          }),
        );
        this.downloadMode = "idle";
        this.downloadComplete = true;
        // Always notify renderer when download completes
        this.send("update:downloaded", { version: info.version });
      },
      onError: (error) => {
        const diagnostic = this.getDiagnostic();
        this.logCheck(`update error: ${error.message}`, diagnostic);

        if (this.downloadMode === "background" && !this.userInitiatedCheck) {
          // Suppress error UI during background-only download
          this.logCheck(
            "auto-download: background download failed, suppressing UI error",
            diagnostic,
          );
          this.downloadMode = "idle";
          return;
        }

        if (this.downloadMode === "background") {
          this.downloadMode = "idle";
        }

        this.send("update:error", {
          message: error.message,
          rawMessage: error.message,
          diagnostic,
        });
      },
    });
  }

  private send(channel: string, data: unknown): void {
    if (!this.win.isDestroyed()) {
      const all = webContents.getAllWebContents();
      this.logCheck(
        `update send: ${channel} to ${all.length} webContents`,
        this.getDiagnostic(),
      );
      // Send to the main renderer
      this.win.webContents.send(channel, data);
      // Also forward to any embedded webviews so the web app receives events
      for (const wc of all) {
        if (wc.id !== this.win.webContents.id && !wc.isDestroyed()) {
          const webContentsType =
            typeof wc.getType === "function" ? wc.getType() : "unknown";
          const webContentsUrl =
            typeof wc.getURL === "function"
              ? sanitizeFeedUrl(wc.getURL())
              : null;
          this.logCheck(
            `update send target: ${channel} wc=${wc.id} type=${webContentsType} url=${webContentsUrl}`,
            this.getDiagnostic(),
          );
          wc.send(channel, data);
        }
      }
    }
  }

  async checkNow(options?: {
    userInitiated?: boolean;
  }): Promise<{ updateAvailable: boolean }> {
    const startedAt = Date.now();
    this.userInitiatedCheck = options?.userInitiated ?? false;
    this.logCheck("update check start", this.getDiagnostic());

    // If background download already completed, surface it immediately
    if (this.downloadComplete && this.pendingVersion) {
      this.logCheck(
        "update check: background download already complete, surfacing",
        this.getDiagnostic(),
      );
      // Brief "checking" flash so the settings button shows a transition
      this.send("update:checking", this.getDiagnostic());
      this.send("update:downloaded", { version: this.pendingVersion });
      return { updateAvailable: true };
    }

    // If background download is in progress, show "available" with version
    // info but keep downloading in the background. User can decide whether
    // to install — clicking Install will switch to foreground mode with
    // visible progress.
    if (this.downloadMode === "background" && this.pendingVersion) {
      this.logCheck(
        "update check: background download in progress, surfacing available state",
        this.getDiagnostic(),
      );

      // Brief "checking" flash so the settings button shows a transition
      this.send("update:checking", this.getDiagnostic());

      const diagnostic = this.getDiagnostic({
        remoteVersion: this.pendingVersion,
        remoteReleaseDate: this.pendingReleaseDate,
      });
      this.send("update:available", {
        version: this.pendingVersion,
        releaseNotes: this.pendingReleaseNotes,
        actionUrl: this.pendingActionUrl,
        diagnostic,
      });
      return { updateAvailable: true };
    }

    if (this.checkInProgress) {
      this.logCheck(
        "update check skipped: already in progress",
        this.getDiagnostic(),
      );
      return this.checkInProgress;
    }

    this.checkInProgress = (async () => {
      try {
        if (!this.driver.capability.check) {
          this.logCheck(
            "update check skipped: capability disabled on this platform",
            this.getDiagnostic(),
          );
          return { updateAvailable: false };
        }

        const result = await this.driver.checkForUpdates();
        const diagnostic = this.getDiagnostic({
          remoteVersion: result.remoteVersion,
          remoteReleaseDate: result.remoteReleaseDate,
        });
        this.logCheck(
          `update check result: ${result.updateAvailable ? "update available" : "no update"} (${Date.now() - startedAt}ms)`,
          diagnostic,
        );
        return { updateAvailable: result.updateAvailable };
      } catch (error) {
        this.logCheck(
          `check failed: ${error instanceof Error ? error.message : String(error)}`,
          this.getDiagnostic(),
        );
        return { updateAvailable: false };
      } finally {
        this.checkInProgress = null;
        this.userInitiatedCheck = false;
      }
    })();

    return this.checkInProgress;
  }

  async downloadUpdate(): Promise<{ ok: boolean }> {
    if (
      this.driver.capability.downloadMode !== "in-app" &&
      this.driver.capability.downloadMode !== "external"
    ) {
      this.logCheck(
        "update download skipped: capability disabled on this platform",
        this.getDiagnostic(),
      );
      return { ok: false };
    }

    // Switch to foreground mode and remove rate limit
    this.downloadMode = "foreground";
    if (this.lastProgress !== null) {
      this.send("update:progress", this.lastProgress);
    }
    if (
      this.platform === "win32" &&
      this.driver instanceof WindowsUpdateDriver
    ) {
      this.driver.setRateLimit(null);
    }

    return this.driver.downloadUpdate();
  }

  async quitAndInstall(): Promise<void> {
    const startedAt = Date.now();
    const logStep = (message: string): void => {
      this.logCheck(
        `quit-and-install: ${message} (+${Date.now() - startedAt}ms)`,
        this.getDiagnostic(),
      );
    };

    logStep("start");

    await this.options?.prepareForUpdateInstall?.({
      app,
      orchestrator: this.orchestrator,
      logLifecycleStep: (message: string) => {
        this.logCheck(message, this.getDiagnostic());
      },
    });

    // --- Phase 1: Best-effort cleanup ---
    // Each step is wrapped in try/catch so a failure in one step never
    // prevents the subsequent steps or the final install from proceeding.
    // The verification gate in phase 2 is the real safety check.

    // 0. Stop periodic update checks so they don't fire during teardown.
    this.stopPeriodicCheck();

    logStep("phase 1 cleanup start");

    // 1a. Tear down launchd services (bootout + SIGKILL + delete ports file).
    const launchdCtx = this.launchdCtx;
    const teardownPromise = launchdCtx
      ? (async () => {
          const teardownStartedAt = Date.now();
          try {
            await teardownLaunchdServices({
              launchd: launchdCtx.manager,
              labels: launchdCtx.labels,
              plistDir: launchdCtx.plistDir,
            });
            this.logCheck(
              `quit-and-install: launchd teardown complete (+${Date.now() - teardownStartedAt}ms)`,
              this.getDiagnostic(),
            );
          } catch (err) {
            this.logCheck(
              `quit-and-install: launchd teardown failed, proceeding: ${err instanceof Error ? err.message : String(err)} (+${Date.now() - teardownStartedAt}ms)`,
              this.getDiagnostic(),
            );
          }
        })()
      : Promise.resolve();

    // 1b. Dispose the orchestrator (stops non-launchd managed units like
    // embedded web server, utility processes). These are child processes of
    // the Electron main process and will be reaped by the OS on exit anyway,
    // so failure here is non-critical.
    const disposePromise = (async () => {
      const disposeStartedAt = Date.now();
      try {
        await this.orchestrator.dispose();
        this.logCheck(
          `quit-and-install: orchestrator dispose complete (+${Date.now() - disposeStartedAt}ms)`,
          this.getDiagnostic(),
        );
      } catch (err) {
        this.logCheck(
          `quit-and-install: orchestrator dispose failed, proceeding: ${err instanceof Error ? err.message : String(err)} (+${Date.now() - disposeStartedAt}ms)`,
          this.getDiagnostic(),
        );
      }
    })();

    await Promise.all([teardownPromise, disposePromise]);

    logStep("phase 1 cleanup end");

    // --- Phase 2 & 3: macOS-only process verification and lock check ---
    // On Windows, the NSIS installer handles process detection itself.
    if (this.platform === "darwin") {
      // Two sweeps of SIGKILL to clear all Nexu sidecar processes. Uses both
      // authoritative sources (launchd labels, runtime-ports.json) and pgrep.
      const firstSweepStartedAt = Date.now();
      let { clean, remainingPids } = await ensureNexuProcessesDead({
        timeoutMs: 8_000,
        intervalMs: 200,
      });
      this.logCheck(
        `quit-and-install: first sweep complete in ${Date.now() - firstSweepStartedAt}ms (${clean ? "clean" : `survivors: ${remainingPids.join(", ")}`})`,
        this.getDiagnostic(),
      );

      if (!clean) {
        const secondSweepStartedAt = Date.now();
        ({ clean, remainingPids } = await ensureNexuProcessesDead({
          timeoutMs: 5_000,
          intervalMs: 200,
        }));
        this.logCheck(
          `quit-and-install: second sweep complete in ${Date.now() - secondSweepStartedAt}ms (${clean ? "clean" : `survivors: ${remainingPids.join(", ")}`})`,
          this.getDiagnostic(),
        );
      }

      // Evidence-based install decision: check if critical paths are locked.
      const lockCheckStartedAt = Date.now();
      const { locked, lockedPaths } = await checkCriticalPathsLocked();
      this.logCheck(
        `quit-and-install: critical-path lock check complete in ${Date.now() - lockCheckStartedAt}ms (${locked ? `locked: ${lockedPaths.join(", ")}` : "unlocked"})`,
        this.getDiagnostic(),
      );

      if (locked) {
        this.logCheck(
          `quit-and-install: ABORTING — critical paths still locked: ${lockedPaths.join(", ")}`,
          this.getDiagnostic(),
        );
        return;
      }

      if (!clean) {
        this.logCheck(
          "quit-and-install: residual processes exist but no critical path locks, proceeding",
          this.getDiagnostic(),
        );
      }
    }

    if (
      this.driver.capability.applyMode !== "in-app" &&
      this.driver.capability.applyMode !== "external-installer"
    ) {
      this.logCheck(
        "quit-and-install skipped: capability disabled on this platform",
        this.getDiagnostic(),
      );
      return;
    }

    // Set force-quit flag so window close handlers don't intercept the exit
    (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
    logStep("triggering update apply");
    await this.driver.applyUpdate();
  }

  setChannel(channel: UpdateChannelName): void {
    this.channel = channel;
    this.configureFeedUrl();
  }

  setSource(source: UpdateSource): void {
    this.source = source;
    this.configureFeedUrl();
  }

  startPeriodicCheck(): void {
    if (!this.driver.capability.check) {
      this.logCheck(
        "periodic update checks disabled on this platform",
        this.getDiagnostic(),
      );
      return;
    }

    if (this.timer || this.initialTimer) {
      return;
    }

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.checkNow();
      this.timer = setInterval(() => {
        void this.checkNow();
      }, this.checkIntervalMs);
    }, this.initialDelayMs);
  }

  stopPeriodicCheck(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
