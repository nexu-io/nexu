import crypto from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  generateClaimKeyResponseSchema,
  generateClaimKeySchema,
  resolveClaimKeyQuerySchema,
  resolveClaimKeyResponseSchema,
  sharedSlackClaimResponseSchema,
  sharedSlackClaimSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/index.js";
import {
  claimTokens,
  users,
  workspaceMemberships,
} from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

const CLAIM_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Internal: generate claim token (called by gateway) ──

const generateClaimKeyRoute = createRoute({
  method: "post",
  path: "/api/internal/shared-slack/claim-key",
  tags: ["Shared Slack App"],
  request: {
    body: {
      content: { "application/json": { schema: generateClaimKeySchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: generateClaimKeyResponseSchema },
      },
      description: "Claim token generated",
    },
  },
});

// ── Public: resolve claim token (no auth) ──

const resolveClaimKeyRoute = createRoute({
  method: "get",
  path: "/api/shared-slack/resolve-claim-key",
  tags: ["Shared Slack App"],
  request: {
    query: resolveClaimKeyQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: resolveClaimKeyResponseSchema },
      },
      description: "Claim token resolved",
    },
  },
});

// ── Authenticated: submit claim ──

const sharedSlackClaimRoute = createRoute({
  method: "post",
  path: "/api/v1/shared-slack/claim",
  tags: ["Shared Slack App"],
  request: {
    body: {
      content: { "application/json": { schema: sharedSlackClaimSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: sharedSlackClaimResponseSchema },
      },
      description: "Shared Slack user identity claimed",
    },
  },
});

// ── Register public routes (before auth middleware) ──

export function registerSharedSlackClaimPublicRoutes(
  app: OpenAPIHono<AppBindings>,
) {
  // Generate claim token
  app.openapi(generateClaimKeyRoute, async (c) => {
    const input = c.req.valid("json");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CLAIM_KEY_TTL_MS).toISOString();
    const token = crypto.randomBytes(32).toString("base64url");

    await db.insert(claimTokens).values({
      id: createId(),
      token,
      workspaceKey: input.teamId,
      imUserId: input.imUserId,
      botId: input.botId ?? "",
      expiresAt,
      createdAt: now.toISOString(),
    });

    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
    const claimUrl = `${webUrl}/claim?token=${encodeURIComponent(token)}`;

    return c.json({ claimUrl, token, expiresAt }, 200);
  });

  // Resolve claim token
  app.openapi(resolveClaimKeyRoute, async (c) => {
    const { token } = c.req.valid("query");

    const [row] = await db
      .select()
      .from(claimTokens)
      .where(eq(claimTokens.token, token));

    if (!row) {
      return c.json({ valid: false, expired: false, used: false }, 200);
    }

    const expired = new Date(row.expiresAt) < new Date();
    const used = row.usedAt !== null;

    if (expired || used) {
      return c.json({ valid: false, expired, used }, 200);
    }

    // Check existing workspace members
    const [memberStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceKey, row.workspaceKey));

    const memberCount = memberStats?.count ?? 0;

    return c.json(
      {
        valid: true,
        expired: false,
        used: false,
        teamId: row.workspaceKey,
        teamName: null,
        imUserId: row.imUserId,
        isExistingWorkspace: memberCount > 0,
        memberCount,
      },
      200,
    );
  });
}

// ── Register authenticated routes (after auth middleware) ──

export function registerSharedSlackClaimRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(sharedSlackClaimRoute, async (c) => {
    const authUserId = c.get("userId");
    const input = c.req.valid("json");
    const now = new Date().toISOString();

    // Validate claim token
    const [tokenRow] = await db
      .select()
      .from(claimTokens)
      .where(eq(claimTokens.token, input.token));

    if (!tokenRow) {
      throw new HTTPException(400, { message: "Invalid claim token" });
    }
    if (new Date(tokenRow.expiresAt) < new Date()) {
      throw new HTTPException(400, { message: "Claim token has expired" });
    }
    if (tokenRow.usedAt !== null) {
      throw new HTTPException(400, { message: "Claim token already used" });
    }

    // Mark token as used
    await db
      .update(claimTokens)
      .set({ usedAt: now, usedByUserId: authUserId })
      .where(eq(claimTokens.token, input.token));

    // Ensure app user exists
    let [appUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authUserId, authUserId));

    if (!appUser) {
      await db.insert(users).values({
        id: createId(),
        authUserId,
        inviteAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      [appUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.authUserId, authUserId));
    }

    // Check if IM identity already claimed by another user
    const [existingClaim] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, tokenRow.workspaceKey),
          eq(workspaceMemberships.imUserId, tokenRow.imUserId),
        ),
      );
    if (existingClaim && existingClaim.userId !== authUserId) {
      throw new HTTPException(409, {
        message: "IM identity already claimed by another user",
      });
    }

    // Insert workspace membership (onConflictDoNothing for idempotency of same user)
    await db
      .insert(workspaceMemberships)
      .values({
        id: createId(),
        workspaceKey: tokenRow.workspaceKey,
        imUserId: tokenRow.imUserId,
        userId: authUserId,
        botId: tokenRow.botId,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [
          workspaceMemberships.workspaceKey,
          workspaceMemberships.imUserId,
        ],
      });

    // Update user auth source
    const detail = JSON.stringify({
      workspaceKey: tokenRow.workspaceKey,
      imUserId: tokenRow.imUserId,
    });
    await db
      .update(users)
      .set({
        authSource: "slack_shared_claim",
        authSourceDetail: detail,
        updatedAt: now,
      })
      .where(eq(users.authUserId, authUserId));

    // Check if org already authorized (other users in same workspace)
    const [memberStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, tokenRow.workspaceKey),
          sql`${workspaceMemberships.userId} != ${authUserId}`,
        ),
      );

    const orgAuthorized = (memberStats?.count ?? 0) > 0;

    return c.json({ ok: true, orgAuthorized }, 200);
  });
}
