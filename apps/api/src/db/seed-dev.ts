import "dotenv/config";
import pg from "pg";

/**
 * Idempotent seed for local development.
 * Creates a gateway pool and invite code if they don't already exist.
 * Safe to run multiple times (uses ON CONFLICT DO NOTHING).
 */
export async function seedDev(dbUrl?: string) {
  const databaseUrl =
    dbUrl ??
    process.env.DATABASE_URL ??
    "postgresql://nexu:nexu@localhost:5433/nexu_dev";

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  // In Docker Compose, 'gateway' resolves via DNS; locally use '127.0.0.1'
  const podIp = process.env.AUTO_SEED === "true" ? "gateway" : "127.0.0.1";

  try {
    // Gateway pool for local dev
    await client.query(
      `
      INSERT INTO gateway_pools (id, pool_name, pool_type, max_bots, status, pod_ip, created_at)
      VALUES ('pool_local_01', 'local-dev', 'shared', 50, 'active', $1, NOW()::text)
      ON CONFLICT (id) DO UPDATE SET pod_ip = $1, status = 'active'
    `,
      [podIp],
    );

    // Invite code for registration
    await client.query(`
      INSERT INTO invite_codes (id, code, max_uses, used_count, created_at)
      VALUES ('invite_seed_01', 'NEXU2026', 1000, 0, NOW()::text)
      ON CONFLICT (code) DO NOTHING
    `);

    console.log(
      `Dev seed completed (pool_local_01 [pod_ip=${podIp}] + invite code NEXU2026)`,
    );
  } finally {
    await client.end();
  }
}

// Direct execution: pnpm db:seed
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seedDev().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
