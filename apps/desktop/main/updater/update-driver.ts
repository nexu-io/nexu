import type {
  DesktopUpdateCapability,
  UpdateChannelName,
  UpdateCheckDiagnostic,
  UpdateSource,
} from "../../shared/host";

export type UpdateDriverOptions = {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
};

export type UpdateDriverEventHandlers = {
  onChecking: () => void;
  onAvailable: (info: {
    version: string;
    releaseDate?: string;
    releaseNotes?: string;
    actionUrl?: string;
  }) => void;
  onUnavailable: (info: { version: string; releaseDate?: string }) => void;
  onProgress: (progress: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  }) => void;
  onDownloaded: (info: { version: string; releaseDate?: string }) => void;
  onError: (error: Error) => void;
};

export type UpdateDriverCheckResult = {
  updateAvailable: boolean;
  remoteVersion?: string;
  remoteReleaseDate?: string;
  actionUrl?: string;
};

export type UpdateDriverContext = {
  currentVersion: string;
  autoDownload: boolean;
  openExternal: (url: string) => Promise<void>;
  writeLog: (message: string, diagnostic: UpdateCheckDiagnostic) => void;
};

export interface PlatformUpdateDriver {
  readonly capability: DesktopUpdateCapability;
  getCurrentFeedUrl(): string;
  configure(options: UpdateDriverOptions): void;
  bindEvents(handlers: UpdateDriverEventHandlers): void;
  checkForUpdates(): Promise<UpdateDriverCheckResult>;
  downloadUpdate(): Promise<{ ok: boolean }>;
  applyUpdate(): Promise<void>;
}
