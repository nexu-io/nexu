import "./datadog.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { migrate } from "./db/migrate.js";
import { BaseError } from "./lib/error.js";
import { logger } from "./lib/logger.js";

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
  await migrate();

  if (process.env.AUTO_SEED === "true") {
    const { seedDev } = await import("./db/seed-dev.js");
    await seedDev();
  }

  const app = createApp();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  serve({ fetch: app.fetch, port }, (info) => {
    logger.info({
      message: "server_started",
      port: info.port,
    });
  });
}

main().catch((err) => {
  const baseError = BaseError.from(err);
  logger.error({
    message: "server_start_failed",
    ...baseError.toJSON(),
  });
});
