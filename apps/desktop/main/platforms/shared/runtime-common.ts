import type {
  DesktopPlatformCapabilities,
  DesktopRuntimePlatformAdapter,
} from "../types";

export async function prepareManagedRuntimeConfig(
  adapterId: DesktopRuntimePlatformAdapter["id"],
  capabilities: DesktopPlatformCapabilities,
  {
    baseRuntimeConfig,
    env,
    logStartupStep,
  }: Parameters<DesktopRuntimePlatformAdapter["prepareRuntimeConfig"]>[0],
) {
  logStartupStep(`${adapterId}:prepareRuntimeConfig:start`);
  try {
    const result = await capabilities.portStrategy.allocateRuntimePorts({
      baseRuntimeConfig,
      env,
      logStartupStep,
    });
    logStartupStep(`${adapterId}:prepareRuntimeConfig:done`);
    return result;
  } catch (error) {
    logStartupStep(
      `${adapterId}:prepareRuntimeConfig:fail ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

export async function runManagedColdStart({
  diagnosticsReporter,
  logColdStart,
  logStartupStep,
  orchestrator,
  rotateDesktopLogSession,
  waitForControllerReadiness,
}: Parameters<DesktopRuntimePlatformAdapter["runColdStart"]>[0]) {
  logStartupStep("managedColdStart:start");
  diagnosticsReporter?.markColdStartRunning("starting controller");
  logColdStart("starting controller");
  await orchestrator.startOne("controller");

  diagnosticsReporter?.markColdStartRunning("waiting for controller readiness");
  logColdStart("waiting for controller readiness");
  await waitForControllerReadiness();

  diagnosticsReporter?.markColdStartRunning("starting web");
  logColdStart("starting web");
  await orchestrator.startOne("web");

  const sessionId = rotateDesktopLogSession();
  logColdStart(`cold start session ready sessionId=${sessionId}`);
  logColdStart("cold start complete");
  diagnosticsReporter?.markColdStartSucceeded();
  logStartupStep("managedColdStart:done");

  return {
    launchdResult: null,
  };
}

export async function runExternalColdStart({
  diagnosticsReporter,
  logColdStart,
  logStartupStep,
  rotateDesktopLogSession,
  waitForControllerReadiness,
}: Parameters<DesktopRuntimePlatformAdapter["runColdStart"]>[0]) {
  logStartupStep("externalColdStart:start");
  diagnosticsReporter?.markColdStartRunning("attaching to external runtime");
  logColdStart("attaching to external runtime");

  diagnosticsReporter?.markColdStartRunning(
    "waiting for external controller readiness",
  );
  logColdStart("waiting for external controller readiness");
  await waitForControllerReadiness();

  const sessionId = rotateDesktopLogSession();
  logColdStart(`external runtime session ready sessionId=${sessionId}`);
  logColdStart("external runtime attach complete");
  diagnosticsReporter?.markColdStartSucceeded();
  logStartupStep("externalColdStart:done");

  return {
    launchdResult: null,
  };
}

export function createManagedRuntimePlatformAdapter(
  id: DesktopRuntimePlatformAdapter["id"],
  capabilities: DesktopPlatformCapabilities,
): DesktopRuntimePlatformAdapter {
  return {
    id,
    mode: "managed",
    capabilities,
    prepareRuntimeConfig: (args) =>
      prepareManagedRuntimeConfig(id, capabilities, args),
    runColdStart: (args) => runManagedColdStart(args),
  };
}

export function createExternalRuntimePlatformAdapter(
  id: DesktopRuntimePlatformAdapter["id"],
  capabilities: DesktopPlatformCapabilities,
): DesktopRuntimePlatformAdapter {
  return {
    id,
    mode: "external",
    capabilities,
    prepareRuntimeConfig: async ({ baseRuntimeConfig, logStartupStep }) => {
      logStartupStep(`${id}:prepareRuntimeConfig:external`);
      return {
        allocations: [],
        runtimeConfig: baseRuntimeConfig,
      };
    },
    runColdStart: (args) => runExternalColdStart(args),
  };
}
