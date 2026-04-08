import type { DesktopRuntimeConfig, RuntimeState } from "../../shared/host";

export function isOpenClawSurfaceReady(
  runtimeState: RuntimeState | null,
): boolean {
  return (
    runtimeState?.units.some(
      (unit) => unit.id === "openclaw" && unit.phase === "running",
    ) ?? false
  );
}

export function getDesktopOpenClawUrl(input: {
  runtimeConfig: Pick<DesktopRuntimeConfig, "urls" | "tokens"> | null;
  runtimeState: RuntimeState | null;
}): string | null {
  if (!input.runtimeConfig || !isOpenClawSurfaceReady(input.runtimeState)) {
    return null;
  }

  return new URL(
    `/#token=${input.runtimeConfig.tokens.gateway}`,
    input.runtimeConfig.urls.openclawBase,
  ).toString();
}
