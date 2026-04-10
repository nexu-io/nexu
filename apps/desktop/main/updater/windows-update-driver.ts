import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { app } from "electron";
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
  downloadMode: "in-app",
  applyMode: "external-installer",
  applyLabel: "Install",
  notes: null,
};

/** Default background download rate limit: 1 MB/s */
const DEFAULT_RATE_LIMIT_BPS = 1_048_576;

/** Minimum interval between progress event emissions (ms) */
const PROGRESS_EMIT_INTERVAL_MS = 500;

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
    return `${R2_BASE_URL}/${options.channel}/win32/x64/latest-win.json`;
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

function resolveInstallerPath(version: string): string {
  return join(app.getPath("temp"), `nexu-setup-${version}.exe`);
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
  private downloadedInstallerPath: string | null = null;
  private abortController: AbortController | null = null;
  private downloadPromise: Promise<{ ok: boolean }> | null = null;
  private rateLimitBps: number | null = DEFAULT_RATE_LIMIT_BPS;

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

  /** Set download rate limit in bytes/second, or null for unlimited. */
  setRateLimit(bps: number | null): void {
    this.rateLimitBps = bps;
  }

  /** Whether a download is currently in progress. */
  isDownloading(): boolean {
    return this.abortController !== null;
  }

  async checkForUpdates(): Promise<UpdateDriverCheckResult> {
    this.handlers?.onChecking();
    try {
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
        compareDesktopVersions(manifest.version, this.context.currentVersion) >
        0;

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
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      this.handlers?.onError(normalizedError);
      throw normalizedError;
    }
  }

  async downloadUpdate(): Promise<{ ok: boolean }> {
    const manifest = this.latestManifest;
    if (!manifest) {
      return { ok: false };
    }

    if (this.downloadPromise) {
      return this.downloadPromise;
    }

    const installerUrl = manifest.installer.url;
    const expectedSize = manifest.installer.size ?? null;
    const expectedSha256 = manifest.installer.sha256 ?? null;
    const destPath = resolveInstallerPath(manifest.version);

    // If already fully downloaded, verify checksum when available before reuse.
    if (existsSync(destPath)) {
      try {
        const stat = statSync(destPath);
        const sizeMatches = expectedSize === null || stat.size === expectedSize;
        const shaMatches =
          expectedSha256 === null
            ? true
            : this.verifyFileSha256(destPath, expectedSha256);
        if (sizeMatches && shaMatches) {
          this.downloadedInstallerPath = destPath;
          this.handlers?.onDownloaded({
            version: manifest.version,
            releaseDate: manifest.releaseDate,
          });
          return { ok: true };
        }
      } catch {
        // stat failed, re-download
      }
    }

    // Clean up partial file
    try {
      if (existsSync(destPath)) unlinkSync(destPath);
    } catch {
      // ignore cleanup errors
    }

    const ac = new AbortController();
    this.abortController = ac;

    const downloadPromise = new Promise<{ ok: boolean }>((resolve) => {
      const getter = installerUrl.startsWith("https://") ? httpsGet : httpGet;

      const request = getter(installerUrl, (response) => {
        if (ac.signal.aborted) {
          response.destroy();
          resolve({ ok: false });
          return;
        }

        // Handle redirects
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          request.destroy();
          // Follow redirect by updating URL and retrying
          const redirectGetter = response.headers.location.startsWith(
            "https://",
          )
            ? httpsGet
            : httpGet;
          this.downloadWithStream(
            redirectGetter,
            response.headers.location,
            destPath,
            manifest,
            expectedSize,
            expectedSha256,
            ac,
            resolve,
          );
          return;
        }

        if (response.statusCode !== 200) {
          this.abortController = null;
          const error = new Error(
            `Installer download failed: ${response.statusCode} ${response.statusMessage}`,
          );
          this.handlers?.onError(error);
          resolve({ ok: false });
          return;
        }

        this.handleDownloadStream(
          response,
          destPath,
          manifest,
          expectedSize,
          expectedSha256,
          ac,
          resolve,
        );
      });

      request.on("error", (error) => {
        this.abortController = null;
        this.handlers?.onError(error);
        resolve({ ok: false });
      });

      ac.signal.addEventListener("abort", () => {
        request.destroy();
      });
    });

    this.downloadPromise = downloadPromise.finally(() => {
      this.downloadPromise = null;
    });

    return this.downloadPromise;
  }

  private verifyFileSha256(filePath: string, expectedSha256: string): boolean {
    const hash = createHash("sha256");
    const fileBuffer = readFileSync(filePath);
    hash.update(fileBuffer);
    return hash.digest("hex").toLowerCase() === expectedSha256.toLowerCase();
  }

  private downloadWithStream(
    getter: typeof httpsGet | typeof httpGet,
    url: string,
    destPath: string,
    manifest: WindowsUpdateManifest,
    expectedSize: number | null,
    expectedSha256: string | null,
    ac: AbortController,
    resolve: (value: { ok: boolean }) => void,
  ): void {
    const request = getter(url, (response) => {
      if (ac.signal.aborted) {
        response.destroy();
        resolve({ ok: false });
        return;
      }

      if (response.statusCode !== 200) {
        this.abortController = null;
        const error = new Error(
          `Installer download failed: ${response.statusCode} ${response.statusMessage}`,
        );
        this.handlers?.onError(error);
        resolve({ ok: false });
        return;
      }

      this.handleDownloadStream(
        response,
        destPath,
        manifest,
        expectedSize,
        expectedSha256,
        ac,
        resolve,
      );
    });

    request.on("error", (error) => {
      this.abortController = null;
      this.handlers?.onError(error);
      resolve({ ok: false });
    });

    ac.signal.addEventListener("abort", () => {
      request.destroy();
    });
  }

  private handleDownloadStream(
    response: NodeJS.ReadableStream & {
      headers?: Record<string, string | string[] | undefined>;
    },
    destPath: string,
    manifest: WindowsUpdateManifest,
    expectedSize: number | null,
    expectedSha256: string | null,
    ac: AbortController,
    resolve: (value: { ok: boolean }) => void,
  ): void {
    const contentLength =
      expectedSize ??
      Number.parseInt(
        (response.headers as Record<string, string | undefined>)?.[
          "content-length"
        ] ?? "0",
        10,
      );
    const total = contentLength || 0;
    let transferred = 0;
    let lastProgressAt = 0;
    const startedAt = Date.now();

    const hash = expectedSha256 ? createHash("sha256") : null;
    const fileStream = createWriteStream(destPath);

    const emitProgress = (): void => {
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_EMIT_INTERVAL_MS) return;
      lastProgressAt = now;

      const elapsed = (now - startedAt) / 1000;
      const bytesPerSecond = elapsed > 0 ? transferred / elapsed : 0;
      const percent = total > 0 ? (transferred / total) * 100 : 0;

      this.handlers?.onProgress({
        percent: Math.min(percent, 100),
        bytesPerSecond,
        transferred,
        total,
      });
    };

    const cleanup = (success: boolean): void => {
      this.abortController = null;
      if (!success) {
        try {
          fileStream.close();
          if (existsSync(destPath)) unlinkSync(destPath);
        } catch {
          // ignore cleanup errors
        }
      }
    };

    response.on("data", (chunk: Buffer) => {
      if (ac.signal.aborted) {
        (
          response as NodeJS.ReadableStream & { destroy?: () => void }
        ).destroy?.();
        cleanup(false);
        resolve({ ok: false });
        return;
      }

      hash?.update(chunk);
      fileStream.write(chunk);
      transferred += chunk.length;
      emitProgress();

      // Rate limiting: pause the stream and resume after delay
      const rateLimit = this.rateLimitBps;
      if (rateLimit !== null && rateLimit > 0) {
        const delayMs = (chunk.length / rateLimit) * 1000;
        if (delayMs > 10) {
          (
            response as NodeJS.ReadableStream & { pause?: () => void }
          ).pause?.();
          setTimeout(() => {
            if (!ac.signal.aborted) {
              (
                response as NodeJS.ReadableStream & { resume?: () => void }
              ).resume?.();
            }
          }, delayMs);
        }
      }
    });

    response.on("end", () => {
      fileStream.end(() => {
        if (ac.signal.aborted) {
          cleanup(false);
          resolve({ ok: false });
          return;
        }

        // SHA256 verification
        if (hash && expectedSha256) {
          const actualSha256 = hash.digest("hex");
          if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
            cleanup(false);
            const error = new Error(
              `Installer SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
            );
            this.handlers?.onError(error);
            resolve({ ok: false });
            return;
          }
        }

        // Emit final 100% progress
        this.handlers?.onProgress({
          percent: 100,
          bytesPerSecond: 0,
          transferred,
          total: transferred,
        });

        this.downloadedInstallerPath = destPath;
        this.handlers?.onDownloaded({
          version: manifest.version,
          releaseDate: manifest.releaseDate,
        });
        resolve({ ok: true });
      });
    });

    response.on("error", (error: Error) => {
      cleanup(false);
      this.handlers?.onError(error);
      resolve({ ok: false });
    });

    fileStream.on("error", (error: Error) => {
      cleanup(false);
      this.handlers?.onError(error);
      resolve({ ok: false });
    });

    ac.signal.addEventListener("abort", () => {
      (
        response as NodeJS.ReadableStream & { destroy?: () => void }
      ).destroy?.();
      cleanup(false);
      resolve({ ok: false });
    });
  }

  async applyUpdate(): Promise<void> {
    const installerPath = this.downloadedInstallerPath;
    if (installerPath && existsSync(installerPath)) {
      spawn(installerPath, [], {
        detached: true,
        stdio: "ignore",
      }).unref();
      app.quit();
      return;
    }

    // Fallback: open installer URL in browser
    const installerUrl = this.latestManifest?.installer.url;
    if (installerUrl) {
      await this.context.openExternal(installerUrl);
    }
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
