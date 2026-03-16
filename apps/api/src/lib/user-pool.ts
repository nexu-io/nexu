import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { bots, gatewayPools } from "../db/schema/index.js";

export async function getOrCreateDefaultPoolId(db: Database): Promise<string> {
  const [existing] = await db
    .select({ id: gatewayPools.id })
    .from(gatewayPools)
    .where(eq(gatewayPools.poolName, "default"))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const poolId = createId();
  await db.insert(gatewayPools).values({
    id: poolId,
    poolName: "default",
    poolType: "shared",
    status: "active",
  });

  return poolId;
}

export async function resolvePrimaryUserPoolId(
  db: Database,
  userId: string,
): Promise<string> {
  const [botWithPool] = await db
    .select({ poolId: bots.poolId })
    .from(bots)
    .where(and(eq(bots.userId, userId), ne(bots.status, "deleted")))
    .orderBy(asc(bots.createdAt))
    .limit(1);

  if (botWithPool?.poolId) {
    return botWithPool.poolId;
  }

  return getOrCreateDefaultPoolId(db);
}
