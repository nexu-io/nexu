import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeSlimclawRuntimeStageFingerprint,
  getSlimclawRuntimeRoot,
  prepareSlimclawRuntimeStage,
  resolveSlimclawRuntimeArtifacts,
} from "@nexu/slimclaw";
import {
  electronRoot,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  repoRoot,
  resetDir,
  shouldCopyRuntimeDependencies,
} from "./lib/sidecar-paths.mjs";
import { resolveBuildTargetPlatform } from "./platforms/platform-resolver.mjs";

const openclawRuntimeRoot = getSlimclawRuntimeRoot(repoRoot);
const openclawRuntimeArtifacts = resolveSlimclawRuntimeArtifacts(
  openclawRuntimeRoot,
  { requirePrepared: false },
);
const openclawRuntimeNodeModules = resolve(openclawRuntimeRoot, "node_modules");
const openclawRoot = dirname(openclawRuntimeArtifacts.entryPath);
const buildCacheRoot = resolve(
  process.env.NEXU_DEV_CACHE_DIR ?? resolve(repoRoot, ".cache", "nexu-dev"),
);
const openclawSidecarCacheRoot = resolve(buildCacheRoot, "openclaw-sidecar");
const OPENCLAW_SIDECAR_CACHE_VERSION = "2026-04-08-openclaw-sidecar-signing-v3";
const OPENCLAW_SIDECAR_ARCHIVE_FORMAT =
  resolveBuildTargetPlatform({
    env: process.env,
    platform: process.platform,
  }) === "win"
    ? "zip"
    : "tar.gz";
const OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME =
  OPENCLAW_SIDECAR_ARCHIVE_FORMAT === "zip" ? "payload.zip" : "payload.tar.gz";
const sidecarRoot = getSidecarRoot("openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const packagedOpenclawEntry = resolve(
  sidecarNodeModules,
  "openclaw/openclaw.mjs",
);
const inheritEntitlementsPath = resolve(
  electronRoot,
  "build/entitlements.mac.inherit.plist",
);
const shouldArchiveOpenclawSidecar =
  process.env.NEXU_DESKTOP_ARCHIVE_OPENCLAW_SIDECAR !== "0" &&
  process.env.NEXU_DESKTOP_ARCHIVE_OPENCLAW_SIDECAR?.toLowerCase() !== "false";
const shouldDisableOpenclawSidecarCache =
  process.env.NEXU_DEV_DISABLE_CACHE === "1" ||
  process.env.NEXU_DEV_DISABLE_CACHE?.toLowerCase() === "true";
const shouldLogOpenclawSidecarProbes =
  process.env.NEXU_DESKTOP_SIDECAR_PROBES === "1" ||
  process.env.NEXU_DESKTOP_SIDECAR_PROBES?.toLowerCase() === "true";

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

async function timedStep(stepName, fn) {
  const startedAt = performance.now();
  console.log(`[openclaw-sidecar][timing] start ${stepName}`);
  try {
    return await fn();
  } finally {
    console.log(
      `[openclaw-sidecar][timing] done ${stepName} duration=${formatDurationMs(
        performance.now() - startedAt,
      )}`,
    );
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function runAndCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}. ${stderr}`,
        ),
      );
    });
  });
}

async function collectFiles(rootPath) {
  const files = [];
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function collectDirectoryStats(rootPath) {
  let fileCount = 0;
  let totalBytes = 0;
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      const childStats = await collectDirectoryStats(entryPath);
      fileCount += childStats.fileCount;
      totalBytes += childStats.totalBytes;
      continue;
    }

    if (entry.isFile()) {
      const entryStats = await stat(entryPath);
      fileCount += 1;
      totalBytes += entryStats.size;
    }
  }

  return { fileCount, totalBytes };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

async function hashFingerprintInputs({ files, values = [] }) {
  const hash = createHash("sha256");
  hash.update(`${OPENCLAW_SIDECAR_CACHE_VERSION}\n`);

  for (const value of values) {
    hash.update(`${value}\n`);
  }

  for (const filePath of [...files].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (!(await pathExists(filePath))) {
      continue;
    }

    hash.update(`${relative(repoRoot, filePath)}\n`);
    hash.update(await readFile(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function collectOpenclawSidecarFingerprintInputs() {
  return [
    resolve(openclawRuntimeRoot, ".postinstall-cache.json"),
    resolve(openclawRuntimeRoot, "package.json"),
    resolve(openclawRoot, "package.json"),
    resolve(electronRoot, "package.json"),
    fileURLToPath(import.meta.url),
    resolve(electronRoot, "scripts", "lib", "sidecar-paths.mjs"),
    resolve(electronRoot, "scripts", "platforms", "desktop-platform.mjs"),
    resolve(electronRoot, "scripts", "platforms", "platform-resolver.mjs"),
    resolve(electronRoot, "scripts", "platforms", "filesystem-compat.mjs"),
  ];
}

async function computeOpenclawSidecarFingerprint() {
  const [files, stageFingerprint] = await Promise.all([
    collectOpenclawSidecarFingerprintInputs(),
    computeSlimclawRuntimeStageFingerprint(),
  ]);

  return hashFingerprintInputs({
    files,
    values: [`slimclaw-stage:${stageFingerprint}`],
  });
}

function getOpenclawSidecarCacheEntryRoot(fingerprint) {
  return resolve(openclawSidecarCacheRoot, fingerprint);
}

async function tryRestoreCachedArchivedOpenclawSidecar(fingerprint) {
  if (shouldDisableOpenclawSidecarCache || !shouldArchiveOpenclawSidecar) {
    console.log(
      `[openclaw-sidecar][cache] bypass fingerprint=${fingerprint} disableCache=${shouldDisableOpenclawSidecarCache} archive=${shouldArchiveOpenclawSidecar}`,
    );
    return false;
  }

  const cacheEntryRoot = getOpenclawSidecarCacheEntryRoot(fingerprint);
  const cachedSidecarRoot = resolve(cacheEntryRoot, "sidecar");

  const archiveMetadataPath = resolve(cachedSidecarRoot, "archive.json");
  const cachedPackageJsonPath = resolve(cachedSidecarRoot, "package.json");
  const cacheManifestPath = resolve(cacheEntryRoot, "manifest.json");
  const hasArchiveMetadata = await pathExists(archiveMetadataPath);
  const hasCachedPackageJson = await pathExists(cachedPackageJsonPath);
  const hasCacheManifest = await pathExists(cacheManifestPath);

  if (!hasArchiveMetadata || !hasCachedPackageJson || !hasCacheManifest) {
    console.log(
      `[openclaw-sidecar][cache] miss fingerprint=${fingerprint} reason=incomplete-cache-entry root=${cacheEntryRoot} archiveJson=${hasArchiveMetadata} packageJson=${hasCachedPackageJson} manifest=${hasCacheManifest}`,
    );
    return false;
  }

  let archiveMetadata;
  try {
    archiveMetadata = JSON.parse(await readFile(archiveMetadataPath, "utf8"));
  } catch {
    console.log(
      `[openclaw-sidecar][cache] miss fingerprint=${fingerprint} reason=invalid-archive-metadata path=${archiveMetadataPath}`,
    );
    return false;
  }

  const archivePayloadPath =
    archiveMetadata && typeof archiveMetadata.path === "string"
      ? resolve(cachedSidecarRoot, archiveMetadata.path)
      : null;

  if (
    !archiveMetadata ||
    typeof archiveMetadata.path !== "string" ||
    !archivePayloadPath ||
    !(await pathExists(archivePayloadPath))
  ) {
    console.log(
      `[openclaw-sidecar][cache] miss fingerprint=${fingerprint} reason=missing-archive-payload path=${archivePayloadPath ?? "<invalid>"}`,
    );
    return false;
  }

  await resetDir(sidecarRoot);
  await cp(cachedSidecarRoot, sidecarRoot, {
    recursive: true,
    dereference: true,
  });
  console.log(
    `[openclaw-sidecar][cache] hit fingerprint=${fingerprint} source=${cacheEntryRoot}`,
  );
  return true;
}

async function writeOpenclawSidecarCacheEntry(fingerprint) {
  if (shouldDisableOpenclawSidecarCache || !shouldArchiveOpenclawSidecar) {
    return;
  }

  const cacheEntryRoot = getOpenclawSidecarCacheEntryRoot(fingerprint);
  const cacheStageRoot = resolve(
    openclawSidecarCacheRoot,
    `.stage-${fingerprint}`,
  );
  const payloadPath = resolve(sidecarRoot, OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME);
  const payloadStats = await stat(payloadPath);

  await removePathIfExists(cacheStageRoot);
  await mkdir(cacheStageRoot, { recursive: true });
  const cacheSidecarRoot = resolve(cacheStageRoot, "sidecar");
  await mkdir(cacheSidecarRoot, { recursive: true });
  await Promise.all([
    cp(
      resolve(sidecarRoot, "archive.json"),
      resolve(cacheSidecarRoot, "archive.json"),
    ),
    cp(
      resolve(sidecarRoot, "package.json"),
      resolve(cacheSidecarRoot, "package.json"),
    ),
    cp(
      payloadPath,
      resolve(cacheSidecarRoot, OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME),
    ),
  ]);
  await writeFile(
    resolve(cacheStageRoot, "manifest.json"),
    `${JSON.stringify(
      {
        fingerprint,
        format: OPENCLAW_SIDECAR_ARCHIVE_FORMAT,
        payloadBytes: payloadStats.size,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  await removePathIfExists(cacheEntryRoot);
  await rename(cacheStageRoot, cacheEntryRoot);
  console.log(
    `[openclaw-sidecar][cache] stored fingerprint=${fingerprint} payload=${formatBytes(payloadStats.size)}`,
  );
}

async function resolve7ZipCommand() {
  const candidates =
    process.platform === "win32" ? ["7z.exe", "7z"] : ["7zz", "7z"];

  for (const candidate of candidates) {
    try {
      await runAndCapture(candidate, ["i"]);
      return candidate;
    } catch {}
  }

  return null;
}

async function createOpenclawSidecarArchive(archivePath) {
  if (OPENCLAW_SIDECAR_ARCHIVE_FORMAT === "zip") {
    const sevenZipCommand = await resolve7ZipCommand();

    if (sevenZipCommand) {
      await run(sevenZipCommand, ["a", "-tzip", "-mx=1", archivePath, "."], {
        cwd: sidecarRoot,
      });
      return;
    }

    const quotedSidecarRoot = sidecarRoot.replace(/'/gu, "''");
    const quotedArchivePath = archivePath.replace(/'/gu, "''");
    await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName 'System.IO.Compression.FileSystem'; if (Test-Path -LiteralPath '${quotedArchivePath}') { Remove-Item -LiteralPath '${quotedArchivePath}' -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory('${quotedSidecarRoot}', '${quotedArchivePath}', [System.IO.Compression.CompressionLevel]::Fastest, $false)`,
    ]);
    return;
  }

  await run("tar", ["-czf", archivePath, "-C", sidecarRoot, "."]);
}

async function resolveCodesignIdentity() {
  const { stdout } = await runAndCapture("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const identityLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.includes("Developer ID Application:"));

  if (!identityLine) {
    throw new Error(
      "Unable to locate a Developer ID Application signing identity.",
    );
  }

  const match = identityLine.match(/"([^"]+)"/u);
  if (!match) {
    throw new Error(`Unable to parse signing identity from: ${identityLine}`);
  }

  return match[1];
}

function getSigningCertificatePath() {
  const link = process.env.CSC_LINK;

  if (!link) {
    return null;
  }

  return link.startsWith("file://") ? fileURLToPath(link) : link;
}

async function ensureCodesignIdentity() {
  try {
    return await resolveCodesignIdentity();
  } catch {
    const certificatePath = getSigningCertificatePath();
    const certificatePassword = process.env.CSC_KEY_PASSWORD;

    if (!certificatePath || !certificatePassword) {
      throw new Error(
        "Unable to locate a Developer ID Application signing identity.",
      );
    }

    const keychainPath = resolve(tmpdir(), "nexu-openclaw-signing.keychain-db");
    const keychainPassword = "nexu-openclaw-signing";

    await run("security", [
      "create-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]).catch(() => null);
    await run("security", [
      "set-keychain-settings",
      "-lut",
      "21600",
      keychainPath,
    ]);
    await run("security", [
      "unlock-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]);
    await run("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    await run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath,
    ]);

    const { stdout: keychainsOutput } = await runAndCapture("security", [
      "list-keychains",
      "-d",
      "user",
    ]);
    const keychains = keychainsOutput
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^"|"$/gu, ""))
      .filter(Boolean);
    if (!keychains.includes(keychainPath)) {
      await run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        keychainPath,
        ...keychains,
      ]);
    }

    return await resolveCodesignIdentity();
  }
}

async function signOpenclawNativeBinaries() {
  if (
    resolveBuildTargetPlatform({
      env: process.env,
      platform: process.platform,
    }) !== "mac"
  ) {
    return;
  }

  const unsignedMode =
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "true";

  if (unsignedMode || !shouldCopyRuntimeDependencies()) {
    return;
  }

  const startedAt = Date.now();
  const identity = await ensureCodesignIdentity();
  const files = await collectFiles(sidecarRoot);
  const candidateFiles = files.filter((filePath) => {
    const baseName = basename(filePath);
    return (
      baseName.endsWith(".node") ||
      baseName.endsWith(".dylib") ||
      baseName === "spawn-helper"
    );
  });
  let signedCount = 0;

  console.log(
    `[openclaw-sidecar] scanning ${candidateFiles.length} native-binary candidates out of ${files.length} files`,
  );

  for (const filePath of candidateFiles) {
    const { stdout } = await runAndCapture("file", ["-b", filePath]);
    const description = stdout.trim();

    const isExecutable =
      description.includes("executable") || description.includes("bundle");
    const args = [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      "--entitlements",
      inheritEntitlementsPath,
      ...(isExecutable ? ["--options", "runtime"] : []),
      filePath,
    ];
    console.log(
      `[openclaw-sidecar] codesigning native binary: ${relative(sidecarRoot, filePath)} (${description})`,
    );
    await run("codesign", args);
    signedCount += 1;
  }

  console.log(
    `[openclaw-sidecar] signed ${signedCount} native binaries in ${formatDurationMs(
      Date.now() - startedAt,
    )}`,
  );
}

async function stagePatchedOpenclawPackage() {
  await mkdir(dirname(sidecarRoot), { recursive: true });
  const stageRoot = await mkdtemp(
    resolve(dirname(sidecarRoot), ".openclaw-package-stage-"),
  );
  const stageTargetRoot = resolve(stageRoot, "prepared-openclaw");
  const stageResult = await prepareSlimclawRuntimeStage({
    targetStageRoot: stageTargetRoot,
    log: (message) => console.log(message),
  });

  console.log(
    `[openclaw-sidecar] staged transactional OpenClaw package with ${stageResult.patchedFileCount} patched file(s)`,
  );

  return {
    stageRoot,
    stagedOpenclawRoot: stageResult.stagedOpenclawRoot,
  };
}

async function prepareOpenclawSidecar() {
  if (!(await pathExists(openclawRoot))) {
    throw new Error(
      `OpenClaw runtime dependency not found at ${openclawRoot}. Run pnpm slimclaw:prepare first.`,
    );
  }

  const cacheFingerprint = await timedStep(
    "compute sidecar cache fingerprint",
    async () => computeOpenclawSidecarFingerprint(),
  );

  if (await tryRestoreCachedArchivedOpenclawSidecar(cacheFingerprint)) {
    return;
  }

  await timedStep("reset sidecar root", async () => {
    await resetDir(sidecarRoot);
    await mkdir(sidecarBinDir, { recursive: true });
  });
  const { stageRoot, stagedOpenclawRoot } = await timedStep(
    "stage patched openclaw package",
    async () => stagePatchedOpenclawPackage(),
  );
  try {
    await timedStep("copy openclaw runtime node_modules", async () => {
      await linkOrCopyDirectory(
        openclawRuntimeNodeModules,
        sidecarNodeModules,
        {
          excludeNames: ["openclaw"],
        },
      );
      await rename(stagedOpenclawRoot, resolve(sidecarNodeModules, "openclaw"));
      if (shouldLogOpenclawSidecarProbes) {
        const copyStats = await collectDirectoryStats(sidecarNodeModules);
        console.log(
          `[openclaw-sidecar][probe] node_modules files=${copyStats.fileCount} bytes=${copyStats.totalBytes} (${formatBytes(copyStats.totalBytes)})`,
        );
      }
    });
  } finally {
    await removePathIfExists(stageRoot);
  }

  await removePathIfExists(resolve(sidecarNodeModules, "electron"));
  await removePathIfExists(resolve(sidecarNodeModules, "electron-builder"));
  await chmod(packagedOpenclawEntry, 0o755).catch(() => null);
  await writeFile(
    resolve(sidecarRoot, "package.json"),
    '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
  );
  await writeFile(
    resolve(sidecarRoot, "metadata.json"),
    `${JSON.stringify(
      {
        strategy: "sidecar-node-modules",
        openclawEntry: packagedOpenclawEntry,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(sidecarBinDir, "openclaw.cmd"),
    `@echo off\r\nnode "${packagedOpenclawEntry}" %*\r\n`,
  );

  const wrapperPath = resolve(sidecarBinDir, "openclaw");
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu

case "$0" in
  */*) script_parent="\${0%/*}" ;;
  *) script_parent="." ;;
esac

script_dir="$(CDPATH= cd -- "$script_parent" && pwd)"
sidecar_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
entry="$sidecar_root/node_modules/openclaw/openclaw.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$entry" "$@"
fi

if [ -n "\${OPENCLAW_ELECTRON_EXECUTABLE:-}" ] && [ -x "$OPENCLAW_ELECTRON_EXECUTABLE" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$OPENCLAW_ELECTRON_EXECUTABLE" "$entry" "$@"
fi

contents_dir="$(CDPATH= cd -- "$sidecar_root/../../.." && pwd)"
macos_dir="$contents_dir/MacOS"

if [ -d "$macos_dir" ]; then
  for candidate in "$macos_dir"/*; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      ELECTRON_RUN_AS_NODE=1 exec "$candidate" "$entry" "$@"
    fi
  done
fi

echo "openclaw launcher could not find node or a bundled Electron executable" >&2
exit 127
`,
  );
  await chmod(wrapperPath, 0o755);
  await timedStep("sign native binaries", async () =>
    signOpenclawNativeBinaries(),
  );

  if (shouldCopyRuntimeDependencies() && shouldArchiveOpenclawSidecar) {
    const archivePath = resolve(
      dirname(sidecarRoot),
      `openclaw-sidecar.${OPENCLAW_SIDECAR_ARCHIVE_FORMAT}`,
    );
    await timedStep("archive openclaw sidecar", async () => {
      await removePathIfExists(archivePath);
      let preArchiveStats = null;
      if (shouldLogOpenclawSidecarProbes) {
        preArchiveStats = await collectDirectoryStats(sidecarRoot);
        console.log(
          `[openclaw-sidecar][probe] pre-archive files=${preArchiveStats.fileCount} bytes=${preArchiveStats.totalBytes} (${formatBytes(preArchiveStats.totalBytes)})`,
        );
      }
      await createOpenclawSidecarArchive(archivePath);
      if (shouldLogOpenclawSidecarProbes) {
        const archiveStats = await stat(archivePath);
        console.log(
          `[openclaw-sidecar][probe] archive bytes=${archiveStats.size} (${formatBytes(archiveStats.size)}) ratio=${(archiveStats.size / Math.max(preArchiveStats?.totalBytes ?? 1, 1)).toFixed(3)}`,
        );
      }
      await resetDir(sidecarRoot);
      await writeFile(
        resolve(sidecarRoot, "archive.json"),
        `${JSON.stringify(
          {
            format: OPENCLAW_SIDECAR_ARCHIVE_FORMAT,
            path: OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME,
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        resolve(sidecarRoot, "package.json"),
        '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
      );
      await rename(
        archivePath,
        resolve(sidecarRoot, OPENCLAW_SIDECAR_ARCHIVE_FILE_NAME),
      );
      await writeOpenclawSidecarCacheEntry(cacheFingerprint);
    });
  } else if (shouldCopyRuntimeDependencies()) {
    console.log(
      "[openclaw-sidecar] skipping archive packaging for fast CI mode",
    );
  }
}

await prepareOpenclawSidecar();
