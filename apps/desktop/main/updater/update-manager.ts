import { type BrowserWindow, app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateChannelName, UpdateSource } from "../../shared/host";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
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
};

export class UpdateManager {
  private readonly win: BrowserWindow;
  private readonly orchestrator: RuntimeOrchestrator;
  private source: UpdateSource;
  private channel: UpdateChannelName;
  private readonly feedUrl: string | null;
  private readonly checkIntervalMs: number;
  private readonly initialDelayMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    win: BrowserWindow,
    orchestrator: RuntimeOrchestrator,
    options?: UpdateManagerOptions,
  ) {
    this.win = win;
    this.orchestrator = orchestrator;
    this.source = options?.source ?? "github";
    this.channel = options?.channel ?? "stable";
    this.feedUrl = options?.feedUrl ?? null;
    this.checkIntervalMs = options?.checkIntervalMs ?? 4 * 60 * 60 * 1000;
    this.initialDelayMs = options?.initialDelayMs ?? 60_000;

    autoUpdater.autoDownload = options?.autoDownload ?? false;
    autoUpdater.autoInstallOnAppQuit = true;
    this.configureFeedUrl();
    this.bindEvents();
  }

  private configureFeedUrl(): void {
    // Priority: env var > build config > source/channel logic
    const overrideUrl = process.env.NEXU_UPDATE_FEED_URL ?? this.feedUrl;

    if (overrideUrl) {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: overrideUrl,
      });
      return;
    }

    if (this.source === "github") {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "nexu-io",
        repo: "nexu",
      });
    } else {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: R2_FEED_URLS[this.channel],
      });
    }
  }

  private bindEvents(): void {
    autoUpdater.on("checking-for-update", () => {
      this.send("update:checking", {});
    });

    autoUpdater.on("update-available", (info) => {
      this.send("update:available", {
        version: info.version,
        releaseNotes:
          typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.send("update:up-to-date", {});
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
      this.send("update:error", { message: error.message });
    });
  }

  private send(channel: string, data: unknown): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(channel, data);
    }
  }

  async checkNow(): Promise<{ updateAvailable: boolean }> {
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        updateAvailable:
          result !== null && result.updateInfo.version !== app.getVersion(),
      };
    } catch {
      return { updateAvailable: false };
    }
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
