import { serve } from "@hono/node-server";
import { bootstrapController } from "./app/bootstrap.js";
import { createContainer } from "./app/container.js";
import { createApp } from "./app/create-app.js";
import { logger } from "./lib/logger.js";

async function main(): Promise<void> {
  const container = await createContainer();
  const stopBackgroundLoops = await bootstrapController(container);
  const app = createApp(container);

  const server = serve(
    {
      fetch: app.fetch,
      hostname: container.env.host,
      port: container.env.port,
    },
    (info) => {
      logger.info(
        { host: info.address, port: info.port },
        "controller started",
      );
    },
  );

  const shutdown = async () => {
    stopBackgroundLoops();
    server.close();
    await container.openclawProcess.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "controller failed to start",
  );
  process.exitCode = 1;
});
