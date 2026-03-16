import type { OpenAPIHono } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { claimTokens, workspaceMemberships } from "../db/schema/index.js";
import { logger } from "../lib/logger.js";
import type { AppBindings } from "../types.js";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
const CLAIM_TTL_DAYS = 7;

/**
 * Generate a claim token (called directly from slack-events.ts, not via HTTP).
 * Idempotent: returns existing unexpired/unused token if one exists.
 */
export async function generateClaimToken(params: {
  workspaceKey: string;
  imUserId: string;
  botId: string;
}): Promise<{ token: string; claimUrl: string; expiresAt: string }> {
  const now = new Date();
  const nowIso = now.toISOString();

  const [existing] = await db
    .select()
    .from(claimTokens)
    .where(
      and(
        eq(claimTokens.workspaceKey, params.workspaceKey),
        eq(claimTokens.imUserId, params.imUserId),
        gt(claimTokens.expiresAt, nowIso),
        isNull(claimTokens.usedAt),
      ),
    );

  if (existing) {
    return {
      token: existing.token,
      claimUrl: `${WEB_URL}/claim?token=${existing.token}`,
      expiresAt: existing.expiresAt,
    };
  }

  const token = createId();
  const expiresAt = new Date(
    now.getTime() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db.insert(claimTokens).values({
    id: createId(),
    token,
    workspaceKey: params.workspaceKey,
    imUserId: params.imUserId,
    botId: params.botId,
    expiresAt,
    createdAt: nowIso,
  });

  return { token, claimUrl: `${WEB_URL}/claim?token=${token}`, expiresAt };
}

/**
 * Public routes (no auth required): workspace-status query.
 */
export function registerClaimPublicRoutes(app: OpenAPIHono<AppBindings>) {
  // GET /api/v1/claim/workspace-status?token=xxx
  app.get("/api/v1/claim/workspace-status", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.json({ valid: false, error: "missing_token" });
    }

    const [claimRow] = await db
      .select()
      .from(claimTokens)
      .where(eq(claimTokens.token, token));

    if (!claimRow) {
      return c.json({ valid: false, error: "not_found" });
    }
    if (claimRow.usedAt) {
      return c.json({ valid: false, error: "already_used" });
    }
    if (new Date(claimRow.expiresAt) < new Date()) {
      return c.json({ valid: false, error: "expired" });
    }

    const members = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceKey, claimRow.workspaceKey));

    const memberCount = members.length;
    const isNewWorkspace = memberCount === 0;

    return c.json({
      valid: true,
      workspaceKey: claimRow.workspaceKey,
      isNewWorkspace,
      memberCount,
    });
  });
}

/**
 * Authenticated routes: claim verify + associate.
 */
export function registerClaimRoutes(app: OpenAPIHono<AppBindings>) {
  // POST /api/v1/claim/verify
  app.post("/api/v1/claim/verify", async (c) => {
    const userId = c.get("userId") as string;
    if (!userId) {
      return c.json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await c.req.json();
    const { token } = body as { token: string };

    if (!token) {
      return c.json({ ok: false, error: "missing_token" }, 400);
    }

    const [claimRow] = await db
      .select()
      .from(claimTokens)
      .where(eq(claimTokens.token, token));

    if (!claimRow) {
      return c.json({ ok: false, error: "not_found" });
    }
    if (claimRow.usedAt) {
      return c.json({ ok: false, error: "already_used" });
    }
    if (new Date(claimRow.expiresAt) < new Date()) {
      return c.json({ ok: false, error: "expired" });
    }

    const now = new Date().toISOString();

    // Check if this Nexu account is already linked to a different Slack account in this workspace
    const [existingByUser] = await db
      .select({ imUserId: workspaceMemberships.imUserId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, claimRow.workspaceKey),
          eq(workspaceMemberships.userId, userId),
        ),
      );

    if (existingByUser && existingByUser.imUserId !== claimRow.imUserId) {
      return c.json({
        ok: false,
        error: "account_already_linked",
        message:
          "This Nexu account is already linked to a different Slack account in this workspace.",
      });
    }

    // Check if this Slack account is already claimed by a different Nexu account
    const [existingByIm] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, claimRow.workspaceKey),
          eq(workspaceMemberships.imUserId, claimRow.imUserId),
        ),
      );

    if (existingByIm && existingByIm.userId !== userId) {
      return c.json({
        ok: false,
        error: "slack_account_already_claimed",
        message:
          "This Slack account is already linked to a different Nexu account.",
      });
    }

    await db
      .insert(workspaceMemberships)
      .values({
        id: createId(),
        workspaceKey: claimRow.workspaceKey,
        userId,
        botId: claimRow.botId,
        imUserId: claimRow.imUserId,
        role: "member",
        createdAt: now,
      })
      .onConflictDoNothing();

    await db
      .update(claimTokens)
      .set({ usedAt: now, usedByUserId: userId })
      .where(eq(claimTokens.id, claimRow.id));

    const members = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceKey, claimRow.workspaceKey));

    logger.info({
      message: "claim_verify_success",
      user_id: userId,
      workspace_key: claimRow.workspaceKey,
      member_count: members.length,
    });

    return c.json({
      ok: true,
      workspaceKey: claimRow.workspaceKey,
      isNewWorkspace: members.length <= 1,
      memberCount: members.length,
    });
  });
}
