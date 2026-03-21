import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, posix, resolve } from "node:path";

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

function readZipEntries(zipPath: string): string[] {
  const output = execFileSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function importSkillZip(
  zipBuffer: Buffer,
  skillsDir: string,
): ZipImportResult {
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
    const zipEntries = readZipEntries(zipPath);
    if (zipEntries.some(isUnsafeZipEntryPath)) {
      return {
        ok: false,
        error: "Zip contains unsafe paths",
      };
    }
    execFileSync("unzip", ["-o", zipPath, "-d", stagingDir]);

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

    execFileSync("cp", ["-R", `${skillRoot}/.`, destDir]);

    return { ok: true, slug };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Zip import failed: ${message}` };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
