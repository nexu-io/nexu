import { serve } from "@hono/node-server";
import { bootstrapController } from "./app/bootstrap.js";
import { createContainer } from "./app/container.js";
import { createApp } from "./app/create-app.js";
import { logger } from "./lib/logger.js";
import { flushV8CoverageIfEnabled } from "./lib/v8-coverage.js";

async function main(): Promise<void> {
  const container = await createContainer();
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

  let stopBackgroundLoops = () => {};

  let shuttingDown = false;

  const closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    stopBackgroundLoops();

    try {
      await closeServer();
    } catch (error: unknown) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "controller shutdown server close failed",
      );
    }

    try {
      await container.openclawProcess.stop();
    } catch (error: unknown) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "controller shutdown stop failed",
      );
    } finally {
      flushV8CoverageIfEnabled();
      process.exit(0);
    }
  };

  try {
    stopBackgroundLoops = await bootstrapController(container);
  } catch (error) {
    try {
      await closeServer();
    } catch {
      // Best-effort cleanup on bootstrap failure.
    }

    try {
      await container.openclawProcess.stop();
    } catch {
      // Best-effort cleanup on bootstrap failure.
    }

    throw error;
  }

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
