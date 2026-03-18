import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://nexu:nexu@localhost:5433/nexu_dev";

export const pool = new Pool({
  connectionString: databaseUrl,
  max: 32,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// Handle pool errors to prevent unhandled 'error' events from crashing the process.
// This can happen when PGlite restarts or connections drop unexpectedly.
pool.on("error", (err) => {
  console.error("[pool] Unexpected error on idle client:", err.message);
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
