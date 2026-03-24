import { execFileSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { app, dialog } from "electron";
import type { DesktopRuntimeConfig } from "../shared/runtime-config";
import { getDesktopDiagnosticsFilePath } from "./desktop-diagnostics";
import { redactJsonValue, scrubUrlTokens } from "./redaction";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";

export type DiagnosticsExportResult = {
  status: "success" | "cancelled" | "failed";
  outputPath?: string;
  warnings?: string[];
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Minimal ZIP writer (deflate compression via Node built-in zlib)
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt16LE(value, offset);
}

function writeUint32LE(buf: Buffer, offset: number, value: number): void {
  buf.writeUInt32LE(value >>> 0, offset);
}

type ZipFileEntry = {
  name: string;
  data: Buffer;
  modTime?: Date;
};

type CollectedFileMetadata = {
  sourcePath: string;
  archivePath: string;
  sizeBytes: number;
  modifiedAt: string;
};

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

async function writeZip(
  entries: ZipFileEntry[],
  outputPath: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  const centralDirEntries: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const dataLen = entry.data.length;
    const crc = crc32(entry.data);

    // Local file header (30 bytes + name)
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const compressedLen = compressed.length;
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    const { dosTime, dosDate } = toDosDateTime(entry.modTime ?? new Date());
    writeUint32LE(localHeader, 0, 0x04034b50); // signature
    writeUint16LE(localHeader, 4, 20); // version needed
    writeUint16LE(localHeader, 6, 0); // flags
    writeUint16LE(localHeader, 8, 8); // compression: deflate
    writeUint16LE(localHeader, 10, dosTime); // mod time
    writeUint16LE(localHeader, 12, dosDate); // mod date
    writeUint32LE(localHeader, 14, crc);
    writeUint32LE(localHeader, 18, compressedLen); // compressed size
    writeUint32LE(localHeader, 22, dataLen); // uncompressed size
    writeUint16LE(localHeader, 26, nameBytes.length);
    writeUint16LE(localHeader, 28, 0); // extra length
    nameBytes.copy(localHeader, 30);

    // Central directory record (46 bytes + name)
    const centralRecord = Buffer.alloc(46 + nameBytes.length);
    writeUint32LE(centralRecord, 0, 0x02014b50); // signature
    writeUint16LE(centralRecord, 4, 20); // version made by
    writeUint16LE(centralRecord, 6, 20); // version needed
    writeUint16LE(centralRecord, 8, 0); // flags
    writeUint16LE(centralRecord, 10, 8); // compression: deflate
    writeUint16LE(centralRecord, 12, dosTime); // mod time
    writeUint16LE(centralRecord, 14, dosDate); // mod date
    writeUint32LE(centralRecord, 16, crc);
    writeUint32LE(centralRecord, 20, compressedLen); // compressed size
    writeUint32LE(centralRecord, 24, dataLen); // uncompressed size
    writeUint16LE(centralRecord, 28, nameBytes.length);
    writeUint16LE(centralRecord, 30, 0); // extra length
    writeUint16LE(centralRecord, 32, 0); // comment length
    writeUint16LE(centralRecord, 34, 0); // disk number start
    writeUint16LE(centralRecord, 36, 0); // internal attrs
    writeUint32LE(centralRecord, 38, 0); // external attrs
    writeUint32LE(centralRecord, 42, offset); // local header offset
    nameBytes.copy(centralRecord, 46);

    chunks.push(localHeader, compressed);
    centralDirEntries.push(centralRecord);

    offset += localHeader.length + compressedLen;
  }

  const centralDirBuffer = Buffer.concat(centralDirEntries);
  const centralDirSize = centralDirBuffer.length;
  const centralDirOffset = offset;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  writeUint32LE(eocd, 0, 0x06054b50); // signature
  writeUint16LE(eocd, 4, 0); // disk number
  writeUint16LE(eocd, 6, 0); // central dir start disk
  writeUint16LE(eocd, 8, entries.length); // entries on disk
  writeUint16LE(eocd, 10, entries.length); // total entries
  writeUint32LE(eocd, 12, centralDirSize);
  writeUint32LE(eocd, 16, centralDirOffset);
  writeUint16LE(eocd, 20, 0); // comment length

  const zipData = Buffer.concat([...chunks, centralDirBuffer, eocd]);
  await writeFile(outputPath, zipData);
}

function scrubTextBuffer(raw: Buffer): Buffer {
  const text = raw.toString("utf8");
  return Buffer.from(scrubUrlTokens(text), "utf8");
}

function redactJsonBuffer(raw: Buffer): Buffer {
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    const redacted = redactJsonValue(parsed) as object;
    return Buffer.from(`${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  } catch {
    // Not valid JSON — return as-is
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Artifact collection
// ---------------------------------------------------------------------------

async function tryReadFile(
  filePath: string,
): Promise<{ data: Buffer; mtime: Date } | null> {
  try {
    await access(filePath);
    const [data, fileStat] = await Promise.all([
      readFile(filePath),
      stat(filePath),
    ]);
    return { data, mtime: fileStat.mtime };
  } catch {
    return null;
  }
}

async function listFilesInDirectory(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => resolve(directoryPath, entry.name));
  } catch {
    return [];
  }
}

async function listFilesRecursive(directoryPath: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const nextPath = resolve(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(nextPath);
          return;
        }
        if (entry.isFile()) {
          output.push(nextPath);
        }
      }),
    );
  }

  await walk(directoryPath);
  return output;
}

function readMacOsProductVersion(): string | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const output = execFileSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function getTimestampSlug(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const tz = `${sign}${pad(Math.floor(absMin / 60))}${pad(absMin % 60)}`;
  return `${date}T${time}${tz}`;
}

async function collectArtifacts(
  orchestrator: RuntimeOrchestrator,
  runtimeConfig: DesktopRuntimeConfig,
  archiveRoot: string,
): Promise<{ entries: ZipFileEntry[]; warnings: string[] }> {
  const entries: ZipFileEntry[] = [];
  const included: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  const additionalArtifacts = {
    startupHealth: null as CollectedFileMetadata | null,
    openclawLogs: [] as CollectedFileMetadata[],
    sentryFiles: [] as CollectedFileMetadata[],
    crashReports: [] as CollectedFileMetadata[],
    sentrySkippedNonJson: [] as string[],
  };

  async function addFile(
    zipPath: string,
    filePath: string,
    {
      redact = false,
      scrubLog = false,
    }: { redact?: boolean; scrubLog?: boolean } = {},
  ): Promise<CollectedFileMetadata | null> {
    const result = await tryReadFile(filePath);
    if (result === null) {
      missing.push(zipPath);
      return null;
    }
    let { data } = result;
    if (redact) data = redactJsonBuffer(data);
    if (scrubLog) data = scrubTextBuffer(data);
    entries.push({
      name: `${archiveRoot}/${zipPath}`,
      data,
      modTime: result.mtime,
    });
    included.push(zipPath);
    return {
      sourcePath: filePath,
      archivePath: zipPath,
      sizeBytes: data.length,
      modifiedAt: result.mtime.toISOString(),
    };
  }

  // Desktop diagnostics snapshot
  await addFile(
    "diagnostics/desktop-diagnostics.json",
    getDesktopDiagnosticsFilePath(),
    {
      redact: true,
    },
  );

  // Main process logs
  const logsDir = resolve(app.getPath("userData"), "logs");
  await addFile("logs/cold-start.log", resolve(logsDir, "cold-start.log"), {
    scrubLog: true,
  });
  await addFile("logs/desktop-main.log", resolve(logsDir, "desktop-main.log"), {
    scrubLog: true,
  });

  // Runtime unit logs (skip embedded units — they have no subprocess log file)
  const runtimeState = orchestrator.getRuntimeState();
  for (const unit of runtimeState.units) {
    if (unit.logFilePath && unit.launchStrategy !== "embedded") {
      await addFile(`logs/runtime-units/${unit.id}.log`, unit.logFilePath, {
        scrubLog: true,
      });
    }
  }

  // OpenClaw config (derived from userData path, same logic as manifests.ts)
  const openclawConfigPath = resolve(
    app.getPath("userData"),
    "runtime/openclaw/config/openclaw.json",
  );
  await addFile("config/openclaw.json", openclawConfigPath, { redact: true });

  // Startup health state (updater rollback diagnostics)
  additionalArtifacts.startupHealth = await addFile(
    "diagnostics/startup-health.json",
    resolve(app.getPath("userData"), "startup-health.json"),
    {
      redact: true,
    },
  );

  // OpenClaw runtime logs from /tmp/openclaw
  const openclawLogsDir = "/tmp/openclaw";
  const openclawLogFiles = (await listFilesInDirectory(openclawLogsDir))
    .filter((filePath) => /^openclaw-.*\.log$/i.test(basename(filePath)))
    .sort();

  for (const openclawLogPath of openclawLogFiles) {
    const metadata = await addFile(
      `logs/openclaw/${basename(openclawLogPath)}`,
      openclawLogPath,
      {
        scrubLog: true,
      },
    );
    if (metadata) {
      additionalArtifacts.openclawLogs.push(metadata);
    }
  }

  // Sentry local data under userData/sentry (JSON files only)
  const sentryDir = resolve(app.getPath("userData"), "sentry");
  const sentryFiles = (await listFilesRecursive(sentryDir)).sort();

  for (const sentryFilePath of sentryFiles) {
    const fileName = sentryFilePath.slice(sentryDir.length + 1);
    const isJsonLike = /\.(json|jsonl)$/i.test(fileName);

    if (!isJsonLike) {
      additionalArtifacts.sentrySkippedNonJson.push(fileName);
      continue;
    }

    const metadata = await addFile(
      `diagnostics/sentry/${fileName}`,
      sentryFilePath,
      {
        redact: true,
      },
    );
    if (metadata) {
      additionalArtifacts.sentryFiles.push(metadata);
    }
  }

  // Crash reports (last 7 days, file name contains "exu")
  const crashReportsDir = resolve(homedir(), "Library/Logs/DiagnosticReports");
  const crashCandidateFiles = (
    await listFilesInDirectory(crashReportsDir)
  ).sort();
  const crashCutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const crashFilePath of crashCandidateFiles) {
    const reportName = basename(crashFilePath);
    if (!reportName.toLowerCase().includes("exu")) {
      continue;
    }

    const crashStat = await stat(crashFilePath).catch(() => null);
    if (crashStat === null || crashStat.mtimeMs < crashCutoffMs) {
      continue;
    }

    const crashFile = await tryReadFile(crashFilePath);
    if (crashFile === null) {
      continue;
    }

    const crashJson = {
      sourcePath: crashFilePath,
      fileName: reportName,
      modifiedAt: crashStat.mtime.toISOString(),
      sizeBytes: crashStat.size,
      content: scrubTextBuffer(crashFile.data).toString("utf8"),
    };

    const archivePath = `diagnostics/crashes/${reportName}.json`;
    entries.push({
      name: `${archiveRoot}/${archivePath}`,
      data: Buffer.from(`${JSON.stringify(crashJson, null, 2)}\n`, "utf8"),
      modTime: crashStat.mtime,
    });
    included.push(archivePath);
    additionalArtifacts.crashReports.push({
      sourcePath: crashFilePath,
      archivePath,
      sizeBytes: crashStat.size,
      modifiedAt: crashStat.mtime.toISOString(),
    });
  }

  // Environment summary (safe metadata only)
  const envSummary = buildEnvironmentSummary(runtimeConfig);
  const now = new Date();
  entries.push({
    name: `${archiveRoot}/summary/environment-summary.json`,
    data: Buffer.from(`${JSON.stringify(envSummary, null, 2)}\n`, "utf8"),
    modTime: now,
  });
  included.push("summary/environment-summary.json");

  const extraArtifactsSummary = {
    startupHealth: additionalArtifacts.startupHealth,
    openclawLogs: additionalArtifacts.openclawLogs,
    sentryFiles: additionalArtifacts.sentryFiles,
    sentrySkippedNonJson: additionalArtifacts.sentrySkippedNonJson,
    crashReports: additionalArtifacts.crashReports,
  };
  entries.push({
    name: `${archiveRoot}/summary/additional-artifacts.json`,
    data: Buffer.from(
      `${JSON.stringify(extraArtifactsSummary, null, 2)}\n`,
      "utf8",
    ),
    modTime: now,
  });
  included.push("summary/additional-artifacts.json");

  // Manifest
  const manifest = {
    exportedAt: now.toISOString(),
    appVersion: app.getVersion(),
    included,
    missing,
    warnings,
    redactionNote:
      "JSON files have had fields matching token/password/secret/key/dsn patterns redacted. " +
      "Log and JSON string values have had URL-embedded tokens (e.g. #token=, ?token=) scrubbed.",
  };
  entries.push({
    name: `${archiveRoot}/summary/manifest.json`,
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    modTime: now,
  });

  if (missing.length > 0) {
    warnings.push(`${missing.length} file(s) were not found and were skipped.`);
  }

  return { entries, warnings };
}

function buildEnvironmentSummary(runtimeConfig: DesktopRuntimeConfig): object {
  return {
    buildInfo: runtimeConfig.buildInfo,
    platform: process.platform,
    arch: process.arch,
    hostName: hostname(),
    osVersion: readMacOsProductVersion(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    logPath: app.getPath("logs"),
    userDataPath: app.getPath("userData"),
    // Omit tokens, passwords, DSN — those are redacted from other artifacts
    ports: runtimeConfig.ports,
    urls: {
      controllerBase: runtimeConfig.urls.controllerBase,
      web: runtimeConfig.urls.web,
      openclawBase: runtimeConfig.urls.openclawBase,
    },
    nexuHome: runtimeConfig.paths.nexuHome,
  };
}

// ---------------------------------------------------------------------------
// Main export entry point
// ---------------------------------------------------------------------------

export async function exportDiagnostics({
  orchestrator,
  runtimeConfig,
  source: _source,
}: {
  orchestrator: RuntimeOrchestrator;
  runtimeConfig: DesktopRuntimeConfig;
  source: "diagnostics-page" | "help-menu";
}): Promise<DiagnosticsExportResult> {
  const defaultFilename = `nexu-diagnostics-${getTimestampSlug()}.zip`;
  const defaultArchiveRoot = defaultFilename.replace(/\.zip$/i, "");

  let filePath: string | undefined;
  try {
    const result = await dialog.showSaveDialog({
      title: "Export Diagnostics",
      defaultPath: defaultFilename,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });

    if (result.canceled || !result.filePath) {
      return { status: "cancelled" };
    }

    filePath = result.filePath;
  } catch (error) {
    return {
      status: "failed",
      errorMessage:
        error instanceof Error ? error.message : "Save dialog failed.",
    };
  }

  try {
    const archiveRoot =
      filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.zip$/i, "") || defaultArchiveRoot;
    const { entries, warnings } = await collectArtifacts(
      orchestrator,
      runtimeConfig,
      archiveRoot,
    );

    await writeZip(entries, filePath);

    return { status: "success", outputPath: filePath, warnings };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Export failed.",
    };
  }
}
