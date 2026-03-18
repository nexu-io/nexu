import "./datadog.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { createApp } from "./app.js";
import { db, pool } from "./db/index.js";
import { BaseError } from "./lib/error.js";
import { logger } from "./lib/logger.js";
import { warmupDesktopAuth } from "./middleware/desktop-auth.js";
import { refreshCloudModelsOnStartup } from "./routes/desktop-local-routes.js";
import {
  startPoolHealthMonitor,
  stopPoolHealthMonitor,
} from "./services/runtime/pool-health-monitor.js";

function loadEnv() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const apiDir = resolve(moduleDir, "..");
  const candidates = [resolve(process.cwd(), ".env"), resolve(apiDir, ".env")];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    dotenv.config({
      path,
      override: false,
    });
  }
}

async function waitForDatabase(maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use both pool.query and Drizzle to warm up connections.
      // This ensures Drizzle's first real query doesn't block.
      await pool.query("SELECT 1");
      await db.execute(sql`SELECT 1`);
      logger.info({ message: "database_connected", attempt });
      return;
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      logger.warn({
        message: "database_connection_retry",
        attempt,
        maxRetries,
        error: err instanceof Error ? err.message : String(err),
      });
      if (isLastAttempt) {
        throw new Error(
          `Failed to connect to database after ${maxRetries} attempts`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  loadEnv();

  // Wait for database to be ready BEFORE starting the HTTP server.
  // This prevents requests from being accepted while DB is unavailable.
  await waitForDatabase();

  // Pre-warm desktop auth to avoid blocking the first v1 request
  await warmupDesktopAuth();

  if (process.env.AUTO_SEED === "true") {
    const { seedDev } = await import("./db/seed-dev.js");
    await seedDev();
  }

  const app = createApp();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  const server = serve({ fetch: app.fetch, port }, (info) => {
    logger.info({
      message: "server_started",
      port: info.port,
    });
  });

  // Retry on EADDRINUSE — tsx watch may start the new process before the old
  // one has fully released the port.
  let retries = 5;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && retries > 0) {
      retries--;
      logger.warn({
        message: "port_in_use_retrying",
        port,
        retries_left: retries,
      });
      setTimeout(() => server.listen(port), 1000);
    }
  });

  startPoolHealthMonitor(db);

  // Refresh cloud models from Link gateway (best-effort, non-blocking)
  refreshCloudModelsOnStartup();

  const shutdown = () => {
    stopPoolHealthMonitor();
    server.close();
    pool.end().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  const baseError = BaseError.from(err);
  logger.error({
    message: "server_start_failed",
    ...baseError.toJSON(),
  });
});
