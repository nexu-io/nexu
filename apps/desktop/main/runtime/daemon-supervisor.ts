import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { Socket } from "node:net";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { type UtilityProcess, utilityProcess } from "electron";
import type {
  RuntimeEvent,
  RuntimeEventQuery,
  RuntimeEventQueryResult,
  RuntimeLogEntry,
  RuntimeLogKind,
  RuntimeLogStream,
  RuntimeReasonCode,
  RuntimeState,
  RuntimeUnitSnapshot,
  RuntimeUnitState,
} from "../../shared/host";
import type {
  LaunchdManager,
  ServiceStatus,
} from "../services/launchd-manager";
import { writeRuntimeLogEntry } from "./runtime-logger";
import type { RuntimeUnitManifest, RuntimeUnitRecord } from "./types";

const LOG_TAIL_LIMIT = 200;
const RECENT_EVENT_LIMIT = 500;
let nextRuntimeLogEntryId = 0;
let nextRuntimeActionId = 0;
let nextRuntimeEventCursor = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function safeWrite(stream: NodeJS.WriteStream, message: string): void {
  if (stream.destroyed || !stream.writable) {
    return;
  }

  try {
    stream.write(message);
  } catch (error) {
    const errorCode =
      error instanceof Error && "code" in error ? String(error.code) : null;
    if (errorCode === "EIO" || errorCode === "EPIPE") {
      return;
    }
    throw error;
  }
}

export class RuntimeOrchestrator {
  private readonly startedAt = nowIso();

  private readonly units = new Map<string, RuntimeUnitRecord>();

  private readonly children = new Map<string, ManagedChildProcess>();

  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  private readonly recentEntries: RuntimeLogEntry[] = [];

  private launchdManager: LaunchdManager | null = null;

  /** Tracks last-read byte offset per launchd log file to avoid re-reading. */
  private readonly launchdLogOffsets = new Map<string, number>();

  constructor(manifests: RuntimeUnitManifest[]) {
    for (const manifest of manifests) {
      const record: RuntimeUnitRecord = {
        manifest,
        phase:
          manifest.launchStrategy === "embedded"
            ? "running"
            : manifest.launchStrategy === "delegated" ||
                manifest.launchStrategy === "launchd"
              ? "stopped"
              : "idle",
        pid: null,
        startedAt:
          manifest.launchStrategy === "embedded" ? this.startedAt : null,
        exitedAt: null,
        exitCode: null,
        lastError: null,
        lastReasonCode:
          manifest.launchStrategy === "embedded" ? "embedded_unit" : null,
        lastProbeAt: null,
        restartCount: 0,
        currentActionId: null,
        logFilePath: manifest.logFilePath ?? null,
        logTail:
          manifest.launchStrategy === "embedded"
            ? [
                createRuntimeLogEntry({
                  unitId: manifest.id,
                  stream: "system",
                  kind: "lifecycle",
                  actionId: null,
                  reasonCode: "embedded_unit",
                  message: "embedded runtime unit",
                }),
              ]
            : [],
        stdoutRemainder: "",
        stderrRemainder: "",
        autoRestartAttempts: 0,
        stoppedByUser: false,
      };

      this.units.set(manifest.id, record);

      for (const entry of record.logTail) {
        this.rememberEntry(entry);
      }
    }
  }

  getRuntimeState(): RuntimeState {
    this.refreshDelegatedUnits();
    this.refreshLaunchdUnits();

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
      if (
        record.manifest.launchStrategy === "managed" ||
        record.manifest.launchStrategy === "launchd"
      ) {
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
      .filter(
        (record) =>
          record.manifest.launchStrategy === "managed" ||
          record.manifest.launchStrategy === "launchd",
      )
      .map((record) => this.stopUnit(record.manifest.id));

    await Promise.all(stopPromises);
    return this.getRuntimeState();
  }

  async stopOne(id: string): Promise<RuntimeState> {
    const record = this.requireRecord(id);
    // Stop dependents first (units that depend on this one)
    const dependents = record.manifest.dependents ?? [];
    for (const depId of dependents) {
      if (this.units.has(depId)) {
        await this.stopUnit(depId);
      }
    }
    await this.stopUnit(id);
    return this.getRuntimeState();
  }

  async restartOne(id: string): Promise<RuntimeState> {
    const record = this.requireRecord(id);
    const dependents = record.manifest.dependents ?? [];
    // Stop dependents first, then this unit
    for (const depId of dependents) {
      if (this.units.has(depId)) {
        await this.stopUnit(depId);
      }
    }
    await this.stopUnit(id);
    // Start this unit, then dependents
    await this.startUnit(id);
    for (const depId of dependents) {
      if (this.units.has(depId)) {
        await this.startUnit(depId);
      }
    }
    return this.getRuntimeState();
  }

  getLogFilePath(id: string): string | null {
    return this.requireRecord(id).logFilePath;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    await this.stopAll();
  }

  /**
   * Upgrade specific units to launchd management.
   * Call this after launchd bootstrap to wire status, start/stop, and logs
   * for units that are managed by launchd instead of the orchestrator.
   */
  enableLaunchdMode(
    manager: LaunchdManager,
    unitLabels: Record<string, string>,
    logDir: string,
  ): void {
    this.launchdManager = manager;

    for (const [unitId, label] of Object.entries(unitLabels)) {
      const record = this.units.get(unitId);
      if (!record) continue;

      record.manifest.launchStrategy = "launchd";
      record.manifest.launchdLabel = label;
      record.manifest.launchdLogDir = logDir;
      // Reset from idle to stopped — refreshLaunchdUnits will set the real phase
      if (record.phase === "idle") {
        record.phase = "stopped";
      }
    }

    // Immediately refresh to pick up current state
    this.refreshLaunchdUnits();
  }

  queryEvents(query: RuntimeEventQuery): RuntimeEventQueryResult {
    const entries = this.recentEntries
      .filter((entry) => this.matchesEventQuery(entry, query))
      .slice(-this.normalizeQueryLimit(query.limit));

    return {
      entries,
      nextCursor: this.getNextCursor(entries, query.afterCursor),
    };
  }

  private rememberEntry(entry: RuntimeLogEntry): void {
    this.recentEntries.push(entry);

    if (this.recentEntries.length > RECENT_EVENT_LIMIT) {
      this.recentEntries.splice(
        0,
        this.recentEntries.length - RECENT_EVENT_LIMIT,
      );
    }
  }

  private normalizeQueryLimit(limit?: number): number {
    return Math.max(1, Math.min(limit ?? 100, RECENT_EVENT_LIMIT));
  }

  private matchesEventQuery(
    entry: RuntimeLogEntry,
    query: RuntimeEventQuery,
  ): boolean {
    if (
      typeof query.afterCursor === "number" &&
      entry.cursor <= query.afterCursor
    ) {
      return false;
    }
    if (query.unitId && entry.unitId !== query.unitId) {
      return false;
    }
    if (query.actionId && entry.actionId !== query.actionId) {
      return false;
    }
    if (query.reasonCode && entry.reasonCode !== query.reasonCode) {
      return false;
    }
    return true;
  }

  private getNextCursor(
    entries: RuntimeLogEntry[],
    fallbackCursor?: number,
  ): number {
    return entries[entries.length - 1]?.cursor ?? fallbackCursor ?? 0;
  }

  private logStateChange(
    record: RuntimeUnitRecord,
    input: {
      kind: RuntimeLogKind;
      actionId: string | null;
      reasonCode: RuntimeReasonCode;
      message: string;
    },
  ): void {
    appendLogLine(
      record,
      input,
      () => this.emitUnitState(record),
      this.rememberEntry.bind(this),
    );
  }

  private logChunk(
    record: RuntimeUnitRecord,
    chunk: string,
    stream: "stdout" | "stderr",
    actionId: string | null,
  ): void {
    appendLogChunk(
      record,
      chunk,
      stream,
      this.emitUnitLog.bind(this, record),
      this.rememberEntry.bind(this),
      actionId,
    );
  }

  private attachManagedEvents(
    id: string,
    child: ManagedChildProcess,
    record: RuntimeUnitRecord,
  ): void {
    attachManagedChildEvents(
      id,
      child,
      record,
      this.children,
      () => this.emitUnitState(record),
      (entry) => this.emitUnitLog(record, entry),
      this.rememberEntry.bind(this),
    );

    // Auto-restart on unexpected exit with exponential backoff (cap 30s)
    const MAX_BACKOFF_MS = 30_000;
    onManagedExit(child, (code) => {
      if (code === 0) return;
      if (record.manifest.autoRestart === false) return;
      if (record.stoppedByUser) return;

      record.autoRestartAttempts += 1;
      const delayMs = Math.min(
        2000 * 2 ** (record.autoRestartAttempts - 1),
        MAX_BACKOFF_MS,
      );
      this.logStateChange(record, {
        kind: "lifecycle",
        actionId: ensureActionId(record, "auto-restart"),
        reasonCode: "auto_restart_scheduled",
        message: `auto-restart #${record.autoRestartAttempts} in ${delayMs}ms`,
      });

      setTimeout(() => {
        this.startUnit(id).catch(() => {});
      }, delayMs);
    });
  }

  private async startUnit(id: string): Promise<void> {
    const record = this.requireRecord(id);

    if (record.manifest.launchStrategy === "launchd") {
      await this.startLaunchdUnit(record);
      return;
    }

    if (record.manifest.launchStrategy !== "managed") {
      if (record.manifest.launchStrategy === "embedded") {
        record.phase = "running";
        this.emitUnitState(record);
      }
      return;
    }

    if (record.phase === "starting" || record.phase === "running") {
      this.logStateChange(record, {
        kind: "lifecycle",
        actionId: ensureActionId(record, "start"),
        reasonCode: "start_requested",
        message: `runtime unit ${id} already active in phase ${record.phase}`,
      });
      return;
    }

    const actionId = beginAction(record, "start");
    if (record.startedAt) {
      record.restartCount += 1;
    }
    setRecordPhase(record, "starting");
    record.lastError = null;
    record.exitCode = null;
    record.exitedAt = null;
    record.stdoutRemainder = "";
    record.stderrRemainder = "";
    record.stoppedByUser = false;

    this.logStateChange(record, {
      kind: "lifecycle",
      actionId,
      reasonCode: "start_requested",
      message: `runtime unit ${id} start requested`,
    });

    try {
      const child = this.launchManagedUnit(record.manifest);

      this.children.set(id, child);
      record.pid = child.pid ?? null;
      record.startedAt = nowIso();

      child.stdout?.on("data", (chunk) => {
        const text = String(chunk);
        safeWrite(process.stdout, `[daemon:${id}] ${text}`);
        this.logChunk(record, text, "stdout", actionId);
      });

      child.stderr?.on("data", (chunk) => {
        const text = String(chunk);
        safeWrite(process.stderr, `[daemon:${id}] ${text}`);
        this.logChunk(record, text, "stderr", actionId);
      });

      this.attachManagedEvents(id, child, record);

      this.logStateChange(record, {
        kind: "lifecycle",
        actionId,
        reasonCode: "start_succeeded",
        message: `runtime unit ${id} launched with pid ${record.pid ?? "unknown"}`,
      });

      if (record.manifest.port !== null) {
        await waitForPort({
          host: "127.0.0.1",
          port: record.manifest.port,
          timeoutMs: record.manifest.startupTimeoutMs ?? 10_000,
        });
        this.logStateChange(record, {
          kind: "probe",
          actionId,
          reasonCode: "port_ready",
          message: `runtime unit ${id} port ${record.manifest.port} is ready`,
        });
        markProbeSuccess(record);
        this.emitUnitState(record);
      }

      if (this.children.has(id)) {
        setRecordPhase(record, "running");
        record.autoRestartAttempts = 0;
        this.logStateChange(record, {
          kind: "lifecycle",
          actionId,
          reasonCode: "start_succeeded",
          message: `runtime unit ${id} is running`,
        });
      }
    } catch (error) {
      setRecordPhase(record, "failed");
      record.lastError =
        error instanceof Error ? error.message : "Failed to start daemon.";
      this.logStateChange(record, {
        kind: "lifecycle",
        actionId,
        reasonCode: "start_failed",
        message: `runtime unit ${id} failed to start: ${record.lastError}`,
      });
    }
  }

  private async stopUnit(id: string): Promise<void> {
    const record = this.requireRecord(id);

    if (record.manifest.launchStrategy === "launchd") {
      await this.stopLaunchdUnit(record);
      return;
    }

    if (record.manifest.launchStrategy !== "managed") {
      return;
    }

    const child = this.children.get(id);
    const actionId = beginAction(record, "stop");

    if (!child) {
      if (record.phase === "running" || record.phase === "starting") {
        setRecordPhase(record, "failed");
        record.lastError =
          "Process handle missing while daemon was marked active.";
        this.logStateChange(record, {
          kind: "lifecycle",
          actionId,
          reasonCode: "managed_error",
          message: `runtime unit ${id} process handle missing while stopping`,
        });
      }
      return;
    }

    record.stoppedByUser = true;
    setRecordPhase(record, "stopping");
    this.logStateChange(record, {
      kind: "lifecycle",
      actionId,
      reasonCode: "stop_requested",
      message: `runtime unit ${id} stopping`,
    });

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

      // Escalate to SIGKILL after 3s if SIGTERM was ignored
      setTimeout(() => {
        if (!settled) {
          this.logStateChange(record, {
            kind: "lifecycle",
            actionId,
            reasonCode: "stop_requested",
            message: `runtime unit ${id} did not exit after SIGTERM; sending SIGKILL`,
          });
          child.kill("SIGKILL" as NodeJS.Signals);
        }
      }, 3_000);

      // Final deadline: resolve after 5s regardless to avoid hanging quit
      setTimeout(() => {
        if (!settled) {
          this.logStateChange(record, {
            kind: "lifecycle",
            actionId,
            reasonCode: "stop_requested",
            message: `runtime unit ${id} stop deadline reached after SIGKILL`,
          });
          finalize();
        }
      }, 5_000);
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
      lastReasonCode: record.lastReasonCode,
      lastProbeAt: record.lastProbeAt,
      restartCount: record.restartCount,
      commandSummary:
        record.manifest.command && record.manifest.args
          ? [record.manifest.command, ...record.manifest.args].join(" ")
          : record.manifest.launchStrategy === "launchd"
            ? `launchd service: ${record.manifest.launchdLabel ?? "unknown"}`
            : record.manifest.launchStrategy === "delegated"
              ? `delegated process match: ${record.manifest.delegatedProcessMatch ?? "unknown"}`
              : null,
      binaryPath: record.manifest.binaryPath ?? null,
      logFilePath: record.logFilePath,
      logTail: record.logTail,
    };
  }

  private toRuntimeUnitSnapshot(
    record: RuntimeUnitRecord,
  ): RuntimeUnitSnapshot {
    const state = this.toRuntimeUnitState(record);
    const { logTail: _logTail, ...snapshot } = state;
    return snapshot;
  }

  private emitUnitState(record: RuntimeUnitRecord): void {
    const event: RuntimeEvent = {
      type: "runtime:unit-state",
      unit: this.toRuntimeUnitSnapshot(record),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitUnitLog(record: RuntimeUnitRecord, entry: RuntimeLogEntry): void {
    const event: RuntimeEvent = {
      type: "runtime:unit-log",
      unitId: record.manifest.id,
      entry,
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  // ---------------------------------------------------------------------------
  // Launchd unit management
  // ---------------------------------------------------------------------------

  private refreshLaunchdUnits(): void {
    if (!this.launchdManager) return;

    for (const record of this.units.values()) {
      if (record.manifest.launchStrategy !== "launchd") continue;
      this.refreshLaunchdUnit(record);
    }
  }

  private refreshLaunchdUnit(record: RuntimeUnitRecord): void {
    const label = record.manifest.launchdLabel;
    if (!label || !this.launchdManager) return;

    let status: ServiceStatus;
    try {
      // getServiceStatus is async but we need sync refresh for getRuntimeState.
      // Use execFileSync to call launchctl print directly.
      const uid = userInfo().uid;
      const domain = `gui/${uid}`;
      const output = execFileSync(
        "launchctl",
        ["print", `${domain}/${label}`],
        { encoding: "utf-8", timeout: 3000 },
      );

      const pidMatch = output.match(/pid\s*=\s*(\d+)/i);
      const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : undefined;
      const stateMatch = output.match(/state\s*=\s*(\w+)/i);
      const state = stateMatch?.[1]?.toLowerCase();
      const isRunning = state === "running" || (pid !== undefined && pid > 0);

      status = {
        label,
        plistPath: "",
        status: isRunning ? "running" : "stopped",
        pid,
      };
    } catch {
      status = { label, plistPath: "", status: "unknown" };
    }

    const previousPhase = record.phase;
    const previousPid = record.pid;

    if (status.status === "running") {
      setRecordPhase(record, "running");
      record.pid = status.pid ?? null;
      record.startedAt ??= nowIso();
      record.exitedAt = null;
      record.exitCode = null;
      record.lastError = null;
      markProbeSuccess(record);
    } else if (status.status === "stopped") {
      setRecordPhase(record, "stopped");
      record.pid = null;
      markProbeFailure(record);
    } else {
      // unknown — service not registered (e.g. after bootout). If we were
      // stopping, transition to stopped so the unit doesn't get stuck.
      if (record.phase === "stopping") {
        setRecordPhase(record, "stopped");
      }
      record.pid = null;
    }

    if (previousPhase !== record.phase || previousPid !== record.pid) {
      const reasonCode =
        record.phase === "running" ? "launchd_running" : "launchd_stopped";
      const actionId = beginAction(record, "probe");
      this.logStateChange(record, {
        kind: "probe",
        actionId,
        reasonCode,
        message: `launchd service ${label} is ${status.status} (pid=${status.pid ?? "none"})`,
      });
    }

    // Tail launchd log files
    this.tailLaunchdLogs(record);
  }

  /**
   * Read new lines from launchd stdout/stderr log files and append to logTail.
   */
  private tailLaunchdLogs(record: RuntimeUnitRecord): void {
    const logDir = record.manifest.launchdLogDir;
    if (!logDir) return;

    const unitId = record.manifest.id;
    const logFiles = [
      { path: resolve(logDir, `${unitId}.log`), stream: "stdout" as const },
      {
        path: resolve(logDir, `${unitId}.error.log`),
        stream: "stderr" as const,
      },
    ];

    for (const logFile of logFiles) {
      try {
        const stat = statSync(logFile.path);
        const prevOffset = this.launchdLogOffsets.get(logFile.path) ?? 0;
        const fileSize = stat.size;

        if (fileSize <= prevOffset) continue;

        // Read only new bytes (cap at 64KB per poll to avoid blocking)
        const maxRead = 64 * 1024;
        const readStart = Math.max(prevOffset, fileSize - maxRead);
        const buffer = Buffer.alloc(fileSize - readStart);
        const fd = openSync(logFile.path, "r");
        try {
          readSync(fd, buffer, 0, buffer.length, readStart);
        } finally {
          closeSync(fd);
        }

        const newContent = buffer.toString("utf-8");
        // Only process lines from prevOffset onwards (readStart may be earlier for first read)
        const effectiveContent =
          readStart < prevOffset
            ? newContent.slice(prevOffset - readStart)
            : newContent;

        const lines = effectiveContent.split(/\r?\n/);
        // Last element might be incomplete — don't advance past it
        const incomplete = lines.pop() ?? "";
        const newOffset = fileSize - Buffer.byteLength(incomplete, "utf-8");
        this.launchdLogOffsets.set(logFile.path, newOffset);

        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed) continue;

          const prefix = logFile.stream === "stderr" ? "[stderr] " : "";
          const entry = createRuntimeLogEntry({
            unitId: record.manifest.id,
            stream: logFile.stream,
            kind: "app",
            actionId: null,
            reasonCode: "launchd_log_line",
            message: `${prefix}${trimmed}`,
          });
          persistLogEntry(record, entry, this.rememberEntry.bind(this));
          this.emitUnitLog(record, entry);
        }
      } catch {
        // Log file may not exist yet — that's fine
      }
    }
  }

  private async startLaunchdUnit(record: RuntimeUnitRecord): Promise<void> {
    const label = record.manifest.launchdLabel;
    if (!label || !this.launchdManager) return;

    if (record.phase === "starting" || record.phase === "running") {
      return;
    }

    const actionId = beginAction(record, "start");
    if (record.startedAt) {
      record.restartCount += 1;
    }
    setRecordPhase(record, "starting");
    record.stoppedByUser = false;

    this.logStateChange(record, {
      kind: "lifecycle",
      actionId,
      reasonCode: "launchd_start_requested",
      message: `launchd service ${label} start requested`,
    });

    try {
      // If the service was previously stopped via bootout, it needs to be
      // re-bootstrapped before it can be kickstarted.
      const isRegistered = await this.launchdManager.isServiceRegistered(label);
      if (!isRegistered) {
        // Re-install will re-bootstrap using the plist file on disk
        const hasPlist = await this.launchdManager.hasPlistFile(label);
        if (hasPlist) {
          await this.launchdManager.rebootstrapFromPlist(label);
        } else {
          setRecordPhase(record, "failed");
          record.lastError = `Plist file missing for ${label}, cannot start.`;
          this.logStateChange(record, {
            kind: "lifecycle",
            actionId,
            reasonCode: "start_failed",
            message: record.lastError,
          });
          return;
        }
      }

      await this.launchdManager.startService(label);
      // Wait briefly for process to appear
      await new Promise((r) => setTimeout(r, 1000));
      this.refreshLaunchdUnit(record);

      const isRunning =
        record.phase === ("running" as RuntimeUnitRecord["phase"]);
      this.logStateChange(record, {
        kind: "lifecycle",
        actionId,
        reasonCode: isRunning ? "start_succeeded" : "start_failed",
        message: `launchd service ${label} is ${record.phase} (pid=${record.pid ?? "none"})`,
      });
    } catch (error) {
      setRecordPhase(record, "failed");
      record.lastError =
        error instanceof Error ? error.message : "Failed to start via launchd.";
      this.logStateChange(record, {
        kind: "lifecycle",
        actionId,
        reasonCode: "start_failed",
        message: `launchd service ${label} failed to start: ${record.lastError}`,
      });
    }
  }

  private async stopLaunchdUnit(record: RuntimeUnitRecord): Promise<void> {
    const label = record.manifest.launchdLabel;
    if (!label || !this.launchdManager) return;

    const actionId = beginAction(record, "stop");
    record.stoppedByUser = true;
    setRecordPhase(record, "stopping");

    this.logStateChange(record, {
      kind: "lifecycle",
      actionId,
      reasonCode: "launchd_stop_requested",
      message: `launchd service ${label} stopping`,
    });

    try {
      // Use bootout instead of SIGTERM to prevent KeepAlive from respawning
      // the process. bootout unregisters the service so launchd won't restart it.
      await this.launchdManager.bootoutService(label);
      await this.launchdManager.waitForExit(label, 5000);
    } catch {
      // Service may already be stopped/unregistered
    }

    this.refreshLaunchdUnit(record);
    this.logStateChange(record, {
      kind: "lifecycle",
      actionId,
      reasonCode: "stop_requested",
      message: `launchd service ${label} is ${record.phase}`,
    });
  }

  private refreshDelegatedUnits(): void {
    for (const record of this.units.values()) {
      if (record.manifest.launchStrategy !== "delegated") {
        continue;
      }

      this.refreshDelegatedUnit(record);
    }
  }

  private refreshDelegatedUnit(record: RuntimeUnitRecord): void {
    const match = record.manifest.delegatedProcessMatch?.trim();
    if (!match) {
      const previousPhase = record.phase;
      const previousError = record.lastError;
      setRecordPhase(record, "failed");
      record.lastError = "Missing delegatedProcessMatch.";
      markProbeFailure(record);

      if (
        previousPhase !== record.phase ||
        previousError !== record.lastError
      ) {
        const actionId = beginAction(record, "probe");
        this.logStateChange(record, {
          kind: "probe",
          actionId,
          reasonCode: "delegated_process_missing",
          message: `delegated runtime misconfigured: ${record.lastError}`,
        });
      }
      return;
    }

    try {
      const previousPhase = record.phase;
      const previousPid = record.pid;
      const output = execFileSync("pgrep", ["-fal", match], {
        encoding: "utf-8",
      }).trim();
      const firstLine = output.split(/\r?\n/).find(Boolean) ?? "";
      const pid = Number.parseInt(firstLine.split(" ", 1)[0] ?? "", 10);

      if (Number.isNaN(pid)) {
        setRecordPhase(record, "stopped");
        record.pid = null;
        markProbeFailure(record);
        if (previousPhase !== record.phase || previousPid !== record.pid) {
          const actionId = beginAction(record, "probe");
          this.logStateChange(record, {
            kind: "probe",
            actionId,
            reasonCode: "delegated_process_missing",
            message: `delegated runtime ${record.manifest.id} is no longer detected`,
          });
        }
        return;
      }

      setRecordPhase(record, "running");
      record.pid = pid;
      record.startedAt ??= this.startedAt;
      record.exitedAt = null;
      record.exitCode = null;
      record.lastError = null;
      markProbeSuccess(record);
      if (previousPhase !== record.phase || previousPid !== record.pid) {
        const actionId = beginAction(record, "probe");
        this.logStateChange(record, {
          kind: "probe",
          actionId,
          reasonCode: "delegated_process_detected",
          message: `delegated runtime detected via pgrep: pid ${pid}`,
        });
      }
    } catch {
      const previousPhase = record.phase;
      const previousPid = record.pid;
      setRecordPhase(record, "stopped");
      record.pid = null;
      markProbeFailure(record);

      if (previousPhase !== record.phase || previousPid !== record.pid) {
        const actionId = beginAction(record, "probe");
        this.logStateChange(record, {
          kind: "probe",
          actionId,
          reasonCode: "delegated_process_missing",
          message: `delegated runtime ${record.manifest.id} is no longer detected`,
        });
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
  notifyLog: (entry: RuntimeLogEntry) => void,
  rememberEntry: (entry: RuntimeLogEntry) => void,
  actionId: string | null,
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
    const entry = createRuntimeLogEntry({
      unitId: record.manifest.id,
      stream,
      kind: "app",
      actionId,
      reasonCode: stream === "stderr" ? "stderr_line" : "stdout_line",
      message: `${prefix}${normalized}`,
    });
    persistLogEntry(record, entry, rememberEntry);
    notifyLog(entry);
  }
}

function appendLogLine(
  record: RuntimeUnitRecord,
  input: {
    kind: RuntimeLogKind;
    actionId: string | null;
    reasonCode: RuntimeReasonCode;
    message: string;
  },
  notify: () => void,
  rememberEntry: (entry: RuntimeLogEntry) => void,
): void {
  if (input.message.trim().length === 0) {
    return;
  }

  record.lastReasonCode = input.reasonCode;

  persistLogEntry(
    record,
    createRuntimeLogEntry({
      unitId: record.manifest.id,
      stream: "system",
      kind: input.kind,
      actionId: input.actionId,
      reasonCode: input.reasonCode,
      message: input.message,
    }),
    rememberEntry,
  );
  notify();
}

type ManagedChildProcess = ChildProcessWithoutNullStreams | UtilityProcess;

function attachManagedChildEvents(
  id: string,
  child: ManagedChildProcess,
  record: RuntimeUnitRecord,
  children: Map<string, ManagedChildProcess>,
  notifyState: () => void,
  notifyLog: (entry: RuntimeLogEntry) => void,
  rememberEntry: (entry: RuntimeLogEntry) => void,
): void {
  onManagedError(child, (error) => {
    const nextError = error instanceof Error ? error.message : String(error);
    setRecordPhase(record, "failed");
    record.lastError = nextError;
    const actionId = ensureActionId(record, "error");
    appendLogLine(
      record,
      {
        kind: "lifecycle",
        actionId,
        reasonCode: "managed_error",
        message: `runtime unit ${id} emitted error: ${nextError}`,
      },
      notifyState,
      rememberEntry,
    );
  });

  onManagedExit(child, (code) => {
    flushLogRemainders(record, notifyLog, rememberEntry);
    children.delete(id);
    record.pid = null;
    record.exitedAt = nowIso();
    record.exitCode = code;
    setRecordPhase(record, code === 0 ? "stopped" : "failed");
    const actionId = ensureActionId(record, "exit");
    appendLogLine(
      record,
      {
        kind: "lifecycle",
        actionId,
        reasonCode: "process_exited",
        message: `runtime unit ${id} exited with code ${code ?? "null"}`,
      },
      notifyState,
      rememberEntry,
    );
  });
}

function flushLogRemainders(
  record: RuntimeUnitRecord,
  notifyLog: (entry: RuntimeLogEntry) => void,
  rememberEntry: (entry: RuntimeLogEntry) => void,
): void {
  for (const [key, prefix] of [
    ["stdoutRemainder", ""],
    ["stderrRemainder", "[stderr] "],
  ] as const) {
    const remainder = record[key].trimEnd();
    if (remainder.length > 0) {
      const entry = createRuntimeLogEntry({
        unitId: record.manifest.id,
        stream: prefix ? "stderr" : "stdout",
        kind: "app",
        actionId: null,
        reasonCode: prefix ? "stderr_line" : "stdout_line",
        message: `${prefix}${remainder}`,
      });
      persistLogEntry(record, entry, rememberEntry);
      notifyLog(entry);
    }
    record[key] = "";
  }
}

function createRuntimeLogEntry({
  unitId,
  stream,
  kind,
  actionId,
  reasonCode,
  message,
}: {
  unitId: RuntimeUnitRecord["manifest"]["id"];
  stream: RuntimeLogStream;
  kind: RuntimeLogKind;
  actionId: string | null;
  reasonCode: RuntimeReasonCode;
  message: string;
}): RuntimeLogEntry {
  nextRuntimeLogEntryId += 1;

  return {
    id: `${unitId}:${nextRuntimeLogEntryId}`,
    cursor: ++nextRuntimeEventCursor,
    ts: nowIso(),
    unitId,
    stream,
    kind,
    actionId,
    reasonCode,
    message,
  };
}

function persistLogEntry(
  record: RuntimeUnitRecord,
  entry: RuntimeLogEntry,
  rememberEntry: (entry: RuntimeLogEntry) => void,
): void {
  record.logTail.push(entry);

  if (record.logTail.length > LOG_TAIL_LIMIT) {
    record.logTail.splice(0, record.logTail.length - LOG_TAIL_LIMIT);
  }

  rememberEntry(entry);

  if (!record.logFilePath) {
    writeRuntimeLogEntry(entry, null);
    return;
  }

  writeRuntimeLogEntry(entry, record.logFilePath);
}

function createActionId(unitId: string, verb: string): string {
  nextRuntimeActionId += 1;
  return `${unitId}:${verb}:${nextRuntimeActionId}`;
}

function beginAction(record: RuntimeUnitRecord, verb: string): string {
  const actionId = createActionId(record.manifest.id, verb);
  record.currentActionId = actionId;
  return actionId;
}

function setRecordPhase(
  record: RuntimeUnitRecord,
  nextPhase: RuntimeUnitRecord["phase"],
): void {
  record.phase = nextPhase;
}

function markProbeSuccess(record: RuntimeUnitRecord): void {
  record.lastProbeAt = nowIso();
}

function markProbeFailure(record: RuntimeUnitRecord): void {
  record.lastProbeAt = nowIso();
}

function ensureActionId(record: RuntimeUnitRecord, verb: string): string {
  return record.currentActionId ?? beginAction(record, verb);
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
