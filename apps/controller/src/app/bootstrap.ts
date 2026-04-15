import { logger } from "../lib/logger.js";
import type { ControllerContainer } from "./container.js";

const INITIAL_CONTROL_PLANE_READY_TIMEOUT_MS = 30_000;
const STABLE_CONTROL_PLANE_TIMEOUT_MS = 45_000;
const MANAGED_STABLE_CONTROL_PLANE_TIMEOUT_MS = 90_000;
const STABLE_CONTROL_PLANE_WINDOW_MS = 4_000;
const CONTROL_PLANE_POLL_INTERVAL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGatewayConnection(
  container: ControllerContainer,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (container.wsClient.isConnected()) {
      return;
    }

    await sleep(CONTROL_PLANE_POLL_INTERVAL_MS);
  }

  throw new Error(
    "controller bootstrap timed out waiting for gateway connection",
  );
}

async function waitForStableControlPlane(
  container: ControllerContainer,
  timeoutMs: number,
  stableWindowMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let stableSince: number | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await container.controlPlaneHealth.probe({
      timeoutMs: 1500,
    });

    if (result.ok) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stableWindowMs) {
        return;
      }
    } else {
      stableSince = null;
    }

    await sleep(CONTROL_PLANE_POLL_INTERVAL_MS);
  }

  throw new Error(
    "controller bootstrap timed out waiting for a stable control plane",
  );
}

export async function bootstrapController(
  container: ControllerContainer,
): Promise<() => void> {
  container.runtimeState.bootPhase = "preparing";

  logger.info(
    {
      nexuHomeDir: container.env.nexuHomeDir,
      openclawOwnershipMode: container.env.openclawOwnershipMode,
      openclawBaseUrl: container.env.openclawBaseUrl,
      openclawConfigPath: container.env.openclawConfigPath,
      openclawStateDir: container.env.openclawStateDir,
      openclawSkillsDir: container.env.openclawSkillsDir,
      openclawWorkspaceTemplatesDir:
        container.env.openclawWorkspaceTemplatesDir,
      openclawLogDir: container.env.openclawLogDir,
      platformTemplatesDir: container.env.platformTemplatesDir ?? null,
    },
    "controller_bootstrap_runtime_contract",
  );

  // Run independent prep tasks in parallel to shave off startup time.
  // All three are independent: process cleanup, plugin files, cloud model fetch.
  await Promise.all([
    container.openclawProcess.prepare(),
    container.openclawSyncService.ensureRuntimeModelPlugin(),
    container.configStore
      .prepareDesktopCloudModelsForBootstrap()
      .catch(() => {}),
  ]);

  // Validate default model against available models before first sync
  await container.modelProviderService.ensureValidDefaultModel();

  // Ensure bundled skills are on disk and the skill ledger is up to date
  // BEFORE the first config push.  Without this, the compiled agent
  // allowlist may be missing newly-bundled skills, causing them to be
  // invisible to the running agent until a restart.
  container.skillhubService.bootstrap();

  container.channelFallbackService.start();

  container.wsClient.onGatewayShutdown(({ restartExpectedMs }) => {
    if (restartExpectedMs !== null) {
      container.openclawProcess.noteControlledRestartExpected("ws-shutdown");
    }
  });

  if (container.openclawProcess.managesProcess()) {
    // Managed bootstrap: seed config before runtime start so the first attach
    // happens against the desired config instead of triggering a restart.
    await container.openclawSyncService.syncAllImmediate();
    container.openclawSyncService.beginSettling();

    container.runtimeState.bootPhase = "starting-managed-runtime";
    container.openclawProcess.enableAutoRestart();
    container.openclawProcess.start();
    container.wsClient.connect();

    container.runtimeState.bootPhase = "stabilizing-runtime";
    await waitForStableControlPlane(
      container,
      MANAGED_STABLE_CONTROL_PLANE_TIMEOUT_MS,
      STABLE_CONTROL_PLANE_WINDOW_MS,
    );
  } else {
    // External bootstrap is attach + reconcile, not pre-start seeding.
    logger.info({}, "controller_bootstrap_attaching_external_openclaw");

    container.runtimeState.bootPhase = "attaching-external-runtime";
    container.wsClient.connect();
    await waitForGatewayConnection(
      container,
      INITIAL_CONTROL_PLANE_READY_TIMEOUT_MS,
    );

    container.runtimeState.bootPhase = "reconciling-runtime";
    const { configChanged } =
      await container.openclawSyncService.syncAllImmediate();
    container.openclawSyncService.beginSettling();

    container.runtimeState.bootPhase = "stabilizing-runtime";
    await waitForStableControlPlane(
      container,
      configChanged
        ? STABLE_CONTROL_PLANE_TIMEOUT_MS
        : INITIAL_CONTROL_PLANE_READY_TIMEOUT_MS,
      configChanged ? STABLE_CONTROL_PLANE_WINDOW_MS : 1_000,
    );
  }

  container.runtimeState.bootPhase = "ready";

  return container.startBackgroundLoops();
}
