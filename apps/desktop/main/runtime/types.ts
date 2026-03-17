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
  binaryPath?: string;
  port: number | null;
  startupTimeoutMs?: number;
  autoStart: boolean;
  env?: NodeJS.ProcessEnv;
  logFilePath?: string;
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
};
