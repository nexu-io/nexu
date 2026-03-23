import { type BrowserWindow, app, webContents } from "electron";
import { autoUpdater } from "electron-updater";
import type {
  UpdateChannelName,
  UpdateCheckDiagnostic,
  UpdateSource,
} from "../../shared/host";
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
}

const R2_FEED_URLS: Record<UpdateChannelName, string> = {
  stable: `${R2_BASE_URL}/stable`,
  beta: `${R2_BASE_URL}/beta`,
  nightly: `${R2_BASE_URL}/nightly`,
};

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
}): string {
  const overrideUrl = process.env.NEXU_UPDATE_FEED_URL ?? options.feedUrl;
  if (overrideUrl) {
    return overrideUrl;
  }

  if (options.source === "github") {
    return "github://nexu-io/nexu";
  }

  return R2_FEED_URLS[options.channel];
}

export function resolveUpdateFeedUrlForTests(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
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
  private currentFeedUrl: string;
  private checkInProgress: Promise<{ updateAvailable: boolean }> | null = null;
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
    this.currentFeedUrl = R2_FEED_URLS[this.channel];

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
    await this.orchestrator.dispose();
    if (process.platform === "win32") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
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
    if (this.timer) {
      return;
    }

    setTimeout(() => {
      void this.checkNow();
      this.timer = setInterval(() => {
        void this.checkNow();
      }, this.checkIntervalMs);
    }, this.initialDelayMs);
  }

  stopPeriodicCheck(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
