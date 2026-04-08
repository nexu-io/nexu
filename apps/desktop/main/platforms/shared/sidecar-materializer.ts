import { execFile, execFileSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import type {
  DesktopSidecarMaterializer,
  MaterializePackagedSidecarArgs,
} from "../types";
import * as platformFilesystem from "./filesystem-compat";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl") as {
  open: (
    path: string,
    options: { lazyEntries: boolean },
    callback: (error: Error | null, zipFile?: YauzlZipFile) => void,
  ) => void;
};

type YauzlEntry = {
  fileName: string;
  externalFileAttributes?: number;
};

type YauzlZipFile = {
  readEntry: () => void;
  on: (event: "entry", listener: (entry: YauzlEntry) => void) => void;
  once: (
    event: "end" | "error",
    listener: (() => void) | ((error: Error) => void),
  ) => void;
  openReadStream: (
    entry: YauzlEntry,
    callback: (error: Error | null, stream?: NodeJS.ReadableStream) => void,
  ) => void;
  close: () => void;
};

type PackagedArchiveMetadata = {
  format: string;
  path: string;
  version?: string;
};

function ensureDir(targetPath: string): string {
  mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function sleepSync(durationMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function resolveArchiveStamp(
  archivePath: string,
  archiveMetadata: PackagedArchiveMetadata | null,
): string {
  if (archiveMetadata?.version) {
    return archiveMetadata.version;
  }

  const archiveStat = statSync(archivePath);
  return `${archiveStat.size}:${archiveStat.mtimeMs}`;
}

function readPackagedArchiveMetadata(
  packagedSidecarRoot: string,
): PackagedArchiveMetadata | null {
  const archiveMetadataPath = path.resolve(packagedSidecarRoot, "archive.json");

  if (!existsSync(archiveMetadataPath)) {
    return null;
  }

  return JSON.parse(
    readFileSync(archiveMetadataPath, "utf8"),
  ) as PackagedArchiveMetadata;
}

async function extractZipArchive(
  archivePath: string,
  destinationRoot: string,
): Promise<void> {
  await new Promise<void>((resolveExtract, rejectExtract) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        rejectExtract(
          openError ?? new Error(`Unable to open zip archive ${archivePath}`),
        );
        return;
      }

      const closeWithError = (error: Error) => {
        zipFile.close();
        rejectExtract(error);
      };

      zipFile.once("error", closeWithError);
      zipFile.once("end", () => {
        zipFile.close();
        resolveExtract();
      });
      zipFile.on("entry", (entry) => {
        void (async () => {
          const normalizedPath = entry.fileName.replace(/\\/gu, "/");
          if (!normalizedPath || normalizedPath === ".") {
            zipFile.readEntry();
            return;
          }

          const destinationPath = path.resolve(destinationRoot, normalizedPath);
          const relativePath = path.relative(destinationRoot, destinationPath);
          if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            throw new Error(
              `Refusing to extract path outside destination: ${entry.fileName}`,
            );
          }

          if (normalizedPath.endsWith("/")) {
            await mkdir(destinationPath, { recursive: true });
            zipFile.readEntry();
            return;
          }

          await mkdir(path.dirname(destinationPath), { recursive: true });
          zipFile.openReadStream(entry, async (streamError, readStream) => {
            if (streamError || !readStream) {
              closeWithError(
                streamError ??
                  new Error(`Unable to read zip entry ${entry.fileName}`),
              );
              return;
            }

            try {
              await pipeline(readStream, createWriteStream(destinationPath));
              if (platformFilesystem.shouldRestoreArchiveEntryMode()) {
                const entryMode = entry.externalFileAttributes
                  ? (entry.externalFileAttributes >>> 16) & 0o777
                  : 0;
                if (entryMode > 0) {
                  await chmod(destinationPath, entryMode);
                }
              }
              zipFile.readEntry();
            } catch (error) {
              closeWithError(
                error instanceof Error ? error : new Error(String(error)),
              );
            }
          });
        })().catch((error) => {
          closeWithError(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      });

      zipFile.readEntry();
    });
  });
}

function resolveSidecarPaths({
  runtimeSidecarBaseRoot,
  runtimeRoot,
}: MaterializePackagedSidecarArgs) {
  const packagedSidecarRoot = path.resolve(runtimeSidecarBaseRoot, "openclaw");
  const archiveMetadata = readPackagedArchiveMetadata(packagedSidecarRoot);
  const archivePath = archiveMetadata
    ? path.resolve(packagedSidecarRoot, archiveMetadata.path)
    : path.resolve(packagedSidecarRoot, "payload.tar.gz");
  const extractedSidecarRoot = ensureDir(
    path.resolve(runtimeRoot, "openclaw-sidecar"),
  );
  const stampPath = path.resolve(extractedSidecarRoot, ".archive-stamp");
  const archiveStamp = resolveArchiveStamp(archivePath, archiveMetadata);
  const extractedOpenclawEntry = path.resolve(
    extractedSidecarRoot,
    "node_modules/openclaw/openclaw.mjs",
  );

  return {
    packagedSidecarRoot,
    archiveMetadata,
    archivePath,
    extractedSidecarRoot,
    stampPath,
    archiveStamp,
    extractedOpenclawEntry,
  };
}

export function createSyncTarSidecarMaterializer(): DesktopSidecarMaterializer {
  const materializePackagedOpenclawSidecarSync = (
    args: MaterializePackagedSidecarArgs,
  ): string => {
    const resolved = resolveSidecarPaths(args);
    if (!existsSync(resolved.archivePath)) {
      return resolved.packagedSidecarRoot;
    }

    if (
      existsSync(resolved.stampPath) &&
      existsSync(resolved.extractedOpenclawEntry) &&
      readFileSync(resolved.stampPath, "utf8") === resolved.archiveStamp
    ) {
      return resolved.extractedSidecarRoot;
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        if (existsSync(resolved.extractedSidecarRoot)) {
          rmSync(resolved.extractedSidecarRoot, {
            recursive: true,
            force: true,
          });
        }
        mkdirSync(resolved.extractedSidecarRoot, { recursive: true });
        if (resolved.archiveMetadata?.format === "zip") {
          throw new Error(
            "Synchronous packaged OpenClaw extraction does not support zip archives.",
          );
        }
        execFileSync("/usr/bin/tar", [
          "-xzf",
          resolved.archivePath,
          "-C",
          resolved.extractedSidecarRoot,
        ]);
        writeFileSync(resolved.stampPath, resolved.archiveStamp);
        break;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw error;
        }
        sleepSync(1000);
      }
    }

    return resolved.extractedSidecarRoot;
  };

  return {
    async materializePackagedOpenclawSidecar(args) {
      return materializePackagedOpenclawSidecarSync(args);
    },
    materializePackagedOpenclawSidecarSync,
  };
}

export function createAsyncArchiveSidecarMaterializer(): DesktopSidecarMaterializer {
  return {
    async materializePackagedOpenclawSidecar(args) {
      const resolved = resolveSidecarPaths(args);
      if (!existsSync(resolved.archivePath)) {
        return resolved.packagedSidecarRoot;
      }

      if (
        existsSync(resolved.stampPath) &&
        existsSync(resolved.extractedOpenclawEntry) &&
        readFileSync(resolved.stampPath, "utf8") === resolved.archiveStamp
      ) {
        return resolved.extractedSidecarRoot;
      }

      const tempExtractedSidecarRoot = path.resolve(
        args.runtimeRoot,
        "openclaw-sidecar.extracting",
      );
      await rm(tempExtractedSidecarRoot, { recursive: true, force: true });
      await mkdir(tempExtractedSidecarRoot, { recursive: true });

      if (
        !resolved.archiveMetadata ||
        resolved.archiveMetadata.format === "tar.gz"
      ) {
        // execFileAsync (not execFileSync) so the main process event loop
        // is not blocked while tar runs. The tar archive is ~tens of MB and
        // takes ~14s on first install / post-update; blocking the event
        // loop here means the renderer cannot finish loading dist/index.html
        // (preload IPC handshake stalls), so the setup-animation video
        // does not start playing until extraction completes. With the
        // event loop free, the renderer mounts in seconds and the video
        // plays in parallel with extraction.
        await execFileAsync("/usr/bin/tar", [
          "-xzf",
          resolved.archivePath,
          "-C",
          tempExtractedSidecarRoot,
        ]);
      } else if (resolved.archiveMetadata.format === "zip") {
        await extractZipArchive(resolved.archivePath, tempExtractedSidecarRoot);
      } else {
        throw new Error(
          `Unsupported packaged archive format: ${resolved.archiveMetadata.format}`,
        );
      }

      if (platformFilesystem.shouldRestoreArchiveEntryMode()) {
        await chmod(
          path.resolve(tempExtractedSidecarRoot, "bin/openclaw"),
          0o755,
        ).catch(() => null);
      }

      await rm(resolved.extractedSidecarRoot, { recursive: true, force: true });
      await rename(tempExtractedSidecarRoot, resolved.extractedSidecarRoot);
      writeFileSync(resolved.stampPath, resolved.archiveStamp);

      return resolved.extractedSidecarRoot;
    },
  };
}
