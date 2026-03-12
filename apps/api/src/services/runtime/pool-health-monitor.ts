import { and, gte, lt, ne } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { gatewayPools } from "../../db/schema/index.js";
import { logger } from "../../lib/logger.js";

/** How often to scan for stale heartbeats (ms). */
const SCAN_INTERVAL_MS = 30_000;

/** Mark a pool unhealthy if its last heartbeat is older than this (ms). */
const STALE_HEARTBEAT_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function scanPools(db: Database): Promise<void> {
  const staleThreshold = new Date(
    Date.now() - STALE_HEARTBEAT_MS,
  ).toISOString();

  // Mark pools with stale heartbeats as unhealthy
  const stalePools = await db
    .select({
      id: gatewayPools.id,
      lastHeartbeat: gatewayPools.lastHeartbeat,
      status: gatewayPools.status,
    })
    .from(gatewayPools)
    .where(
      and(
        lt(gatewayPools.lastHeartbeat, staleThreshold),
        ne(gatewayPools.status, "unhealthy"),
      ),
    );

  for (const pool of stalePools) {
    await db
      .update(gatewayPools)
      .set({ status: "unhealthy" })
      .where(eq(gatewayPools.id, pool.id));

    logger.warn({
      message: "pool_marked_unhealthy",
      poolId: pool.id,
      lastHeartbeat: pool.lastHeartbeat,
      previousStatus: pool.status,
    });
  }

  // Recover pools whose heartbeats are fresh but still marked unhealthy
  const recoveredPools = await db
    .select({
      id: gatewayPools.id,
      lastHeartbeat: gatewayPools.lastHeartbeat,
    })
    .from(gatewayPools)
    .where(
      and(
        gte(gatewayPools.lastHeartbeat, staleThreshold),
        eq(gatewayPools.status, "unhealthy"),
      ),
    );

  for (const pool of recoveredPools) {
    await db
      .update(gatewayPools)
      .set({ status: "active" })
      .where(eq(gatewayPools.id, pool.id));

    logger.info({
      message: "pool_recovered_active",
      poolId: pool.id,
      lastHeartbeat: pool.lastHeartbeat,
    });
  }
}

export function startPoolHealthMonitor(db: Database): void {
  if (timer !== null) {
    return;
  }

  timer = setInterval(() => {
    scanPools(db).catch((err) => {
      logger.error({
        message: "pool_health_scan_failed",
        error: String(err),
      });
    });
  }, SCAN_INTERVAL_MS);

  logger.info({
    message: "pool_health_monitor_started",
    scanIntervalMs: SCAN_INTERVAL_MS,
    staleThresholdMs: STALE_HEARTBEAT_MS,
  });
}

export function stopPoolHealthMonitor(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
