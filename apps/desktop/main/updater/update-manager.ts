import { type BrowserWindow, app, webContents } from "electron";
import { autoUpdater } from "electron-updater";
import type {
  UpdateChannelName,
  UpdateCheckDiagnostic,
  UpdateSource,
} from "../../shared/host";
import type { PrepareForUpdateInstallArgs } from "../platforms/types";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
import { writeDesktopMainLog } from "../runtime/runtime-logger";
import { R2_BASE_URL } from "./component-updater";

export interface UpdateManagerOptions {
  source?: UpdateSource;
  channel?: UpdateChannelName;
  feedUrl?: string | null;
  autoDownload?: boolean;
  checkIntervalMs?: number;
  initialDelayMs?: number;
  prepareForUpdateInstall?: (
    args: PrepareForUpdateInstallArgs,
  ) => Promise<{ handled: boolean }>;
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
  private readonly prepareForUpdateInstallHook: UpdateManagerOptions["prepareForUpdateInstall"];
  private currentFeedUrl: string;
  private checkInProgress: Promise<{ updateAvailable: boolean }> | null = null;
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
    this.checkIntervalMs = options?.checkIntervalMs ?? 4 * 60 * 60 * 1000;
    this.initialDelayMs = options?.initialDelayMs ?? 60_000;
    this.prepareForUpdateInstallHook = options?.prepareForUpdateInstall;
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
      this.logCheck("checking for update", diagnostic);
      this.send("update:checking", diagnostic);
    });

    autoUpdater.on("update-available", (info) => {
      const diagnostic = this.getDiagnostic({
        remoteVersion: info.version,
        remoteReleaseDate: info.releaseDate,
      });
      this.logCheck("update available", diagnostic);
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
      this.logCheck("update not available", diagnostic);
      this.send("update:up-to-date", { diagnostic });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.send("update:progress", {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
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
    if (this.checkInProgress) {
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
        this.logCheck("check complete", diagnostic);
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
    this.logCheck("quit-and-install: starting teardown", this.getDiagnostic());

    if (this.prepareForUpdateInstallHook) {
      const result = await this.prepareForUpdateInstallHook({
        app,
        orchestrator: this.orchestrator,
        logLifecycleStep: (message) => {
          this.logCheck(`quit-and-install: ${message}`, this.getDiagnostic());
        },
      });

      if (result.handled) {
        return;
      }
    }

    // The residency lifecycle hook is the authoritative update-install path.
    // Stop periodic checks before returning so they do not fire during exit.
    this.stopPeriodicCheck();
    this.logCheck(
      "quit-and-install: no lifecycle handler took ownership, aborting install",
      this.getDiagnostic(),
    );
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
