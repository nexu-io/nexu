import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { userStatsResponseSchema } from "@nexu/shared";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { botChannels, users } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

const getUserStatsRoute = createRoute({
  method: "get",
  path: "/api/stats/users",
  tags: ["Stats"],
  responses: {
    200: {
      content: {
        "application/json": { schema: userStatsResponseSchema },
      },
      description: "User statistics",
    },
  },
});

export function registerStatsRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getUserStatsRoute, async (c) => {
    const now = new Date();
    const startOfTodayUtc = new Date(now);
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);

    const sevenDaysAgoUtc = new Date(now);
    sevenDaysAgoUtc.setUTCDate(sevenDaysAgoUtc.getUTCDate() - 7);

    const thirtyDaysAgoUtc = new Date(now);
    thirtyDaysAgoUtc.setUTCDate(thirtyDaysAgoUtc.getUTCDate() - 30);

    const [stats] = await db
      .select({
        totalUsers: sql<number>`count(*)::int`,
        todayNewUsers: sql<number>`count(*) filter (where ${users.createdAt} >= ${startOfTodayUtc.toISOString()})::int`,
        last7DaysNewUsers: sql<number>`count(*) filter (where ${users.createdAt} >= ${sevenDaysAgoUtc.toISOString()})::int`,
        last30DaysNewUsers: sql<number>`count(*) filter (where ${users.createdAt} >= ${thirtyDaysAgoUtc.toISOString()})::int`,
      })
      .from(users);

    const [channelStats] = await db
      .select({
        totalChannels: sql<number>`count(*)::int`,
      })
      .from(botChannels);

    return c.json(
      {
        totalUsers: stats?.totalUsers ?? 0,
        todayNewUsers: stats?.todayNewUsers ?? 0,
        last7DaysNewUsers: stats?.last7DaysNewUsers ?? 0,
        last30DaysNewUsers: stats?.last30DaysNewUsers ?? 0,
        totalChannels: channelStats?.totalChannels ?? 0,
      },
      200,
    );
  });
}
