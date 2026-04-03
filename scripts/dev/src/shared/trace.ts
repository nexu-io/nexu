import { createRunId } from "@nexu/dev-utils";

export type DevService = "controller" | "web" | "openclaw" | "desktop";
export type DevRole = "supervisor" | "worker";

export function createDevSessionId(): string {
  return createRunId();
}

export function createDevTraceEnv({
  sessionId,
  service,
  role,
}: {
  sessionId: string;
  service: DevService;
  role: DevRole;
}): NodeJS.ProcessEnv {
  return {
    NEXU_DEV_SESSION_ID: sessionId,
    NEXU_DEV_SERVICE: service,
    NEXU_DEV_ROLE: role,
  };
}

export function createDevMarkerArgs({
  sessionId,
  service,
  role,
}: {
  sessionId: string;
  service: DevService;
  role: DevRole;
}): string[] {
  return [
    `--nexu-dev-service=${service}`,
    `--nexu-dev-role=${role}`,
    `--nexu-dev-session=${sessionId}`,
  ];
}
