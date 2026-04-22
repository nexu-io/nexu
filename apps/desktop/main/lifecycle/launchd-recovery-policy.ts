import type { LaunchdRuntimeSessionMetadata } from "./launchd-session-store";

export interface LaunchdRecoveryEnvIdentity {
  isDev: boolean;
  appVersion?: string;
  nexuHome?: string;
  openclawStateDir?: string;
  userDataPath?: string;
  buildSource?: string;
  runtimeIdentityPath?: string;
}

export interface LaunchdRecoveredPorts {
  controllerPort: number;
  openclawPort: number;
  webPort: number;
}

export type LaunchdRecoveryDecision =
  | {
      action: "fresh-start";
    }
  | {
      action: "teardown-stale-services";
      reason: string;
      deleteSession: boolean;
    }
  | {
      action: "reuse-ports";
      effectivePorts: LaunchdRecoveredPorts;
      previousElectronAlive: boolean;
      reason: string;
    };

const STALE_SESSION_THRESHOLD_MS = 5 * 60 * 1000;

export function detectStaleLaunchdSession(args: {
  metadata: LaunchdRuntimeSessionMetadata;
  nowMs?: number;
  isElectronAlive: boolean;
}): { stale: boolean; reason?: string } {
  const nowMs = args.nowMs ?? Date.now();
  const metadataAgeMs = nowMs - new Date(args.metadata.writtenAt).getTime();

  if (!args.isElectronAlive && metadataAgeMs > STALE_SESSION_THRESHOLD_MS) {
    return {
      stale: true,
      reason:
        `Stale session detected: previous Electron pid=${args.metadata.electronPid} is dead, ` +
        `metadata age=${Math.round(metadataAgeMs / 1000)}s. Cleaning up launchd services.`,
    };
  }

  return { stale: false };
}

export function decideLaunchdRecovery(args: {
  recovered: LaunchdRuntimeSessionMetadata | null;
  env: LaunchdRecoveryEnvIdentity;
  anyRunning: boolean;
  runningNexuHome?: string;
  defaultWebPort: number;
  previousElectronAlive?: boolean;
}): LaunchdRecoveryDecision {
  const {
    recovered,
    env,
    anyRunning,
    runningNexuHome,
    defaultWebPort,
    previousElectronAlive,
  } = args;

  if (!recovered) {
    return anyRunning
      ? {
          action: "teardown-stale-services",
          reason:
            "Services running but no runtime-ports.json found, tearing down for clean start",
          deleteSession: false,
        }
      : { action: "fresh-start" };
  }

  if (!anyRunning || recovered.isDev !== env.isDev) {
    return { action: "fresh-start" };
  }

  const versionMismatch =
    env.appVersion != null && recovered.appVersion !== env.appVersion;
  const missingRuntimeIdentityMismatch =
    !versionMismatch &&
    !env.isDev &&
    env.runtimeIdentityPath != null &&
    recovered.runtimeIdentityPath == null;
  const identityMismatch =
    !versionMismatch &&
    (
      [
        [recovered.openclawStateDir, env.openclawStateDir],
        [recovered.userDataPath, env.userDataPath],
        [recovered.buildSource, env.buildSource],
        [recovered.runtimeIdentityPath, env.runtimeIdentityPath],
      ] as const
    ).some(
      ([recoveredVal, envVal]) =>
        recoveredVal != null && envVal != null && recoveredVal !== envVal,
    );

  if (versionMismatch || missingRuntimeIdentityMismatch || identityMismatch) {
    return {
      action: "teardown-stale-services",
      reason: versionMismatch
        ? `App version changed (${recovered.appVersion} -> ${env.appVersion})`
        : missingRuntimeIdentityMismatch
          ? "Build identity mismatch (runtimeIdentityPath missing from recovered packaged session metadata)"
          : "Build identity mismatch (openclawStateDir, userDataPath, buildSource, or runtimeIdentityPath differ)",
      deleteSession: true,
    };
  }

  if (env.nexuHome && runningNexuHome && runningNexuHome !== env.nexuHome) {
    return {
      action: "teardown-stale-services",
      reason: `NEXU_HOME mismatch (expected=${env.nexuHome} actual=${runningNexuHome}), tearing down stale services`,
      deleteSession: false,
    };
  }

  const electronAlive = previousElectronAlive ?? true;
  return {
    action: "reuse-ports",
    effectivePorts: {
      controllerPort: recovered.controllerPort,
      openclawPort: recovered.openclawPort,
      webPort: electronAlive ? recovered.webPort : defaultWebPort,
    },
    previousElectronAlive: electronAlive,
    reason: electronAlive
      ? `Recovering ports from previous session (controller=${recovered.controllerPort} openclaw=${recovered.openclawPort} web=${recovered.webPort})`
      : `Recovering controller/openclaw ports from previous session with fresh web port ${defaultWebPort}`,
  };
}
