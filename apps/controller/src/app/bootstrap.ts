import type { ControllerContainer } from "./container.js";

export async function bootstrapController(
  container: ControllerContainer,
): Promise<() => void> {
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

  // Write config files BEFORE starting OpenClaw so it boots with the
  // correct configuration, avoiding a SIGUSR1 restart cycle on first connect.
  // Use syncAllImmediate() to bypass debounce — must complete before start().
  // This also seeds the push hash via noteConfigWritten(), so the onConnected
  // syncAll() sees no change and skips the redundant config.apply RPC.
  await container.openclawSyncService.syncAllImmediate();

  // Enter settling mode: all syncAll() calls during the next 3s are
  // deferred and flushed once at the end, preventing multiple config.apply
  // restarts from async setup (cloud connect, model selection, bot creation).
  container.openclawSyncService.beginSettling();

  container.openclawProcess.enableAutoRestart();
  container.openclawProcess.start();
  container.channelFallbackService.start();

  // Start WS client — connects to OpenClaw gateway
  container.wsClient.connect();

  container.wsClient.onGatewayShutdown(({ restartExpectedMs }) => {
    if (restartExpectedMs !== null) {
      container.openclawProcess.noteControlledRestartExpected("ws-shutdown");
    }
  });

  // When WS handshake completes, push current config (skipped if unchanged)
  // and mark boot as complete so health loop treats future gateway-unreachable
  // as "unhealthy" instead of "starting".
  container.wsClient.onConnected(() => {
    container.runtimeState.bootPhase = "ready";
    void container.openclawSyncService.syncAll().catch(() => {});
  });

  return container.startBackgroundLoops();
}
