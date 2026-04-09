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

type WindowsUpdateManifest = {
  version: string;
  channel: UpdateChannelName;
  platform: "win32";
  arch: "x64";
  releaseDate?: string;
  releaseNotes?: string;
  notesUrl?: string;
  installer: {
    url: string;
    sha256?: string;
    size?: number;
  };
};

const WINDOWS_UPDATE_CAPABILITY: DesktopUpdateCapability = {
  platform: "win32",
  check: true,
  downloadMode: "external",
  applyMode: "redirect",
  applyLabel: "Download installer",
  notes:
    "Windows desktop updates are delivered through the packaged installer.",
};

function resolveWindowsManifestUrl(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
}): string {
  const overrideUrl = process.env.NEXU_UPDATE_FEED_URL ?? options.feedUrl;
  if (overrideUrl) {
    return overrideUrl;
  }

  if (options.source === "github") {
    return "https://github.com/nexu-io/nexu/releases/latest";
  }

  return `${R2_BASE_URL}/${options.channel}/win32/x64/latest-win.json`;
}

function normalizeVersion(version: string): {
  core: number[];
  prerelease: string[];
} {
  const [corePart, prereleasePart = ""] = version.split("-");
  const core = corePart
    .split(".")
    .map((segment) => Number.parseInt(segment, 10));
  const prerelease = prereleasePart.length
    ? prereleasePart.split(".").filter(Boolean)
    : [];

  return { core, prerelease };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10);
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  return left.localeCompare(right);
}

function compareDesktopVersions(left: string, right: string): number {
  const leftVersion = normalizeVersion(left);
  const rightVersion = normalizeVersion(right);
  const maxCoreLength = Math.max(
    leftVersion.core.length,
    rightVersion.core.length,
  );

  for (let index = 0; index < maxCoreLength; index += 1) {
    const delta =
      (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  if (
    leftVersion.prerelease.length === 0 &&
    rightVersion.prerelease.length === 0
  ) {
    return 0;
  }
  if (leftVersion.prerelease.length === 0) {
    return 1;
  }
  if (rightVersion.prerelease.length === 0) {
    return -1;
  }

  const maxPrereleaseLength = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < maxPrereleaseLength; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];

    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }

    const delta = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export class WindowsUpdateDriver implements PlatformUpdateDriver {
  readonly capability = WINDOWS_UPDATE_CAPABILITY;
  private currentFeedUrl = resolveWindowsManifestUrl({
    source: "r2",
    channel: "stable",
    feedUrl: null,
  });
  private handlers: UpdateDriverEventHandlers | null = null;
  private latestManifest: WindowsUpdateManifest | null = null;

  constructor(private readonly context: UpdateDriverContext) {}

  getCurrentFeedUrl(): string {
    return this.currentFeedUrl;
  }

  configure(options: UpdateDriverOptions): void {
    this.currentFeedUrl = resolveWindowsManifestUrl(options);
  }

  bindEvents(handlers: UpdateDriverEventHandlers): void {
    this.handlers = handlers;
  }

  async checkForUpdates(): Promise<UpdateDriverCheckResult> {
    this.handlers?.onChecking();

    const response = await fetch(this.currentFeedUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Windows update manifest request failed: ${response.status} ${response.statusText}`,
      );
    }

    const manifest = (await response.json()) as WindowsUpdateManifest;
    this.latestManifest = manifest;

    const updateAvailable =
      compareDesktopVersions(manifest.version, this.context.currentVersion) > 0;

    if (updateAvailable) {
      this.handlers?.onAvailable({
        version: manifest.version,
        releaseDate: manifest.releaseDate,
        releaseNotes: manifest.releaseNotes,
        actionUrl: manifest.installer.url,
      });
    } else {
      this.handlers?.onUnavailable({
        version: manifest.version,
        releaseDate: manifest.releaseDate,
      });
    }

    return {
      updateAvailable,
      remoteVersion: manifest.version,
      remoteReleaseDate: manifest.releaseDate,
      actionUrl: manifest.installer.url,
    };
  }

  async downloadUpdate(): Promise<{ ok: boolean }> {
    const installerUrl = this.latestManifest?.installer.url;
    if (!installerUrl) {
      return { ok: false };
    }

    await this.context.openExternal(installerUrl);
    return { ok: true };
  }

  async applyUpdate(): Promise<void> {
    const installerUrl = this.latestManifest?.installer.url;
    if (!installerUrl) {
      return;
    }

    await this.context.openExternal(installerUrl);
  }
}

export function compareDesktopVersionsForTests(
  left: string,
  right: string,
): number {
  return compareDesktopVersions(left, right);
}

export function resolveWindowsManifestUrlForTests(options: {
  source: UpdateSource;
  channel: UpdateChannelName;
  feedUrl: string | null;
}): string {
  return resolveWindowsManifestUrl(options);
}
