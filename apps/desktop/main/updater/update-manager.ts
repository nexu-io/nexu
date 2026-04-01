import { type BrowserWindow, app, webContents } from "electron";
import { autoUpdater } from "electron-updater";
import type {
  UpdateChannelName,
  UpdateCheckDiagnostic,
  UpdateSource,
} from "../../shared/host";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
import { writeDesktopMainLog } from "../runtime/runtime-logger";
import {
  checkCriticalPathsLocked,
  ensureNexuProcessesDead,
  teardownLaunchdServices,
} from "../services/launchd-bootstrap";
import type { LaunchdManager } from "../services/launchd-manager";
import { R2_BASE_URL } from "./component-updater";

export interface UpdateManagerOptions {
  source?: UpdateSource;
  channel?: UpdateChannelName;
  feedUrl?: string | null;
  autoDownload?: boolean;
  checkIntervalMs?: number;
  initialDelayMs?: number;
  /** Launchd context — required for clean service teardown before update install */
  launchd?: {
    manager: LaunchdManager;
    labels: { controller: string; openclaw: string };
    plistDir: string;
  };
}

function getMacFeedArch(arch: string = process.arch): "arm64" | "x64" {
  if (arch === "x64" || arch === "arm64") {
    return arch;
  }

  throw new Error(
    `[update-manager] Unsupported mac architecture "${arch}". Expected "x64" or "arm64".`,
  );
}

function getDefaultR2FeedUrl(
  channel: UpdateChannelName,
  arch: string = process.arch,
): string {
  return `${R2_BASE_URL}/${channel}/${getMacFeedArch(arch)}`;
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

function resolveUpdateFeedUrl(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
  arch?: string;
}): string {
  const overrideUrl = process.env.NEXU_UPDATE_FEED_URL ?? options.feedUrl;
  if (overrideUrl) {
    return overrideUrl;
  }

  if (options.source === "github") {
    return "github://nexu-io/nexu";
  }

  return getDefaultR2FeedUrl(options.channel, options.arch);
}

export function resolveUpdateFeedUrlForTests(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
  arch?: string;
}): string {
  return resolveUpdateFeedUrl(options);
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
  private currentFeedUrl: string;
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
    this.currentFeedUrl = getDefaultR2FeedUrl(this.channel);

    autoUpdater.autoDownload = options?.autoDownload ?? false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    this.configureFeedUrl();
    this.bindEvents();
  }

  private configureFeedUrl(): void {
    this.currentFeedUrl = resolveUpdateFeedUrl({
      source: this.source,
      channel: this.channel,
      feedUrl: this.feedUrl,
    });

    if (this.currentFeedUrl === "github://nexu-io/nexu") {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "nexu-io",
        repo: "nexu",
      });
    } else {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: this.currentFeedUrl,
      });
    }

    this.logCheck("update feed configured", {
      channel: this.channel,
      source: this.source,
      feedUrl: sanitizeFeedUrl(this.currentFeedUrl),
      currentVersion: app.getVersion(),
      remoteVersion: undefined,
      remoteReleaseDate: undefined,
    });
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
    autoUpdater.on("checking-for-update", () => {
      const diagnostic = this.getDiagnostic();
      this.logCheck("update check event: checking for update", diagnostic);
      this.send("update:checking", diagnostic);
    });

    autoUpdater.on("update-available", (info) => {
      const diagnostic = this.getDiagnostic({
        remoteVersion: info.version,
        remoteReleaseDate: info.releaseDate,
      });
      this.logCheck("update event: update available", diagnostic);
      this.send("update:available", {
        version: info.version,
        releaseNotes:
          typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
        diagnostic,
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      const diagnostic = this.getDiagnostic({
        remoteVersion: info.version,
        remoteReleaseDate: info.releaseDate,
      });
      this.logCheck("update event: update not available", diagnostic);
      this.send("update:up-to-date", { diagnostic });
    });

    autoUpdater.on("download-progress", (progress) => {
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
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.logCheck(
        "update event: downloaded",
        this.getDiagnostic({
          remoteVersion: info.version,
          remoteReleaseDate: info.releaseDate,
        }),
      );
      this.send("update:downloaded", { version: info.version });
    });

    autoUpdater.on("error", (error) => {
      const diagnostic = this.getDiagnostic();
      this.logCheck(`update error: ${error.message}`, diagnostic);
      this.send("update:error", { message: error.message, diagnostic });
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
        const result = await autoUpdater.checkForUpdates();
        const remoteVersion = result?.updateInfo.version;
        const diagnostic = this.getDiagnostic({
          remoteVersion,
          remoteReleaseDate: result?.updateInfo.releaseDate,
        });
        this.logCheck(
          `update check result: ${result === null ? "null" : remoteVersion === app.getVersion() ? "no update" : "update available"} (${Date.now() - startedAt}ms)`,
          diagnostic,
        );
        return {
          updateAvailable:
            result !== null && result.updateInfo.version !== app.getVersion(),
        };
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
    await autoUpdater.downloadUpdate();
    return { ok: true };
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

    // Set force-quit flag so window close handlers don't intercept the exit
    (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
    logStep("triggering autoUpdater.quitAndInstall");
    autoUpdater.quitAndInstall(false, true);
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
