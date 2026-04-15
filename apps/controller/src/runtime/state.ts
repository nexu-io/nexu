export type RuntimeStatus = "active" | "starting" | "degraded" | "unhealthy";

export type BootPhase =
  | "preparing"
  | "starting-managed-runtime"
  | "attaching-external-runtime"
  | "reconciling-runtime"
  | "stabilizing-runtime"
  | "ready";

export function isBootPhasePreReady(bootPhase: BootPhase): boolean {
  return bootPhase !== "ready";
}

export interface ControllerRuntimeState {
  /** Global bootstrap phase — pre-ready states represent controlled startup. */
  bootPhase: BootPhase;
  status: RuntimeStatus;
  configSyncStatus: RuntimeStatus;
  skillsSyncStatus: RuntimeStatus;
  templatesSyncStatus: RuntimeStatus;
  gatewayStatus: RuntimeStatus;
  lastConfigSyncAt: string | null;
  lastSkillsSyncAt: string | null;
  lastTemplatesSyncAt: string | null;
  lastGatewayProbeAt: string | null;
  lastGatewayError: string | null;
}

export function createRuntimeState(): ControllerRuntimeState {
  return {
    bootPhase: "preparing",
    status: "starting",
    configSyncStatus: "active",
    skillsSyncStatus: "active",
    templatesSyncStatus: "active",
    gatewayStatus: "starting",
    lastConfigSyncAt: null,
    lastSkillsSyncAt: null,
    lastTemplatesSyncAt: null,
    lastGatewayProbeAt: null,
    lastGatewayError: null,
  };
}

function severity(status: RuntimeStatus): number {
  if (status === "active") return 0;
  if (status === "starting") return 1;
  if (status === "degraded") return 2;
  return 3;
}

const SEVERITY_TO_STATUS: RuntimeStatus[] = [
  "active",
  "starting",
  "degraded",
  "unhealthy",
];

export function recomputeRuntimeStatus(state: ControllerRuntimeState): void {
  const next = Math.max(
    severity(state.configSyncStatus),
    severity(state.skillsSyncStatus),
    severity(state.templatesSyncStatus),
    severity(state.gatewayStatus),
  );
  state.status = SEVERITY_TO_STATUS[next] ?? "unhealthy";
}
