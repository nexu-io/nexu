import crypto from "node:crypto";
import type { OpenClawConfig } from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { gatewayPools, poolConfigSnapshots } from "../../db/schema/index.js";
import { generatePoolConfig } from "../../lib/config-generator.js";
import { logger } from "../../lib/logger.js";
import { pushConfig } from "../openclaw-service.js";

interface SnapshotRecord {
  id: string;
  poolId: string;
  version: number;
  configHash: string;
  config: OpenClawConfig;
  createdAt: string;
  /** Whether the config was successfully pushed to OpenClaw via WS. */
  configPushed?: boolean;
}

function toHash(config: OpenClawConfig): string {
  const json = JSON.stringify(config);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function parseSnapshot(
  row: typeof poolConfigSnapshots.$inferSelect,
): SnapshotRecord {
  return {
    id: row.id,
    poolId: row.poolId,
    version: row.version,
    configHash: row.configHash,
    config: JSON.parse(row.configJson) as OpenClawConfig,
    createdAt: row.createdAt,
  };
}

export async function publishPoolConfigSnapshot(
  db: Database,
  poolId: string,
  options?: { force?: boolean },
): Promise<SnapshotRecord> {
  const config = await generatePoolConfig(db, poolId);
  const configHash = toHash(config);

  const [latest] = await db
    .select({ version: poolConfigSnapshots.version })
    .from(poolConfigSnapshots)
    .where(eq(poolConfigSnapshots.poolId, poolId))
    .orderBy(desc(poolConfigSnapshots.version))
    .limit(1);

  // Skip if the latest snapshot already has the same hash (true no-op)
  // When force is true, always publish a new snapshot regardless of hash
  if (latest && !options?.force) {
    const [latestFull] = await db
      .select()
      .from(poolConfigSnapshots)
      .where(
        and(
          eq(poolConfigSnapshots.poolId, poolId),
          eq(poolConfigSnapshots.version, latest.version),
        ),
      )
      .limit(1);

    if (latestFull && latestFull.configHash === configHash) {
      return parseSnapshot(latestFull);
    }
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const snapshotId = createId();
  const snapshotJson = JSON.stringify(config);

  await db.insert(poolConfigSnapshots).values({
    id: snapshotId,
    poolId,
    version: nextVersion,
    configHash,
    configJson: snapshotJson,
    createdAt: now,
  });

  await db
    .update(gatewayPools)
    .set({ configVersion: sql`${gatewayPools.configVersion} + 1` })
    .where(eq(gatewayPools.id, poolId));

  // Push config to OpenClaw via WS (best-effort, failure doesn't affect DB)
  let configPushed = false;
  try {
    await pushConfig(config);
    configPushed = true;
  } catch (err) {
    logger.warn({
      message: "openclaw_push_config_failed",
      poolId,
      version: nextVersion,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    id: snapshotId,
    poolId,
    version: nextVersion,
    configHash,
    config,
    createdAt: now,
    configPushed,
  };
}

export async function getLatestPoolConfigSnapshot(
  db: Database,
  poolId: string,
): Promise<SnapshotRecord> {
  const [latest] = await db
    .select()
    .from(poolConfigSnapshots)
    .where(eq(poolConfigSnapshots.poolId, poolId))
    .orderBy(desc(poolConfigSnapshots.version))
    .limit(1);

  if (latest) {
    return parseSnapshot(latest);
  }

  return publishPoolConfigSnapshot(db, poolId);
}

export async function getPoolConfigSnapshotByVersion(
  db: Database,
  poolId: string,
  version: number,
): Promise<SnapshotRecord | null> {
  const [snapshot] = await db
    .select()
    .from(poolConfigSnapshots)
    .where(
      and(
        eq(poolConfigSnapshots.poolId, poolId),
        eq(poolConfigSnapshots.version, version),
      ),
    )
    .limit(1);

  if (!snapshot) {
    return null;
  }

  return parseSnapshot(snapshot);
}
