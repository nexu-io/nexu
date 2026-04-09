import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type {
  DesktopUpdateCapability,
  UpdateChannelName,
  UpdateSource,
} from "../../shared/host";
import { R2_BASE_URL } from "./component-updater";
import type {
  PlatformUpdateDriver,
  UpdateDriverCheckResult,
  UpdateDriverContext,
  UpdateDriverEventHandlers,
  UpdateDriverOptions,
} from "./update-driver";

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

export function resolveMacUpdateFeedUrlForTests(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
  arch?: string;
}): string {
  return resolveUpdateFeedUrl(options);
}

export class MacUpdateDriver implements PlatformUpdateDriver {
  readonly capability: DesktopUpdateCapability = {
    platform: "darwin",
    check: true,
    downloadMode: "in-app",
    applyMode: "in-app",
    applyLabel: "Restart",
    notes: null,
  };

  private currentFeedUrl = getDefaultR2FeedUrl("stable");

  constructor(private readonly context: UpdateDriverContext) {
    autoUpdater.autoDownload = context.autoDownload;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
  }

  getCurrentFeedUrl(): string {
    return this.currentFeedUrl;
  }

  configure(options: UpdateDriverOptions): void {
    this.currentFeedUrl = resolveUpdateFeedUrl(options);

    if (this.currentFeedUrl === "github://nexu-io/nexu") {
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "nexu-io",
        repo: "nexu",
      });
      return;
    }

    autoUpdater.setFeedURL({
      provider: "generic",
      url: this.currentFeedUrl,
    });
  }

  bindEvents(handlers: UpdateDriverEventHandlers): void {
    autoUpdater.on("checking-for-update", handlers.onChecking);
    autoUpdater.on("update-available", (info) => {
      handlers.onAvailable({
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes:
          typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      });
    });
    autoUpdater.on("update-not-available", (info) => {
      handlers.onUnavailable({
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      handlers.onProgress({
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      handlers.onDownloaded({
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });
    autoUpdater.on("error", (error) => {
      handlers.onError(error);
    });
  }

  async checkForUpdates(): Promise<UpdateDriverCheckResult> {
    const result = await autoUpdater.checkForUpdates();
    return {
      updateAvailable:
        result !== null &&
        result.updateInfo.version !== this.context.currentVersion,
      remoteVersion: result?.updateInfo.version,
      remoteReleaseDate: result?.updateInfo.releaseDate,
    };
  }

  async downloadUpdate(): Promise<{ ok: boolean }> {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  }

  async applyUpdate(): Promise<void> {
    autoUpdater.quitAndInstall(false, true);
  }
}
