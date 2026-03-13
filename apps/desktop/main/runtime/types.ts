import type {
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
  port: number | null;
  startupTimeoutMs?: number;
  autoStart: boolean;
  env?: NodeJS.ProcessEnv;
};

export type RuntimeUnitRecord = {
  manifest: RuntimeUnitManifest;
  phase: RuntimeUnitPhase;
  pid: number | null;
  startedAt: string | null;
  exitedAt: string | null;
  exitCode: number | null;
  lastError: string | null;
  logTail: string[];
  stdoutRemainder: string;
  stderrRemainder: string;
};
