import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(scriptDir, "..");
const repoRoot = resolve(electronRoot, "../..");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[generate-win-update-manifest] missing ${name}`);
  }
  return value;
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const version = requireEnv("VERSION");
  const channel = requireEnv("CHANNEL");
  const baseUrl = requireEnv("BASE_URL").replace(/\/$/, "");
  const installerFile = requireEnv("INSTALLER_FILE");
  const manifestOutput = requireEnv("MANIFEST_OUTPUT");
  const releaseNotes = process.env.RELEASE_NOTES?.trim() || undefined;
  const notesUrl = process.env.NOTES_URL?.trim() || undefined;
  const releaseDate =
    process.env.RELEASE_DATE?.trim() || new Date().toISOString();

  const installerPath = resolve(repoRoot, installerFile);
  const manifestPath = resolve(repoRoot, manifestOutput);
  const installerStats = await stat(installerPath);
  const sha256 = await sha256File(installerPath);

  const manifest = {
    version,
    channel,
    platform: "win32",
    arch: "x64",
    releaseDate,
    ...(releaseNotes ? { releaseNotes } : {}),
    ...(notesUrl ? { notesUrl } : {}),
    installer: {
      url: `${baseUrl}/${installerFile.split(/[\\/]/).at(-1)}`,
      sha256,
      size: installerStats.size,
    },
  };

  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${manifestPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
