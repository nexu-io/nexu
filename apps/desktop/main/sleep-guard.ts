type SleepBlockerType = "prevent-app-suspension" | "prevent-display-sleep";

type PowerMonitorEventName =
  | "suspend"
  | "resume"
  | "on-battery"
  | "on-ac"
  | "shutdown";

export type SleepGuardEventType = "started" | "stopped" | PowerMonitorEventName;

export type SleepGuardSnapshot = {
  status: "active" | "inactive";
  requestedBlockerType: SleepBlockerType;
  activeBlockerType: SleepBlockerType | null;
  blockerId: number | null;
  isStarted: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  onBatteryPower: boolean | null;
  lastEvent: {
    type: SleepGuardEventType;
    at: string;
    onBatteryPower: boolean | null;
  } | null;
  counters: {
    suspend: number;
    resume: number;
    shutdown: number;
    onBattery: number;
    onAc: number;
  };
};

export type SleepGuardLogEntry = {
  stream: "system";
  kind: "lifecycle";
  message: string;
};

type SleepGuardDependencies = {
  powerSaveBlocker: {
    isStarted(id: number): boolean;
    start(type: SleepBlockerType): number;
    stop(id: number): boolean;
  };
  powerMonitor: {
    isOnBatteryPower(): boolean;
    off(event: PowerMonitorEventName, listener: () => void): void;
    on(event: PowerMonitorEventName, listener: () => void): void;
  };
  blockerType?: SleepBlockerType;
  log(entry: SleepGuardLogEntry): void;
  now?: () => string;
  onSnapshot?(snapshot: SleepGuardSnapshot): void;
};

// Keep the app active during idle without forcing the display to stay on.
const DEFAULT_BLOCKER_TYPE: SleepBlockerType = "prevent-app-suspension";

function cloneSnapshot(snapshot: SleepGuardSnapshot): SleepGuardSnapshot {
  return {
    ...snapshot,
    counters: { ...snapshot.counters },
    lastEvent: snapshot.lastEvent ? { ...snapshot.lastEvent } : null,
  };
}

export function createInitialSleepGuardSnapshot(
  blockerType: SleepBlockerType = DEFAULT_BLOCKER_TYPE,
): SleepGuardSnapshot {
  return {
    status: "inactive",
    requestedBlockerType: blockerType,
    activeBlockerType: null,
    blockerId: null,
    isStarted: false,
    startedAt: null,
    stoppedAt: null,
    onBatteryPower: null,
    lastEvent: null,
    counters: {
      suspend: 0,
      resume: 0,
      shutdown: 0,
      onBattery: 0,
      onAc: 0,
    },
  };
}

export class SleepGuard {
  private readonly blockerType: SleepBlockerType;

  private readonly now: () => string;

  private readonly snapshot: SleepGuardSnapshot;

  private readonly listeners = new Map<PowerMonitorEventName, () => void>();

  private observingPowerMonitor = false;

  constructor(private readonly dependencies: SleepGuardDependencies) {
    this.blockerType = dependencies.blockerType ?? DEFAULT_BLOCKER_TYPE;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.snapshot = createInitialSleepGuardSnapshot(this.blockerType);
  }

  start(reason: string): void {
    this.installPowerMonitorListeners();

    if (
      this.snapshot.blockerId !== null &&
      this.dependencies.powerSaveBlocker.isStarted(this.snapshot.blockerId)
    ) {
      return;
    }

    const blockerId = this.dependencies.powerSaveBlocker.start(
      this.blockerType,
    );
    const at = this.now();
    const onBatteryPower = this.readOnBatteryPower();

    this.snapshot.status = "active";
    this.snapshot.activeBlockerType = this.blockerType;
    this.snapshot.blockerId = blockerId;
    this.snapshot.isStarted = true;
    this.snapshot.startedAt = at;
    this.snapshot.stoppedAt = null;
    this.snapshot.onBatteryPower = onBatteryPower;
    this.snapshot.lastEvent = {
      type: "started",
      at,
      onBatteryPower,
    };
    this.publishSnapshot();

    this.dependencies.log({
      stream: "system",
      kind: "lifecycle",
      message: `sleep guard enabled blockerType=${this.blockerType} blockerId=${blockerId} reason=${reason} onBatteryPower=${String(onBatteryPower)}`,
    });
  }

  dispose(reason: string): void {
    this.uninstallPowerMonitorListeners();

    const blockerId = this.snapshot.blockerId;
    if (
      blockerId !== null &&
      this.dependencies.powerSaveBlocker.isStarted(blockerId)
    ) {
      this.dependencies.powerSaveBlocker.stop(blockerId);
    }

    if (blockerId !== null || this.snapshot.isStarted) {
      const at = this.now();
      this.snapshot.status = "inactive";
      this.snapshot.activeBlockerType = null;
      this.snapshot.blockerId = null;
      this.snapshot.isStarted = false;
      this.snapshot.stoppedAt = at;
      this.snapshot.lastEvent = {
        type: "stopped",
        at,
        onBatteryPower: this.snapshot.onBatteryPower,
      };
      this.publishSnapshot();

      this.dependencies.log({
        stream: "system",
        kind: "lifecycle",
        message: `sleep guard disabled blockerType=${this.blockerType} blockerId=${blockerId ?? "unknown"} reason=${reason}`,
      });
    }
  }

  private installPowerMonitorListeners(): void {
    if (this.observingPowerMonitor) {
      return;
    }

    const eventNames: readonly PowerMonitorEventName[] = [
      "suspend",
      "resume",
      "on-battery",
      "on-ac",
      "shutdown",
    ];

    for (const eventName of eventNames) {
      const listener = () => {
        this.handlePowerEvent(eventName);
      };

      this.listeners.set(eventName, listener);
      this.dependencies.powerMonitor.on(eventName, listener);
    }

    this.observingPowerMonitor = true;
  }

  private uninstallPowerMonitorListeners(): void {
    if (!this.observingPowerMonitor) {
      return;
    }

    for (const [eventName, listener] of this.listeners) {
      this.dependencies.powerMonitor.off(eventName, listener);
    }

    this.listeners.clear();
    this.observingPowerMonitor = false;
  }

  private handlePowerEvent(eventName: PowerMonitorEventName): void {
    const at = this.now();
    const onBatteryPower = this.readOnBatteryPower();

    this.snapshot.onBatteryPower = onBatteryPower;
    this.snapshot.lastEvent = {
      type: eventName,
      at,
      onBatteryPower,
    };

    if (eventName === "suspend") {
      this.snapshot.counters.suspend += 1;
    } else if (eventName === "resume") {
      this.snapshot.counters.resume += 1;
    } else if (eventName === "shutdown") {
      this.snapshot.counters.shutdown += 1;
    } else if (eventName === "on-battery") {
      this.snapshot.counters.onBattery += 1;
    } else if (eventName === "on-ac") {
      this.snapshot.counters.onAc += 1;
    }

    this.publishSnapshot();

    const prefix =
      eventName === "on-battery" || eventName === "on-ac"
        ? "sleep guard observed power source change"
        : "sleep guard observed system";

    this.dependencies.log({
      stream: "system",
      kind: "lifecycle",
      message: `${prefix} ${eventName} while active=${String(this.snapshot.isStarted)} blockerType=${this.blockerType} onBatteryPower=${String(onBatteryPower)}`,
    });
  }

  private readOnBatteryPower(): boolean {
    try {
      return this.dependencies.powerMonitor.isOnBatteryPower();
    } catch {
      return false;
    }
  }

  private publishSnapshot(): void {
    this.dependencies.onSnapshot?.(cloneSnapshot(this.snapshot));
  }
}
