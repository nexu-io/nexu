import "./datadog.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { db, pool } from "./db/index.js";
import { BaseError } from "./lib/error.js";
import { logger } from "./lib/logger.js";
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

async function main() {
  loadEnv();

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
