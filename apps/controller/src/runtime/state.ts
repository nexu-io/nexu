export type RuntimeStatus = "active" | "degraded" | "unhealthy";

export interface ControllerRuntimeState {
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
    status: "active",
    configSyncStatus: "active",
    skillsSyncStatus: "active",
    templatesSyncStatus: "active",
    gatewayStatus: "active",
    lastConfigSyncAt: null,
    lastSkillsSyncAt: null,
    lastTemplatesSyncAt: null,
    lastGatewayProbeAt: null,
    lastGatewayError: null,
  };
}

function severity(status: RuntimeStatus): number {
  if (status === "active") return 0;
  if (status === "degraded") return 1;
  return 2;
}

export function recomputeRuntimeStatus(state: ControllerRuntimeState): void {
  const next = Math.max(
    severity(state.configSyncStatus),
    severity(state.skillsSyncStatus),
    severity(state.templatesSyncStatus),
    severity(state.gatewayStatus),
  );
  state.status = next === 0 ? "active" : next === 1 ? "degraded" : "unhealthy";
}
