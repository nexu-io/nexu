import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { app } from "electron";
import type {
  RuntimeEventQueryResult,
  RuntimeLogEntry,
  RuntimeState,
  StartupProbePayload,
} from "../shared/host";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import {
  type SleepGuardSnapshot,
  createInitialSleepGuardSnapshot,
} from "./sleep-guard";

type DesktopColdStartStatus = "idle" | "running" | "succeeded" | "failed";

type DesktopColdStartSnapshot = {
  status: DesktopColdStartStatus;
  step: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

type DesktopRendererSnapshot = {
  didFinishLoad: boolean;
  lastUrl: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  processGone: {
    seen: boolean;
    reason: string | null;
    exitCode: number | null;
    at: string | null;
  };
};

type DesktopEmbeddedContentSnapshot = {
  id: number;
  type: string;
  didFinishLoad: boolean;
  lastUrl: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  processGone: {
    seen: boolean;
    reason: string | null;
    exitCode: number | null;
    at: string | null;
  };
};

type DesktopDiagnosticsSnapshot = {
  updatedAt: string;
  isPackaged: boolean;
  coldStart: DesktopColdStartSnapshot;
  startupProbe: {
    preloadSeen: boolean;
    rendererSeen: boolean;
    entries: Array<{
      source: StartupProbePayload["source"];
      stage: string;
      status: StartupProbePayload["status"];
      detail: string | null;
      at: string;
    }>;
  };
  sleepGuard: SleepGuardSnapshot;
  renderer: DesktopRendererSnapshot;
  embeddedContents: DesktopEmbeddedContentSnapshot[];
  runtime: {
    state: RuntimeState;
    recentEvents: RuntimeLogEntry[];
    nextCursor: number;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

const MAX_STARTUP_PROBE_ENTRIES = 200;

export function getDesktopDiagnosticsFilePath(): string {
  return resolve(app.getPath("userData"), "logs", "desktop-diagnostics.json");
}

export class DesktopDiagnosticsReporter {
  private readonly filePath = getDesktopDiagnosticsFilePath();

  private readonly coldStart: DesktopColdStartSnapshot = {
    status: "idle",
    step: null,
    startedAt: null,
    completedAt: null,
    error: null,
  };

  private readonly startupProbe: DesktopDiagnosticsSnapshot["startupProbe"] = {
    preloadSeen: false,
    rendererSeen: false,
    entries: [],
  };

  private sleepGuard: SleepGuardSnapshot = createInitialSleepGuardSnapshot();

  private readonly renderer: DesktopRendererSnapshot = {
    didFinishLoad: false,
    lastUrl: null,
    lastEventAt: null,
    lastError: null,
    processGone: {
      seen: false,
      reason: null,
      exitCode: null,
      at: null,
    },
  };

  private readonly embeddedContents = new Map<
    number,
    DesktopEmbeddedContentSnapshot
  >();

  private flushScheduled = false;

  private flushInFlight: Promise<void> | null = null;

  private needsFlush = false;

  constructor(private readonly orchestrator: RuntimeOrchestrator) {}

  start(): () => void {
    this.scheduleFlush();
    return this.orchestrator.subscribe(() => {
      this.scheduleFlush();
    });
  }

  markColdStartRunning(step: string): void {
    const startedAt = this.coldStart.startedAt ?? nowIso();
    this.coldStart.status = "running";
    this.coldStart.step = step;
    this.coldStart.startedAt = startedAt;
    this.coldStart.completedAt = null;
    this.coldStart.error = null;
    this.scheduleFlush();
  }

  markColdStartSucceeded(): void {
    this.coldStart.status = "succeeded";
    this.coldStart.step = null;
    this.coldStart.completedAt = nowIso();
    this.coldStart.error = null;
    this.scheduleFlush();
  }

  markColdStartFailed(error: string): void {
    this.coldStart.status = "failed";
    this.coldStart.error = error;
    this.coldStart.completedAt = nowIso();
    this.scheduleFlush();
  }

  setSleepGuardSnapshot(snapshot: SleepGuardSnapshot): void {
    this.sleepGuard = {
      ...snapshot,
      counters: { ...snapshot.counters },
      lastEvent: snapshot.lastEvent ? { ...snapshot.lastEvent } : null,
    };
    this.scheduleFlush();
  }

  recordStartupProbe(payload: StartupProbePayload): void {
    if (payload.source === "preload") {
      this.startupProbe.preloadSeen = true;
    }

    if (payload.source === "renderer") {
      this.startupProbe.rendererSeen = true;
    }

    this.startupProbe.entries.push({
      source: payload.source,
      stage: payload.stage,
      status: payload.status,
      detail: payload.detail ?? null,
      at: nowIso(),
    });

    if (this.startupProbe.entries.length > MAX_STARTUP_PROBE_ENTRIES) {
      this.startupProbe.entries.splice(
        0,
        this.startupProbe.entries.length - MAX_STARTUP_PROBE_ENTRIES,
      );
    }

    this.scheduleFlush();
  }

  recordRendererDidFinishLoad(url: string): void {
    this.renderer.didFinishLoad = true;
    this.renderer.lastUrl = url;
    this.renderer.lastEventAt = nowIso();
    this.renderer.lastError = null;
    this.scheduleFlush();
  }

  recordRendererDidFailLoad(details: {
    errorCode: number;
    errorDescription: string;
    validatedUrl: string;
  }): void {
    this.renderer.lastEventAt = nowIso();
    this.renderer.lastUrl = details.validatedUrl;
    this.renderer.lastError = `${details.errorCode} ${details.errorDescription} ${details.validatedUrl}`;
    this.scheduleFlush();
  }

  recordRendererProcessGone(details: {
    reason: string;
    exitCode: number;
  }): void {
    this.renderer.lastEventAt = nowIso();
    this.renderer.lastError = `reason=${details.reason} exitCode=${details.exitCode}`;
    this.renderer.processGone = {
      seen: true,
      reason: details.reason,
      exitCode: details.exitCode,
      at: this.renderer.lastEventAt,
    };
    this.scheduleFlush();
  }

  recordEmbeddedDidFinishLoad(details: {
    id: number;
    type: string;
    url: string;
  }): void {
    const snapshot = this.getEmbeddedSnapshot(details.id, details.type);
    snapshot.didFinishLoad = true;
    snapshot.lastUrl = details.url;
    snapshot.lastEventAt = nowIso();
    snapshot.lastError = null;
    this.scheduleFlush();
  }

  recordEmbeddedDidFailLoad(details: {
    id: number;
    type: string;
    errorCode: number;
    errorDescription: string;
    validatedUrl: string;
  }): void {
    const snapshot = this.getEmbeddedSnapshot(details.id, details.type);
    snapshot.lastEventAt = nowIso();
    snapshot.lastUrl = details.validatedUrl;
    snapshot.lastError = `${details.errorCode} ${details.errorDescription} ${details.validatedUrl}`;
    this.scheduleFlush();
  }

  recordEmbeddedProcessGone(details: {
    id: number;
    type: string;
    reason: string;
    exitCode: number;
  }): void {
    const snapshot = this.getEmbeddedSnapshot(details.id, details.type);
    snapshot.lastEventAt = nowIso();
    snapshot.lastError = `reason=${details.reason} exitCode=${details.exitCode}`;
    snapshot.processGone = {
      seen: true,
      reason: details.reason,
      exitCode: details.exitCode,
      at: snapshot.lastEventAt,
    };
    this.scheduleFlush();
  }

  async flushNow(): Promise<void> {
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      this.needsFlush = true;
      return;
    }

    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      void this.flush().catch(() => undefined);
    });
  }

  private async flush(): Promise<void> {
    if (this.flushInFlight) {
      this.needsFlush = true;
      await this.flushInFlight;
      return;
    }

    this.flushInFlight = this.writeSnapshot();
    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }

    if (this.needsFlush) {
      this.needsFlush = false;
      await this.flush();
    }
  }

  private buildSnapshot(): DesktopDiagnosticsSnapshot {
    const events: RuntimeEventQueryResult = this.orchestrator.queryEvents({
      limit: 50,
    });

    return {
      updatedAt: nowIso(),
      isPackaged: app.isPackaged,
      coldStart: { ...this.coldStart },
      startupProbe: {
        preloadSeen: this.startupProbe.preloadSeen,
        rendererSeen: this.startupProbe.rendererSeen,
        entries: this.startupProbe.entries.map((entry) => ({ ...entry })),
      },
      sleepGuard: {
        ...this.sleepGuard,
        counters: { ...this.sleepGuard.counters },
        lastEvent: this.sleepGuard.lastEvent
          ? { ...this.sleepGuard.lastEvent }
          : null,
      },
      renderer: {
        ...this.renderer,
        processGone: { ...this.renderer.processGone },
      },
      embeddedContents: [...this.embeddedContents.values()],
      runtime: {
        state: this.orchestrator.getRuntimeState(),
        recentEvents: events.entries,
        nextCursor: events.nextCursor,
      },
    };
  }

  private async writeSnapshot(): Promise<void> {
    const snapshot = this.buildSnapshot();
    const directoryPath = dirname(this.filePath);
    const tempPath = `${this.filePath}.tmp`;

    await mkdir(directoryPath, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }

  private getEmbeddedSnapshot(
    id: number,
    type: string,
  ): DesktopEmbeddedContentSnapshot {
    const existing = this.embeddedContents.get(id);
    if (existing) {
      return existing;
    }

    const snapshot: DesktopEmbeddedContentSnapshot = {
      id,
      type,
      didFinishLoad: false,
      lastUrl: null,
      lastEventAt: null,
      lastError: null,
      processGone: {
        seen: false,
        reason: null,
        exitCode: null,
        at: null,
      },
    };

    this.embeddedContents.set(id, snapshot);
    return snapshot;
  }
}
