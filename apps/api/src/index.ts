import "./datadog.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { migrate } from "./db/migrate.js";

async function main() {
  await migrate();

  if (process.env.AUTO_SEED === "true") {
    const { seedDev } = await import("./db/seed-dev.js");
    await seedDev();
  }

  const app = createApp();
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Nexu API listening on http://localhost:${info.port}`);
  });
}

main().catch(console.error);
