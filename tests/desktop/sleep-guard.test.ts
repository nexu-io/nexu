import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  SleepGuard,
  type SleepGuardLogEntry,
  type SleepGuardSnapshot,
} from "#desktop/main/sleep-guard";

class FakePowerMonitor extends EventEmitter {
  private onBatteryPower = false;

  isOnBatteryPower(): boolean {
    return this.onBatteryPower;
  }

  setBatteryPower(value: boolean): void {
    this.onBatteryPower = value;
  }
}

class FakePowerSaveBlocker {
  private nextId = 1;

  readonly active = new Map<number, string>();

  start(type: "prevent-app-suspension" | "prevent-display-sleep"): number {
    const id = this.nextId++;
    this.active.set(id, type);
    return id;
  }

  stop(id: number): boolean {
    return this.active.delete(id);
  }

  isStarted(id: number): boolean {
    return this.active.has(id);
  }
}

function createGuard() {
  const powerMonitor = new FakePowerMonitor();
  const powerSaveBlocker = new FakePowerSaveBlocker();
  const logs: SleepGuardLogEntry[] = [];
  const snapshots: SleepGuardSnapshot[] = [];
  let tick = 0;
  const guard = new SleepGuard({
    powerMonitor,
    powerSaveBlocker,
    log: (entry) => {
      logs.push(entry);
    },
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
    },
    now: () => `2026-03-20T00:00:0${tick++}.000Z`,
  });

  return {
    guard,
    logs,
    powerMonitor,
    powerSaveBlocker,
    snapshots,
  };
}

describe("SleepGuard", () => {
  it("starts app-suspension blocker and publishes active state", () => {
    const { guard, logs, powerSaveBlocker, snapshots } = createGuard();

    guard.start("desktop-runtime-active");

    expect([...powerSaveBlocker.active.values()]).toEqual([
      "prevent-app-suspension",
    ]);
    expect(snapshots.at(-1)).toMatchObject({
      activeBlockerType: "prevent-app-suspension",
      blockerId: 1,
      isStarted: true,
      lastEvent: {
        onBatteryPower: false,
        type: "started",
      },
      requestedBlockerType: "prevent-app-suspension",
      status: "active",
    });
    expect(logs.at(-1)).toMatchObject({
      kind: "lifecycle",
      message:
        "sleep guard enabled blockerType=prevent-app-suspension blockerId=1 reason=desktop-runtime-active onBatteryPower=false",
      stream: "system",
    });
  });

  it("records power events while active so unexpected suspend is diagnosable", () => {
    const { guard, logs, powerMonitor, snapshots } = createGuard();

    guard.start("desktop-runtime-active");
    powerMonitor.setBatteryPower(true);
    powerMonitor.emit("on-battery");
    powerMonitor.emit("suspend");
    powerMonitor.setBatteryPower(false);
    powerMonitor.emit("resume");

    expect(snapshots.at(-1)).toMatchObject({
      counters: {
        resume: 1,
        shutdown: 0,
        suspend: 1,
      },
      lastEvent: {
        onBatteryPower: false,
        type: "resume",
      },
      onBatteryPower: false,
      status: "active",
    });
    expect(logs.map((entry) => entry.message)).toContain(
      "sleep guard observed system suspend while active=true blockerType=prevent-app-suspension onBatteryPower=true",
    );
  });

  it("stops the blocker and removes listeners on dispose", () => {
    const { guard, logs, powerMonitor, powerSaveBlocker, snapshots } =
      createGuard();

    guard.start("desktop-runtime-active");
    guard.dispose("app-before-quit");
    powerMonitor.emit("suspend");

    expect(powerSaveBlocker.active.size).toBe(0);
    expect(snapshots.at(-1)).toMatchObject({
      blockerId: null,
      isStarted: false,
      lastEvent: {
        onBatteryPower: false,
        type: "stopped",
      },
      status: "inactive",
    });
    expect(logs.at(-1)).toMatchObject({
      kind: "lifecycle",
      message:
        "sleep guard disabled blockerType=prevent-app-suspension blockerId=1 reason=app-before-quit",
      stream: "system",
    });
    expect(logs.map((entry) => entry.message)).not.toContain(
      "sleep guard observed system suspend while active=false blockerType=prevent-app-suspension onBatteryPower=false",
    );
  });
});
