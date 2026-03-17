import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import type { LevelWithSilent, Logger } from "pino";
import type { RuntimeLogEntry } from "../../shared/host";

const env = process.env.DD_ENV ?? process.env.NODE_ENV ?? "development";
const version =
  process.env.DD_VERSION ??
  process.env.COMMIT_HASH ??
  process.env.GIT_COMMIT_SHA ??
  process.env.npm_package_version;

class SafeConsoleStream extends Writable {
  override _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (process.stdout.destroyed || !process.stdout.writable) {
      callback(null);
      return;
    }

    process.stdout.write(chunk, encoding, (error) => {
      if (error) {
        const errorCode =
          error instanceof Error && "code" in error ? String(error.code) : null;
        if (errorCode === "EIO" || errorCode === "EPIPE") {
          callback(null);
          return;
        }
      }

      callback(error);
    });
  }
}

const runtimeConsoleLogger = pino(
  {
    level: process.env.LOG_LEVEL ?? (env === "production" ? "info" : "debug"),
    base: {
      service: "nexu-desktop",
      env,
      log_source: "desktop-runtime",
      ...(version ? { version } : {}),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  new SafeConsoleStream(),
);

const MAX_LOG_FILE_BYTES = 1_000_000;
const MAX_LOG_FILE_BACKUPS = 5;

const fileDestinations = new Map<string, BufferedRotatingFileStream>();
const fileLoggers = new Map<string, Logger>();

type DesktopMainLogKind = "lifecycle" | "probe" | "app";

type DesktopMainLogStream = "stdout" | "stderr" | "system";

type DesktopLogContext = {
  bootId: string;
  sessionId: string;
};

const desktopLogContext: DesktopLogContext = {
  bootId: randomUUID(),
  sessionId: randomUUID(),
};

function getDesktopLogContext(): DesktopLogContext {
  return {
    bootId: desktopLogContext.bootId,
    sessionId: desktopLogContext.sessionId,
  };
}

function buildContextPayload(windowId?: number | null) {
  const context = getDesktopLogContext();

  return {
    desktop_boot_id: context.bootId,
    desktop_session_id: context.sessionId,
    ...(typeof windowId === "number" ? { desktop_window_id: windowId } : {}),
  };
}

function getLevel(entry: RuntimeLogEntry): LevelWithSilent {
  if (entry.stream === "stderr") {
    return entry.kind === "lifecycle" ? "error" : "warn";
  }

  if (entry.kind === "probe") {
    return "debug";
  }

  return "info";
}

function getDesktopMainLevel({
  stream,
  kind,
}: {
  stream: DesktopMainLogStream;
  kind: DesktopMainLogKind;
}): LevelWithSilent {
  if (stream === "stderr") {
    return kind === "lifecycle" ? "error" : "warn";
  }

  if (kind === "probe") {
    return "debug";
  }

  return "info";
}

class BufferedRotatingFileStream extends Writable {
  private stream;

  private currentBytes;

  constructor(private readonly logFilePath: string) {
    super();
    this.stream = this.openStream();
    this.currentBytes = this.getExistingSize();
  }

  flushSync(): void {
    const fd = (this.stream as { fd?: number | null }).fd;
    if (typeof fd === "number") {
      try {
        fsyncSync(fd);
      } catch {
        // Best-effort flush only.
      }
    }
  }

  override _write(
    chunk: string | Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const size = Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk, encoding);

    try {
      if (
        this.currentBytes > 0 &&
        this.currentBytes + size > MAX_LOG_FILE_BYTES
      ) {
        this.rotateFiles();
      }
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    this.stream.write(chunk, encoding, (error) => {
      if (!error) {
        this.currentBytes += size;
      }
      callback(error);
    });
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.stream.end(callback);
  }

  private getExistingSize(): number {
    try {
      return existsSync(this.logFilePath) ? statSync(this.logFilePath).size : 0;
    } catch {
      return 0;
    }
  }

  private openStream() {
    mkdirSync(dirname(this.logFilePath), { recursive: true });
    return createWriteStream(this.logFilePath, {
      flags: "a",
      encoding: "utf8",
    });
  }

  private rotateFiles(): void {
    this.stream.end();

    for (let index = MAX_LOG_FILE_BACKUPS - 1; index >= 1; index -= 1) {
      const source = `${this.logFilePath}.${index}`;
      const destination = `${this.logFilePath}.${index + 1}`;

      if (!existsSync(source)) {
        continue;
      }

      if (index === MAX_LOG_FILE_BACKUPS - 1) {
        rmSync(destination, { force: true });
      }

      renameSync(source, destination);
    }

    if (existsSync(this.logFilePath)) {
      renameSync(this.logFilePath, `${this.logFilePath}.1`);
    }

    this.stream = this.openStream();
    this.currentBytes = 0;
  }
}

function getFileLogger(logFilePath: string): Logger {
  const existingLogger = fileLoggers.get(logFilePath);
  if (existingLogger) {
    return existingLogger;
  }

  mkdirSync(dirname(logFilePath), { recursive: true });

  const destination = new BufferedRotatingFileStream(logFilePath);
  const logger = pino(
    {
      level: process.env.LOG_LEVEL ?? (env === "production" ? "info" : "debug"),
      base: {
        service: "nexu-desktop",
        env,
        log_source: "desktop-runtime",
        ...(version ? { version } : {}),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );

  fileDestinations.set(logFilePath, destination);
  fileLoggers.set(logFilePath, logger);
  return logger;
}

export function writeRuntimeLogEntry(
  entry: RuntimeLogEntry,
  logFilePath: string | null,
): void {
  const level = getLevel(entry);
  const payload = {
    ...buildContextPayload(),
    runtime_unit_id: entry.unitId,
    runtime_log_id: entry.id,
    runtime_action_id: entry.actionId,
    runtime_log_kind: entry.kind,
    runtime_reason_code: entry.reasonCode,
    runtime_log_stream: entry.stream,
    runtime_log_ts: entry.ts,
  };

  runtimeConsoleLogger[level](payload, entry.message);

  if (!logFilePath) {
    return;
  }

  getFileLogger(logFilePath)[level](payload, entry.message);
}

export function writeDesktopMainLog({
  source,
  stream,
  kind,
  message,
  logFilePath,
  windowId,
}: {
  source: string;
  stream: DesktopMainLogStream;
  kind: DesktopMainLogKind;
  message: string;
  logFilePath: string | null;
  windowId?: number | null;
}): void {
  const level = getDesktopMainLevel({ stream, kind });
  const payload = {
    ...buildContextPayload(windowId),
    desktop_log_source: source,
    desktop_log_kind: kind,
    desktop_log_stream: stream,
  };

  runtimeConsoleLogger[level](payload, message);

  if (!logFilePath) {
    return;
  }

  getFileLogger(logFilePath)[level](payload, message);
}

export function rotateDesktopLogSession(): string {
  desktopLogContext.sessionId = randomUUID();
  return desktopLogContext.sessionId;
}

export function getCurrentDesktopLogContext(): DesktopLogContext {
  return getDesktopLogContext();
}

export function flushRuntimeLoggers(): void {
  for (const destination of fileDestinations.values()) {
    destination.flushSync();
  }
}
