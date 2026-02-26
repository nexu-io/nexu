import crypto from "node:crypto";
import type { OpenClawConfig } from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { gatewayPools, poolConfigSnapshots } from "../../db/schema/index.js";
import { generatePoolConfig } from "../../lib/config-generator.js";

interface SnapshotRecord {
  id: string;
  poolId: string;
  version: number;
  configHash: string;
  config: OpenClawConfig;
  createdAt: string;
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
): Promise<SnapshotRecord> {
  const config = await generatePoolConfig(db, poolId);
  const configHash = toHash(config);

  const [existingByHash] = await db
    .select()
    .from(poolConfigSnapshots)
    .where(
      and(
        eq(poolConfigSnapshots.poolId, poolId),
        eq(poolConfigSnapshots.configHash, configHash),
      ),
    )
    .orderBy(desc(poolConfigSnapshots.version))
    .limit(1);

  if (existingByHash) {
    return parseSnapshot(existingByHash);
  }

  const [latest] = await db
    .select({ version: poolConfigSnapshots.version })
    .from(poolConfigSnapshots)
    .where(eq(poolConfigSnapshots.poolId, poolId))
    .orderBy(desc(poolConfigSnapshots.version))
    .limit(1);

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

  return {
    id: snapshotId,
    poolId,
    version: nextVersion,
    configHash,
    config,
    createdAt: now,
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
