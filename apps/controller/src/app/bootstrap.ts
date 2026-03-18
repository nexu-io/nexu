import type { ControllerContainer } from "./container.js";

export async function bootstrapController(
  container: ControllerContainer,
): Promise<() => void> {
  await container.openclawProcess.prepare();
  container.openclawProcess.enableAutoRestart();
  container.openclawProcess.start();
  await container.openclawSyncService.syncAll();
  return container.startBackgroundLoops();
}
