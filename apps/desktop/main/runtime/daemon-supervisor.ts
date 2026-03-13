import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { Socket } from "node:net";
import { type UtilityProcess, utilityProcess } from "electron";
import type { RuntimeState, RuntimeUnitState } from "../../shared/host";
import type { RuntimeUnitManifest, RuntimeUnitRecord } from "./types";

const LOG_TAIL_LIMIT = 200;

function nowIso(): string {
  return new Date().toISOString();
}

export class RuntimeOrchestrator {
  private readonly startedAt = nowIso();

  private readonly units = new Map<string, RuntimeUnitRecord>();

  private readonly children = new Map<string, ManagedChildProcess>();

  constructor(manifests: RuntimeUnitManifest[]) {
    for (const manifest of manifests) {
      this.units.set(manifest.id, {
        manifest,
        phase:
          manifest.launchStrategy === "embedded"
            ? "running"
            : manifest.launchStrategy === "delegated"
              ? "stopped"
              : "idle",
        pid: null,
        startedAt:
          manifest.launchStrategy === "embedded" ? this.startedAt : null,
        exitedAt: null,
        exitCode: null,
        lastError: null,
        logTail:
          manifest.launchStrategy === "embedded"
            ? ["embedded runtime unit"]
            : [],
        stdoutRemainder: "",
        stderrRemainder: "",
      });
    }
  }

  getRuntimeState(): RuntimeState {
    this.refreshDelegatedUnits();

    return {
      startedAt: this.startedAt,
      units: Array.from(this.units.values()).map((record) =>
        this.toRuntimeUnitState(record),
      ),
    };
  }

  async startAutoStartManagedUnits(): Promise<void> {
    for (const record of this.units.values()) {
      if (
        record.manifest.launchStrategy === "managed" &&
        record.manifest.autoStart
      ) {
        await this.startUnit(record.manifest.id);
      }
    }
  }

  async startAll(): Promise<RuntimeState> {
    for (const record of this.units.values()) {
      if (record.manifest.launchStrategy === "managed") {
        await this.startUnit(record.manifest.id);
      }
    }

    return this.getRuntimeState();
  }

  async startOne(id: string): Promise<RuntimeState> {
    await this.startUnit(id);
    return this.getRuntimeState();
  }

  async stopAll(): Promise<RuntimeState> {
    const stopPromises = Array.from(this.units.values())
      .filter((record) => record.manifest.launchStrategy === "managed")
      .map((record) => this.stopUnit(record.manifest.id));

    await Promise.all(stopPromises);
    return this.getRuntimeState();
  }

  async stopOne(id: string): Promise<RuntimeState> {
    await this.stopUnit(id);
    return this.getRuntimeState();
  }

  async dispose(): Promise<void> {
    await this.stopAll();
  }

  private async startUnit(id: string): Promise<void> {
    const record = this.requireRecord(id);

    if (record.manifest.launchStrategy !== "managed") {
      if (record.manifest.launchStrategy === "embedded") {
        record.phase = "running";
      }
      return;
    }

    if (record.phase === "starting" || record.phase === "running") {
      return;
    }

    record.phase = "starting";
    record.lastError = null;
    record.exitCode = null;
    record.exitedAt = null;
    record.stdoutRemainder = "";
    record.stderrRemainder = "";

    try {
      const child = this.launchManagedUnit(record.manifest);

      this.children.set(id, child);
      record.pid = child.pid ?? null;
      record.startedAt = nowIso();

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        process.stdout.write(`[daemon:${id}] ${text}`);
        appendLogChunk(record, text, "stdout");
      });

      child.stderr?.on("data", (chunk) => {
        const text = String(chunk);
        process.stderr.write(`[daemon:${id}] ${text}`);
        appendLogChunk(record, text, "stderr");
      });

      attachManagedChildEvents(id, child, record, this.children);

      appendLogLine(
        record,
        `runtime unit ${id} launched with pid ${record.pid ?? "unknown"}`,
      );

      if (record.manifest.port !== null) {
        await waitForPort({
          host: "127.0.0.1",
          port: record.manifest.port,
          timeoutMs: record.manifest.startupTimeoutMs ?? 10_000,
        });
      }

      if (this.children.has(id)) {
        record.phase = "running";
        appendLogLine(record, `runtime unit ${id} is running`);
      }
    } catch (error) {
      record.phase = "failed";
      record.lastError =
        error instanceof Error ? error.message : "Failed to start daemon.";
      appendLogLine(
        record,
        `runtime unit ${id} failed to start: ${record.lastError}`,
      );
    }
  }

  private async stopUnit(id: string): Promise<void> {
    const record = this.requireRecord(id);

    if (record.manifest.launchStrategy !== "managed") {
      return;
    }

    const child = this.children.get(id);

    if (!child) {
      if (record.phase === "running" || record.phase === "starting") {
        record.phase = "failed";
        record.lastError =
          "Process handle missing while daemon was marked active.";
      }
      return;
    }

    record.phase = "stopping";
    appendLogLine(record, `runtime unit ${id} stopping`);

    await new Promise<void>((resolve) => {
      let settled = false;

      const finalize = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      onManagedExit(child, () => {
        finalize();
      });

      child.kill();

      setTimeout(() => {
        if (!settled) {
          child.kill();
          finalize();
        }
      }, 3_000);
    });
  }

  private requireRecord(id: string): RuntimeUnitRecord {
    const record = this.units.get(id);

    if (!record) {
      throw new Error(`Unknown daemon: ${id}`);
    }

    return record;
  }

  private toRuntimeUnitState(record: RuntimeUnitRecord): RuntimeUnitState {
    return {
      id: record.manifest.id,
      label: record.manifest.label,
      kind: record.manifest.kind,
      launchStrategy: record.manifest.launchStrategy,
      phase: record.phase,
      autoStart: record.manifest.autoStart,
      pid: record.pid,
      port: record.manifest.port,
      startedAt: record.startedAt,
      exitedAt: record.exitedAt,
      exitCode: record.exitCode,
      lastError: record.lastError,
      commandSummary:
        record.manifest.command && record.manifest.args
          ? [record.manifest.command, ...record.manifest.args].join(" ")
          : record.manifest.launchStrategy === "delegated"
            ? `delegated process match: ${record.manifest.delegatedProcessMatch ?? "unknown"}`
            : null,
      logTail: record.logTail,
    };
  }

  private refreshDelegatedUnits(): void {
    for (const record of this.units.values()) {
      if (record.manifest.launchStrategy !== "delegated") {
        continue;
      }

      const match = record.manifest.delegatedProcessMatch?.trim();
      if (!match) {
        record.phase = "failed";
        record.lastError = "Missing delegatedProcessMatch.";
        continue;
      }

      try {
        const output = execFileSync("pgrep", ["-fal", match], {
          encoding: "utf-8",
        }).trim();
        const firstLine = output.split(/\r?\n/).find(Boolean) ?? "";
        const pid = Number.parseInt(firstLine.split(" ", 1)[0] ?? "", 10);

        if (Number.isNaN(pid)) {
          record.phase = "stopped";
          record.pid = null;
          continue;
        }

        record.phase = "running";
        record.pid = pid;
        record.startedAt ??= this.startedAt;
        record.exitedAt = null;
        record.exitCode = null;
        record.lastError = null;
        appendLogLine(
          record,
          `delegated runtime detected via pgrep: pid ${pid}`,
        );
      } catch {
        record.phase = "stopped";
        record.pid = null;
      }
    }
  }

  private launchManagedUnit(
    manifest: RuntimeUnitManifest,
  ): ManagedChildProcess {
    const env = {
      ...process.env,
      ...manifest.env,
    };

    if (manifest.runner === "utility-process") {
      if (!manifest.modulePath) {
        throw new Error(`Runtime unit ${manifest.id} is missing modulePath.`);
      }

      return utilityProcess.fork(manifest.modulePath, [], {
        cwd: manifest.cwd,
        env,
        stdio: "pipe",
        serviceName: manifest.label,
      });
    }

    return spawn(manifest.command ?? "", manifest.args ?? [], {
      cwd: manifest.cwd,
      env,
      stdio: "pipe",
    });
  }
}

function appendLogChunk(
  record: RuntimeUnitRecord,
  chunk: string,
  stream: "stdout" | "stderr",
): void {
  const remainderKey =
    stream === "stdout" ? "stdoutRemainder" : "stderrRemainder";
  const prefix = stream === "stderr" ? "[stderr] " : "";
  const combined = record[remainderKey] + chunk;
  const parts = combined.split(/\r?\n/);
  record[remainderKey] = parts.pop() ?? "";

  for (const line of parts) {
    const normalized = line.trimEnd();
    if (normalized.length === 0) {
      continue;
    }
    record.logTail.push(`${prefix}${normalized}`);
  }

  if (record.logTail.length > LOG_TAIL_LIMIT) {
    record.logTail.splice(0, record.logTail.length - LOG_TAIL_LIMIT);
  }
}

function appendLogLine(record: RuntimeUnitRecord, line: string): void {
  if (line.trim().length === 0) {
    return;
  }

  record.logTail.push(line);

  if (record.logTail.length > LOG_TAIL_LIMIT) {
    record.logTail.splice(0, record.logTail.length - LOG_TAIL_LIMIT);
  }
}

type ManagedChildProcess = ChildProcessWithoutNullStreams | UtilityProcess;

function attachManagedChildEvents(
  id: string,
  child: ManagedChildProcess,
  record: RuntimeUnitRecord,
  children: Map<string, ManagedChildProcess>,
): void {
  onManagedError(child, (error) => {
    const nextError = error instanceof Error ? error.message : String(error);
    record.phase = "failed";
    record.lastError = nextError;
    appendLogLine(record, `runtime unit ${id} emitted error: ${nextError}`);
  });

  onManagedExit(child, (code) => {
    flushLogRemainders(record);
    children.delete(id);
    record.pid = null;
    record.exitedAt = nowIso();
    record.exitCode = code;
    record.phase = code === 0 ? "stopped" : "failed";
    appendLogLine(
      record,
      `runtime unit ${id} exited with code ${code ?? "null"}`,
    );
  });
}

function flushLogRemainders(record: RuntimeUnitRecord): void {
  for (const [key, prefix] of [
    ["stdoutRemainder", ""],
    ["stderrRemainder", "[stderr] "],
  ] as const) {
    const remainder = record[key].trimEnd();
    if (remainder.length > 0) {
      record.logTail.push(`${prefix}${remainder}`);
    }
    record[key] = "";
  }

  if (record.logTail.length > LOG_TAIL_LIMIT) {
    record.logTail.splice(0, record.logTail.length - LOG_TAIL_LIMIT);
  }
}

function onManagedError(
  child: ManagedChildProcess,
  listener: (error: unknown) => void,
): void {
  const eventful = child as unknown as {
    once(event: "error", listener: (error: unknown) => void): void;
  };
  eventful.once("error", listener);
}

function onManagedExit(
  child: ManagedChildProcess,
  listener: (code: number | null) => void,
): void {
  const eventful = child as unknown as {
    once(event: "exit", listener: (code: number | null) => void): void;
  };
  eventful.once("exit", listener);
}

function waitForPort({
  host,
  port,
  timeoutMs,
}: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<void> {
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    const tryConnect = () => {
      const socket = new Socket();

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port} on ${host}.`));
          return;
        }

        setTimeout(tryConnect, 250);
      });

      socket.connect(port, host);
    };

    tryConnect();
  });
}
