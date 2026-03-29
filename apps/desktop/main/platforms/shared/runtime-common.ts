import type {
  DesktopPlatformCapabilities,
  DesktopRuntimeLifecycle,
  DesktopRuntimePlatformAdapter,
  PrepareRuntimeConfigArgs,
  RunPlatformColdStartArgs,
} from "../types";

function createRuntimeLifecycle(opts: {
  residency: DesktopRuntimeLifecycle["residency"];
  capabilities: DesktopPlatformCapabilities;
  prepareRuntimeConfig: DesktopRuntimeLifecycle["prepareRuntimeConfig"];
  coldStartOrAttach: DesktopRuntimeLifecycle["coldStartOrAttach"];
}): DesktopRuntimeLifecycle {
  return {
    residency: opts.residency,
    prepareRuntimeConfig: opts.prepareRuntimeConfig,
    coldStartOrAttach: opts.coldStartOrAttach,
    installShutdownCoordinator: (args) => {
      opts.capabilities.shutdownCoordinator.install(args);
    },
  };
}

export async function prepareManagedRuntimeConfig(
  adapterId: DesktopRuntimePlatformAdapter["id"],
  capabilities: DesktopPlatformCapabilities,
  { baseRuntimeConfig, env, logStartupStep }: PrepareRuntimeConfigArgs,
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
}: RunPlatformColdStartArgs) {
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
}: RunPlatformColdStartArgs) {
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
    capabilities,
    lifecycle: createRuntimeLifecycle({
      residency: "managed",
      capabilities,
      prepareRuntimeConfig: (args) =>
        prepareManagedRuntimeConfig(id, capabilities, args),
      coldStartOrAttach: (args) => runManagedColdStart(args),
    }),
  };
}

export function createExternalRuntimePlatformAdapter(
  id: DesktopRuntimePlatformAdapter["id"],
  capabilities: DesktopPlatformCapabilities,
): DesktopRuntimePlatformAdapter {
  return {
    id,
    capabilities,
    lifecycle: createRuntimeLifecycle({
      residency: "external",
      capabilities,
      prepareRuntimeConfig: async ({ baseRuntimeConfig, logStartupStep }) => {
        logStartupStep(`${id}:prepareRuntimeConfig:external`);
        return {
          allocations: [],
          runtimeConfig: baseRuntimeConfig,
        };
      },
      coldStartOrAttach: (args) => runExternalColdStart(args),
    }),
  };
}
