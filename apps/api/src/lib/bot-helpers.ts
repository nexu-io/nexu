import { createId } from "@paralleldrive/cuid2";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { bots, gatewayAssignments, gatewayPools } from "../db/schema/index.js";

export async function findDefaultPool(): Promise<string> {
  // Find an active pool — prefer one with a registered gateway (pod_ip set)
  const rows = await db
    .select()
    .from(gatewayPools)
    .where(eq(gatewayPools.status, "active"));

  const withGateway = rows.find((r) => r.podIp);
  if (withGateway) {
    return withGateway.id;
  }
  const firstPool = rows[0];
  if (firstPool) {
    return firstPool.id;
  }

  throw new Error(
    "No gateway pool available. Ensure a gateway is deployed and registered.",
  );
}

export async function findOrCreateDefaultBot(
  userId: string,
): Promise<typeof bots.$inferSelect> {
  // Look for an existing active or paused bot
  const [existing] = await db
    .select()
    .from(bots)
    .where(
      and(
        eq(bots.userId, userId),
        or(eq(bots.status, "active"), eq(bots.status, "paused")),
      ),
    );

  if (existing) {
    return existing;
  }

  // Create a default bot
  const poolId = await findDefaultPool();
  const botId = createId();
  const now = new Date().toISOString();

  await db.insert(bots).values({
    id: botId,
    userId,
    name: "My Bot",
    slug: "my-bot",
    modelId: process.env.DEFAULT_MODEL_ID ?? "anthropic/claude-sonnet-4",
    poolId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(gatewayAssignments).values({
    id: createId(),
    botId,
    poolId,
    assignedAt: now,
  });

  const [bot] = await db.select().from(bots).where(eq(bots.id, botId));
  if (!bot) {
    throw new Error("Failed to create default bot");
  }

  return bot;
}
