import { createCipheriv, randomBytes } from "node:crypto";
import "dotenv/config";
import pg from "pg";

// ── Inline encrypt (mirrors apps/api/src/lib/crypto.ts) ─────────────────────
// We duplicate the encrypt logic here so the seed script stays self-contained
// and doesn't pull in the full app dependency graph.

function encryptValue(plaintext: string): string {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) throw new Error("ENCRYPTION_KEY env var is required");
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32)
    throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

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

    // ── Feishu official bot (webhook mode) ──────────────────────────────────
    // Reads FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_VERIFICATION_TOKEN from
    // .env. If present, seeds the bot channel, credentials, and webhook route
    // so the /api/feishu/events endpoint works out-of-the-box.
    const feishuAppId = process.env.FEISHU_APP_ID;
    const feishuAppSecret = process.env.FEISHU_APP_SECRET;
    const feishuVerificationToken = process.env.FEISHU_VERIFICATION_TOKEN;

    if (feishuAppId && feishuAppSecret && feishuVerificationToken) {
      const accountId = `feishu-${feishuAppId}`;
      const botChannelId = "feishu_webhook_01";
      const now = new Date().toISOString();

      // 1. Find (or skip) the first active bot assigned to pool_local_01
      const botResult = await client.query(
        `SELECT id FROM bots WHERE pool_id = 'pool_local_01' AND status = 'active' LIMIT 1`,
      );
      const botId = (botResult.rows[0]?.id as string) ?? null;

      if (botId) {
        // 2. Bot channel
        await client.query(
          `
          INSERT INTO bot_channels (id, bot_id, channel_type, account_id, status, channel_config, connection_mode, created_at, updated_at)
          VALUES ($1, $2, 'feishu', $3, 'connected', $4, 'webhook', $5, $5)
          ON CONFLICT (bot_id, channel_type, account_id) DO UPDATE
            SET status = 'connected', connection_mode = 'webhook', channel_config = $4, updated_at = $5
          `,
          [
            botChannelId,
            botId,
            accountId,
            JSON.stringify({ appId: feishuAppId }),
            now,
          ],
        );

        // 3. Credentials (appId, appSecret, verificationToken)
        const creds: Array<[string, string, string]> = [
          ["cred_feishu_appid", "appId", feishuAppId],
          ["cred_feishu_secret", "appSecret", feishuAppSecret],
          ["cred_feishu_vtoken", "verificationToken", feishuVerificationToken],
        ];

        for (const [credId, credType, plaintext] of creds) {
          await client.query(
            `
            INSERT INTO channel_credentials (id, bot_channel_id, credential_type, encrypted_value, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (bot_channel_id, credential_type) DO UPDATE
              SET encrypted_value = $4
            `,
            [credId, botChannelId, credType, encryptValue(plaintext), now],
          );
        }

        // 4. Webhook route
        await client.query(
          `
          INSERT INTO webhook_routes (id, channel_type, external_id, pool_id, bot_channel_id, bot_id, account_id, created_at, updated_at)
          VALUES ('wr_feishu_official', 'feishu', $1, 'pool_local_01', $2, $3, $4, $5, $5)
          ON CONFLICT (channel_type, external_id) DO UPDATE
            SET bot_channel_id = $2, bot_id = $3, account_id = $4, updated_at = $5
          `,
          [feishuAppId, botChannelId, botId, accountId, now],
        );

        console.log(
          `Feishu official bot seeded (appId=${feishuAppId}, accountId=${accountId}, botId=${botId})`,
        );
      } else {
        console.log(
          "Feishu seed skipped: no active bot found in pool_local_01. Create a bot first via the dashboard, then re-run seed.",
        );
      }
    } else {
      console.log(
        "Feishu seed skipped: set FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_VERIFICATION_TOKEN in .env to enable.",
      );
    }

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
