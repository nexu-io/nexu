import type {
  RuntimeLogEntry,
  RuntimeReasonCode,
  RuntimeUnitId,
  RuntimeUnitKind,
  RuntimeUnitLaunchStrategy,
  RuntimeUnitPhase,
} from "../../shared/host";

export type RuntimeUnitRunner = "spawn" | "utility-process";

export type RuntimeUnitManifest = {
  id: RuntimeUnitId;
  label: string;
  kind: RuntimeUnitKind;
  launchStrategy: RuntimeUnitLaunchStrategy;
  runner?: RuntimeUnitRunner;
  command?: string;
  args?: string[];
  modulePath?: string;
  cwd?: string;
  delegatedProcessMatch?: string;
  /** Launchd service label (e.g. "io.nexu.controller.dev") for launchd-managed units. */
  launchdLabel?: string;
  /** Directory where launchd writes stdout/stderr log files for this unit. */
  launchdLogDir?: string;
  binaryPath?: string;
  port: number | null;
  startupTimeoutMs?: number;
  autoStart: boolean;
  env?: NodeJS.ProcessEnv;
  logFilePath?: string;
  /** Units that depend on this one and should be restarted when this unit restarts. */
  dependents?: RuntimeUnitId[];
  /** Whether to auto-restart on unexpected exit. Defaults to true. */
  autoRestart?: boolean;
};

export type RuntimeUnitRecord = {
  manifest: RuntimeUnitManifest;
  phase: RuntimeUnitPhase;
  pid: number | null;
  startedAt: string | null;
  exitedAt: string | null;
  exitCode: number | null;
  lastError: string | null;
  lastReasonCode: RuntimeReasonCode | null;
  lastProbeAt: string | null;
  restartCount: number;
  currentActionId: string | null;
  logFilePath: string | null;
  logTail: RuntimeLogEntry[];
  stdoutRemainder: string;
  stderrRemainder: string;
  /** Consecutive auto-restart attempts since last successful run or explicit stop. */
  autoRestartAttempts: number;
  /** Set to true when unit is explicitly stopped to suppress auto-restart. */
  stoppedByUser: boolean;
};
