import "./datadog.js";
import { bootstrapGateway } from "./bootstrap.js";
import { BaseError, logger } from "./log.js";
import {
  runDiscordSessionSyncLoop,
  runFeishuSessionSyncLoop,
  runGatewayHealthLoops,
  runHeartbeatLoop,
  runSkillsPollLoop,
  runSlackTokenHealthLoop,
  runWorkspaceTemplatesPollLoop,
} from "./loops.js";
import { stopManagedOpenclawGateway } from "./openclaw-process.js";
import { createRuntimeState } from "./state.js";

const state = createRuntimeState();

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down gateway sidecar");
  stopManagedOpenclawGateway().then(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main(): Promise<void> {
  await bootstrapGateway(state);

  runGatewayHealthLoops(state);
  void runHeartbeatLoop(state);
  void runDiscordSessionSyncLoop();
  void runFeishuSessionSyncLoop();
  void runSkillsPollLoop(state);
  void runSlackTokenHealthLoop();
  void runWorkspaceTemplatesPollLoop(state);

  // Config is now pushed via WS from API → OpenClaw directly.
  // Keep the process alive since other loops still run.
  await new Promise(() => {});
}

main().catch((error: unknown) => {
  stopManagedOpenclawGateway();
  logger.error(BaseError.from(error).toJSON(), "fatal error");
  process.exitCode = 1;
});
