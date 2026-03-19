import { createId } from "@paralleldrive/cuid2";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bots, gatewayAssignments, gatewayPools } from "../db/schema/index.js";
import { DAILY_BOT_LIMIT, todayMidnightCST } from "./bot-quota.js";
import { ServiceError } from "./error.js";

export async function findDefaultPool(): Promise<string> {
  // Find a usable pool — prefer active, fall back to degraded
  const rows = await db
    .select()
    .from(gatewayPools)
    .where(inArray(gatewayPools.status, ["active", "degraded"]));

  // Prefer active pool with a registered gateway
  const activeWithGateway = rows.find((r) => r.status === "active" && r.podIp);
  if (activeWithGateway) return activeWithGateway.id;

  // Any active pool
  const active = rows.find((r) => r.status === "active");
  if (active) return active.id;

  // Fall back to degraded pool (still functional, just partial health check failures)
  const degradedWithGateway = rows.find(
    (r) => r.status === "degraded" && r.podIp,
  );
  if (degradedWithGateway) return degradedWithGateway.id;

  const degraded = rows.find((r) => r.status === "degraded");
  if (degraded) return degraded.id;

  throw ServiceError.from("bot-helpers", { code: "default_pool_not_found" });
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

  // Enforce daily bot creation limit
  if (DAILY_BOT_LIMIT > 0) {
    const midnight = todayMidnightCST();
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bots)
      .where(gte(bots.createdAt, midnight));
    const todayCount = rows[0]?.count ?? 0;

    if (todayCount >= DAILY_BOT_LIMIT) {
      throw ServiceError.from("bot-helpers", {
        code: "daily_bot_limit_exceeded",
        message:
          "We're experiencing high demand right now. Please try again later.",
      });
    }
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
    modelId: process.env.DEFAULT_MODEL_ID ?? "link/claude-sonnet-4-5",
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
    throw ServiceError.from("bot-helpers", {
      code: "default_bot_create_failed",
      bot_id: botId,
      user_id: userId,
    });
  }

  return bot;
}
