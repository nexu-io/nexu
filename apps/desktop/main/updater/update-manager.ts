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
import type { PlatformUpdateDriver } from "./update-driver";
import { WindowsUpdateDriver } from "./windows-update-driver";

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
  private checkInProgress: Promise<{ updateAvailable: boolean }> | null = null;
  private lastProgressLogAt = 0;
  private lastProgressLogPercent: number | null = null;
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
        const now = Date.now();
        const percent = Math.round(progress.percent);
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
        this.send("update:downloaded", { version: info.version });
      },
      onError: (error) => {
        const diagnostic = this.getDiagnostic();
        this.logCheck(`update error: ${error.message}`, diagnostic);
        this.send("update:error", { message: error.message, diagnostic });
      },
    });
  }

  private send(channel: string, data: unknown): void {
    if (!this.win.isDestroyed()) {
      const all = webContents.getAllWebContents();
      // Send to the main renderer
      this.win.webContents.send(channel, data);
      // Also forward to any embedded webviews so the web app receives events
      for (const wc of all) {
        if (wc.id !== this.win.webContents.id && !wc.isDestroyed()) {
          wc.send(channel, data);
        }
      }
    }
  }

  async checkNow(): Promise<{ updateAvailable: boolean }> {
    const startedAt = Date.now();
    this.logCheck("update check start", this.getDiagnostic());
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

    // --- Phase 2: Process verification ---
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

    // --- Phase 3: Evidence-based install decision ---
    // Even with surviving processes, the update may be safe if those
    // processes don't hold file handles to critical update paths. Use
    // lsof to check whether the .app bundle or extracted sidecar dirs
    // are actually locked.
    const lockCheckStartedAt = Date.now();
    const { locked, lockedPaths } = await checkCriticalPathsLocked();
    this.logCheck(
      `quit-and-install: critical-path lock check complete in ${Date.now() - lockCheckStartedAt}ms (${locked ? `locked: ${lockedPaths.join(", ")}` : "unlocked"})`,
      this.getDiagnostic(),
    );

    if (locked) {
      // Critical paths are held open — installing now would fail or
      // corrupt the app. Skip this attempt; electron-updater will
      // re-detect the pending update on next launch.
      this.logCheck(
        `quit-and-install: ABORTING — critical paths still locked: ${lockedPaths.join(", ")}`,
        this.getDiagnostic(),
      );
      return;
    }

    if (!clean) {
      // Processes alive but no critical file handles — safe to proceed.
      this.logCheck(
        "quit-and-install: residual processes exist but no critical path locks, proceeding",
        this.getDiagnostic(),
      );
    }

    if (this.driver.capability.applyMode !== "in-app") {
      this.logCheck(
        "quit-and-install skipped: capability disabled on this platform",
        this.getDiagnostic(),
      );
      return;
    }

    // Set force-quit flag so window close handlers don't intercept the exit
    (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
    logStep("triggering autoUpdater.quitAndInstall");
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
