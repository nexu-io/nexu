import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

type HealthState = {
  version: string;
  consecutiveFailures: number;
  lastCheck: string;
};

export type HealthCheckResult = {
  healthy: boolean;
  consecutiveFailures: number;
  version: string;
};

const MAX_CONSECUTIVE_FAILURES = 3;

export class StartupHealthCheck {
  private readonly stateFilePath: string;

  constructor() {
    this.stateFilePath = join(app.getPath("userData"), "startup-health.json");
  }

  check(): HealthCheckResult {
    const state = this.readState();
    const currentVersion = app.getVersion();

    if (state.version !== currentVersion) {
      this.writeState({
        version: currentVersion,
        consecutiveFailures: 0,
        lastCheck: new Date().toISOString(),
      });

      return {
        healthy: true,
        consecutiveFailures: 0,
        version: currentVersion,
      };
    }

    return {
      healthy: state.consecutiveFailures < MAX_CONSECUTIVE_FAILURES,
      consecutiveFailures: state.consecutiveFailures,
      version: currentVersion,
    };
  }

  recordSuccess(): void {
    this.writeState({
      version: app.getVersion(),
      consecutiveFailures: 0,
      lastCheck: new Date().toISOString(),
    });
  }

  recordFailure(): void {
    const state = this.readState();
    this.writeState({
      version: app.getVersion(),
      consecutiveFailures: state.consecutiveFailures + 1,
      lastCheck: new Date().toISOString(),
    });
  }

  private readState(): HealthState {
    if (!existsSync(this.stateFilePath)) {
      return {
        version: app.getVersion(),
        consecutiveFailures: 0,
        lastCheck: new Date().toISOString(),
      };
    }

    try {
      return JSON.parse(
        readFileSync(this.stateFilePath, "utf8"),
      ) as HealthState;
    } catch {
      return {
        version: app.getVersion(),
        consecutiveFailures: 0,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  private writeState(state: HealthState): void {
    mkdirSync(dirname(this.stateFilePath), { recursive: true });
    writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), "utf8");
  }
}
