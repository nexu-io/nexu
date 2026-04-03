import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, posix, resolve } from "node:path";
import path from "node:path";
import { pipeline } from "node:stream/promises";

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

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50 MB

export type ZipImportResult = {
  readonly ok: boolean;
  readonly slug?: string;
  readonly error?: string;
};

function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}

export { MAX_ZIP_SIZE };

function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (entryPath.length === 0) {
    return true;
  }

  const normalizedSeparators = entryPath.replaceAll("\\", "/");
  if (
    normalizedSeparators.startsWith("/") ||
    normalizedSeparators.startsWith("\\") ||
    /^[A-Za-z]:/.test(normalizedSeparators)
  ) {
    return true;
  }

  const normalizedPath = posix.normalize(normalizedSeparators);
  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../")
  ) {
    return true;
  }

  return normalizedPath.length === 0;
}

async function readZipEntries(zipPath: string): Promise<string[]> {
  return new Promise<string[]>((resolveEntries, rejectEntries) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        rejectEntries(
          openError ?? new Error(`Unable to open zip archive ${zipPath}`),
        );
        return;
      }

      const entries: string[] = [];

      zipFile.once("error", (error) => {
        zipFile.close();
        rejectEntries(error);
      });
      zipFile.once("end", () => {
        zipFile.close();
        resolveEntries(entries);
      });
      zipFile.on("entry", (entry) => {
        if (entry.fileName) {
          entries.push(entry.fileName);
        }
        zipFile.readEntry();
      });

      zipFile.readEntry();
    });
  });
}

async function extractZipToDir(
  zipPath: string,
  destDir: string,
): Promise<void> {
  await new Promise<void>((resolveExtract, rejectExtract) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        rejectExtract(
          openError ?? new Error(`Unable to open zip archive ${zipPath}`),
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

          if (isUnsafeZipEntryPath(normalizedPath)) {
            throw new Error(
              `Refusing to extract unsafe path: ${entry.fileName}`,
            );
          }

          const destinationPath = resolve(destDir, normalizedPath);

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

export async function importSkillZip(
  zipBuffer: Buffer,
  skillsDir: string,
): Promise<ZipImportResult> {
  if (zipBuffer.length > MAX_ZIP_SIZE) {
    return {
      ok: false,
      error: `Zip file too large (max ${MAX_ZIP_SIZE / 1024 / 1024} MB)`,
    };
  }

  const stagingDir = resolve(skillsDir, ".import-staging");

  try {
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    const zipPath = resolve(stagingDir, "upload.zip");
    writeFileSync(zipPath, zipBuffer);
    const zipEntries = await readZipEntries(zipPath);
    if (zipEntries.some(isUnsafeZipEntryPath)) {
      return {
        ok: false,
        error: "Zip contains unsafe paths",
      };
    }
    await extractZipToDir(zipPath, stagingDir);

    // Validate no files escaped staging dir (zip-slip defense)
    const normalizedStaging = stagingDir.endsWith("/")
      ? stagingDir
      : `${stagingDir}/`;
    for (const entry of readdirSync(stagingDir, {
      withFileTypes: true,
      recursive: true,
    })) {
      const entryPath = resolve(entry.parentPath ?? stagingDir, entry.name);
      if (
        !entryPath.startsWith(normalizedStaging) &&
        entryPath !== stagingDir
      ) {
        return {
          ok: false,
          error: "Zip contains paths outside the extraction directory",
        };
      }
    }

    const entries = readdirSync(stagingDir, { withFileTypes: true }).filter(
      (e) => e.name !== "upload.zip" && !e.name.startsWith("."),
    );

    let skillRoot = stagingDir;
    const firstEntry = entries[0];
    if (
      entries.length === 1 &&
      firstEntry &&
      firstEntry.isDirectory() &&
      existsSync(resolve(stagingDir, firstEntry.name, "SKILL.md"))
    ) {
      skillRoot = resolve(stagingDir, firstEntry.name);
    }

    if (!existsSync(resolve(skillRoot, "SKILL.md"))) {
      return { ok: false, error: "Zip must contain a SKILL.md at its root" };
    }

    // Derive and validate slug
    let slug =
      skillRoot === stagingDir
        ? `custom-skill-${Date.now()}`
        : basename(skillRoot);

    if (!isValidSlug(slug)) {
      slug = slugify(slug);
    }

    if (!slug || !isValidSlug(slug)) {
      return {
        ok: false,
        error: "Could not derive a valid slug from the zip content",
      };
    }

    const destDir = resolve(skillsDir, slug);
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
    }
    mkdirSync(destDir, { recursive: true });

    cpSync(skillRoot, destDir, { recursive: true });

    return { ok: true, slug };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Zip import failed: ${message}` };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
