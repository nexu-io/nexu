import { and, lt, ne } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/index.js";
import { gatewayPools } from "../../db/schema/index.js";
import { logger } from "../../lib/logger.js";

/** How often to scan for stale heartbeats (ms). */
const SCAN_INTERVAL_MS = 30_000;

/** Mark a pool unhealthy if its last heartbeat is older than this (ms). */
const STALE_HEARTBEAT_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function scanStalePools(db: Database): Promise<void> {
  const staleThreshold = new Date(
    Date.now() - STALE_HEARTBEAT_MS,
  ).toISOString();

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
}

export function startPoolHealthMonitor(db: Database): void {
  if (timer !== null) {
    return;
  }

  timer = setInterval(() => {
    scanStalePools(db).catch((err) => {
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
