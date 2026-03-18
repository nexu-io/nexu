import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const docsDir = path.resolve(__dirname, "..");
export const assetsDir = path.join(docsDir, "public", "assets");

const supportedSourceExtensions = new Set([".png", ".jpg", ".jpeg"]);
const passthroughExtensions = new Set([".webp", ".gif"]);
const markdownIncludePattern = /\.md$/;

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }

      return [entryPath];
    }),
  );

  return files.flat();
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

async function loadMarkdownFiles() {
  const allFiles = await listFiles(docsDir);
  const markdownFiles = allFiles.filter((filePath) =>
    markdownIncludePattern.test(filePath),
  );

  const docs = await Promise.all(
    markdownFiles.map(async (filePath) => ({
      filePath,
      content: await fs.readFile(filePath, "utf8"),
    })),
  );

  return new Map(docs.map((doc) => [doc.filePath, doc.content]));
}

async function writeMarkdownFiles(markdownFiles) {
  await Promise.all(
    [...markdownFiles.entries()].map(async ([filePath, content]) => {
      await fs.writeFile(filePath, content, "utf8");
    }),
  );
}

async function ensureAssetsDirExists() {
  const stats = await fs.stat(assetsDir);

  if (!stats.isDirectory()) {
    throw new Error(`Expected assets directory at ${assetsDir}`);
  }
}

async function convertAsset(sourcePath, targetPath) {
  await sharp(sourcePath)
    .rotate()
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toFile(targetPath);
}

function replaceMarkdownReferences(
  markdownFiles,
  sourceReference,
  targetReference,
) {
  let updatedFiles = 0;

  for (const [filePath, content] of markdownFiles.entries()) {
    if (!content.includes(sourceReference)) {
      continue;
    }

    markdownFiles.set(
      filePath,
      content.split(sourceReference).join(targetReference),
    );
    updatedFiles += 1;
  }

  return updatedFiles;
}

export function isRelevantAssetPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    supportedSourceExtensions.has(extension) ||
    passthroughExtensions.has(extension)
  );
}

export async function normalizeAssets({
  dryRun = false,
  log = console.log,
} = {}) {
  await ensureAssetsDirExists();

  const markdownFiles = await loadMarkdownFiles();
  const assetFiles = await listFiles(assetsDir);
  const conversionCandidates = assetFiles.filter((filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    return supportedSourceExtensions.has(extension);
  });
  const skippedFiles = assetFiles.filter((filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    return passthroughExtensions.has(extension);
  });

  let convertedCount = 0;
  let deletedCount = 0;
  let updatedMarkdownCount = 0;

  for (const sourcePath of conversionCandidates) {
    const sourceRelativePath = toPosixPath(
      path.relative(assetsDir, sourcePath),
    );
    const sourceReference = `/assets/${sourceRelativePath}`;
    const targetPath = sourcePath.replace(/\.[^.]+$/, ".webp");
    const targetRelativePath = toPosixPath(
      path.relative(assetsDir, targetPath),
    );
    const targetReference = `/assets/${targetRelativePath}`;
    const markdownUpdatesForAsset = replaceMarkdownReferences(
      markdownFiles,
      sourceReference,
      targetReference,
    );

    if (!dryRun) {
      await convertAsset(sourcePath, targetPath);
      await fs.unlink(sourcePath);
    }

    convertedCount += 1;
    deletedCount += 1;
    updatedMarkdownCount += markdownUpdatesForAsset;

    log(
      `${dryRun ? "[dry-run] " : ""}converted ${sourceRelativePath} -> ${targetRelativePath} (${markdownUpdatesForAsset} markdown file${markdownUpdatesForAsset === 1 ? "" : "s"})`,
    );
  }

  if (!dryRun) {
    await writeMarkdownFiles(markdownFiles);
  }

  log(
    `skipped ${skippedFiles.length} asset file${skippedFiles.length === 1 ? "" : "s"} already in webp/gif`,
  );
  log(
    `${dryRun ? "would convert" : "converted"} ${convertedCount} asset file${convertedCount === 1 ? "" : "s"}`,
  );
  log(
    `${dryRun ? "would update" : "updated"} ${updatedMarkdownCount} markdown reference${updatedMarkdownCount === 1 ? "" : "s"}`,
  );
  log(
    `${dryRun ? "would remove" : "removed"} ${deletedCount} original image file${deletedCount === 1 ? "" : "s"}`,
  );

  return {
    skippedCount: skippedFiles.length,
    convertedCount,
    updatedMarkdownCount,
    deletedCount,
  };
}
