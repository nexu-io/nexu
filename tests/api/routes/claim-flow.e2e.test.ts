/**
 * End-to-end integration tests for the Shared Slack App claim flow.
 *
 * Tests the full lifecycle:
 *   1. generateClaimToken (idempotent token creation)
 *   2. GET /api/v1/claim/workspace-status (public token validation)
 *   3. POST /api/v1/claim/verify (authenticated claim + membership creation)
 *   4. Session upsert with nexuUserId + per-peer DM isolation
 *   5. shared-slack-claim-routes (其远's 3 APIs)
 *
 * Uses a real PostgreSQL database (nexu_test) — same pattern as config-generator.test.ts.
 */

// Set DATABASE_URL to test DB BEFORE any module imports
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

import { OpenAPIHono } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool as appPool, db } from "#api/db/index.js";
import * as schema from "#api/db/schema/index.js";
import { buildSlackSessionKey } from "#api/routes/slack-events.js";

async function createTables(client: typeof appPool) {
  await client.query(`
    DROP TABLE IF EXISTS claim_tokens CASCADE;
    DROP TABLE IF EXISTS workspace_memberships CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
    DROP TABLE IF EXISTS users CASCADE;

    CREATE TABLE claim_tokens (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      workspace_key TEXT NOT NULL,
      im_user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by_user_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE workspace_memberships (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      workspace_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      im_user_id TEXT,
      role TEXT DEFAULT 'member',
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX wm_workspace_user_idx ON workspace_memberships(workspace_key, user_id);
    CREATE UNIQUE INDEX wm_workspace_im_user_idx ON workspace_memberships(workspace_key, im_user_id);
    CREATE INDEX wm_user_idx ON workspace_memberships(user_id);

    CREATE TABLE sessions (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL,
      session_key TEXT NOT NULL UNIQUE,
      nexu_user_id TEXT,
      channel_type TEXT,
      channel_id TEXT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      message_count INTEGER DEFAULT 0,
      last_message_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX sessions_bot_id_idx ON sessions(bot_id);
    CREATE INDEX sessions_nexu_user_id_idx ON sessions(nexu_user_id);

    CREATE TABLE users (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      auth_user_id TEXT NOT NULL UNIQUE,
      auth_source TEXT,
      auth_source_detail TEXT,
      plan TEXT DEFAULT 'free',
      invite_accepted_at TEXT,
      onboarding_role TEXT,
      onboarding_company TEXT,
      onboarding_use_cases TEXT,
      onboarding_referral_source TEXT,
      onboarding_referral_detail TEXT,
      onboarding_channel_votes TEXT,
      onboarding_avatar TEXT,
      onboarding_avatar_votes TEXT,
      onboarding_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function truncateAll() {
  await appPool.query(
    "TRUNCATE claim_tokens, workspace_memberships, sessions, users CASCADE",
  );
}

// ---------------------------------------------------------------------------
// 1. generateClaimToken — direct function tests
// ---------------------------------------------------------------------------

describe("Claim Flow E2E", () => {
  beforeAll(async () => {
    await createTables(appPool);
  });

  afterAll(async () => {
    await appPool.end();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ── generateClaimToken ──────────────────────────────────────────────

  describe("generateClaimToken", () => {
    // Import dynamically so DATABASE_URL is set first
    let generateClaimToken: typeof import(
      "../claim-routes.js",
    ).generateClaimToken;

    beforeAll(async () => {
      const mod = await import("../claim-routes.js");
      generateClaimToken = mod.generateClaimToken;
    });

    it("creates a new claim token with valid claimUrl and expiresAt", async () => {
      const result = await generateClaimToken({
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
      });

      expect(result.token).toBeTruthy();
      expect(result.claimUrl).toContain(`/claim?token=${result.token}`);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

      // Verify DB row
      const [row] = await db
        .select()
        .from(schema.claimTokens)
        .where(eq(schema.claimTokens.token, result.token));

      expect(row).toBeDefined();
      expect(row?.workspaceKey).toBe("slack:T_ACME");
      expect(row?.imUserId).toBe("U_ALICE");
      expect(row?.botId).toBe("bot-1");
      expect(row?.usedAt).toBeNull();
    });

    it("is idempotent — returns the same token for same params", async () => {
      const params = {
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
      };

      const first = await generateClaimToken(params);
      const second = await generateClaimToken(params);

      expect(second.token).toBe(first.token);
      expect(second.claimUrl).toBe(first.claimUrl);

      // Only one row in DB
      const rows = await db
        .select()
        .from(schema.claimTokens)
        .where(eq(schema.claimTokens.workspaceKey, "slack:T_ACME"));
      expect(rows).toHaveLength(1);
    });

    it("creates different tokens for different imUserIds", async () => {
      const tokenA = await generateClaimToken({
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
      });
      const tokenB = await generateClaimToken({
        workspaceKey: "slack:T_ACME",
        imUserId: "U_BOB",
        botId: "bot-1",
      });

      expect(tokenA.token).not.toBe(tokenB.token);
    });
  });

  // ── Workspace Status API (public) ───────────────────────────────────

  describe("GET /api/v1/claim/workspace-status", () => {
    let app: Hono;

    beforeAll(async () => {
      const { registerClaimPublicRoutes } = await import("../claim-routes.js");
      app = new Hono();
      registerClaimPublicRoutes(app as any);
    });

    it("returns valid=true for a fresh token", async () => {
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        createdAt: now.toISOString(),
      });

      const res = await app.request(
        `/api/v1/claim/workspace-status?token=${token}`,
      );
      const body = await res.json();

      expect(body.valid).toBe(true);
      expect(body.isNewWorkspace).toBe(true);
      expect(body.memberCount).toBe(0);
    });

    it("returns not_found for missing token", async () => {
      const res = await app.request(
        "/api/v1/claim/workspace-status?token=nonexistent",
      );
      const body = await res.json();

      expect(body.valid).toBe(false);
      expect(body.error).toBe("not_found");
    });

    it("returns already_used for consumed token", async () => {
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        usedAt: now.toISOString(),
        usedByUserId: "user-1",
        createdAt: now.toISOString(),
      });

      const res = await app.request(
        `/api/v1/claim/workspace-status?token=${token}`,
      );
      const body = await res.json();

      expect(body.valid).toBe(false);
      expect(body.error).toBe("already_used");
    });

    it("returns expired for expired token", async () => {
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() - 86400000).toISOString(), // expired yesterday
        createdAt: now.toISOString(),
      });

      const res = await app.request(
        `/api/v1/claim/workspace-status?token=${token}`,
      );
      const body = await res.json();

      expect(body.valid).toBe(false);
      expect(body.error).toBe("expired");
    });

    it("returns isNewWorkspace=false when members exist", async () => {
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_BOB",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        createdAt: now.toISOString(),
      });

      // Add an existing member
      await db.insert(schema.workspaceMemberships).values({
        id: createId(),
        workspaceKey: "slack:T_ACME",
        userId: "user-existing",
        botId: "bot-1",
        imUserId: "U_ALICE",
        createdAt: now.toISOString(),
      });

      const res = await app.request(
        `/api/v1/claim/workspace-status?token=${token}`,
      );
      const body = await res.json();

      expect(body.valid).toBe(true);
      expect(body.isNewWorkspace).toBe(false);
      expect(body.memberCount).toBe(1);
    });
  });

  // ── Claim Verify API (authenticated) ────────────────────────────────

  describe("POST /api/v1/claim/verify", () => {
    let app: Hono;

    beforeAll(async () => {
      const { registerClaimRoutes } = await import("../claim-routes.js");
      app = new Hono();
      // Mock auth: inject userId into context
      app.use("/api/v1/*", async (c, next) => {
        c.set("userId", "test-user-001");
        await next();
      });
      registerClaimRoutes(app as any);
    });

    it("claims successfully and creates workspace membership", async () => {
      const now = new Date();
      const token = createId();
      const claimId = createId();
      await db.insert(schema.claimTokens).values({
        id: claimId,
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        createdAt: now.toISOString(),
      });

      const res = await app.request("/api/v1/claim/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();

      expect(body.ok).toBe(true);
      expect(body.workspaceKey).toBe("slack:T_ACME");
      expect(body.memberCount).toBe(1);

      // Verify membership created
      const [membership] = await db
        .select()
        .from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.userId, "test-user-001"));

      expect(membership).toBeDefined();
      expect(membership?.workspaceKey).toBe("slack:T_ACME");
      expect(membership?.imUserId).toBe("U_ALICE");

      // Verify token marked as used
      const [usedToken] = await db
        .select()
        .from(schema.claimTokens)
        .where(eq(schema.claimTokens.id, claimId));

      expect(usedToken?.usedAt).toBeTruthy();
      expect(usedToken?.usedByUserId).toBe("test-user-001");
    });

    it("rejects expired token", async () => {
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() - 86400000).toISOString(),
        createdAt: now.toISOString(),
      });

      const res = await app.request("/api/v1/claim/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();

      expect(body.ok).toBe(false);
      expect(body.error).toBe("expired");
    });

    it("rejects already-used token", async () => {
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_ACME",
        imUserId: "U_ALICE",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        usedAt: now.toISOString(),
        usedByUserId: "other-user",
        createdAt: now.toISOString(),
      });

      const res = await app.request("/api/v1/claim/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();

      expect(body.ok).toBe(false);
      expect(body.error).toBe("already_used");
    });
  });

  // ── Session upsert with nexuUserId + per-peer isolation ─────────────

  describe("Session upsert with nexuUserId", () => {
    it("creates session with nexuUserId when membership exists", async () => {
      const now = new Date().toISOString();

      // Create membership first
      await db.insert(schema.workspaceMemberships).values({
        id: createId(),
        workspaceKey: "slack:T_ACME",
        userId: "nexu-user-alice",
        botId: "bot-1",
        imUserId: "U_ALICE",
        createdAt: now,
      });

      // Simulate session upsert (same logic as slack-events.ts)
      const sessionKey = buildSlackSessionKey({
        botId: "bot-1",
        channelId: "D_ALICE_DM",
        isIm: true,
        slackUserId: "U_ALICE",
      });

      // Resolve nexuUserId
      const [membership] = await db
        .select({ userId: schema.workspaceMemberships.userId })
        .from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.workspaceKey, "slack:T_ACME"));

      const nexuUserId = membership?.userId ?? null;

      await db.insert(schema.sessions).values({
        id: createId(),
        botId: "bot-1",
        sessionKey,
        nexuUserId,
        channelType: "slack",
        channelId: "D_ALICE_DM",
        title: "#alice-dm",
        status: "active",
        messageCount: 1,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Verify
      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.sessionKey, sessionKey));

      expect(session).toBeDefined();
      expect(session?.nexuUserId).toBe("nexu-user-alice");
      expect(session?.sessionKey).toBe("agent:bot-1:direct:u_alice");
    });

    it("per-peer isolation: different Slack users get different sessions", async () => {
      const now = new Date().toISOString();

      const keyAlice = buildSlackSessionKey({
        botId: "bot-1",
        channelId: "D_ALICE",
        isIm: true,
        slackUserId: "U_ALICE",
      });
      const keyBob = buildSlackSessionKey({
        botId: "bot-1",
        channelId: "D_BOB",
        isIm: true,
        slackUserId: "U_BOB",
      });

      expect(keyAlice).not.toBe(keyBob);
      expect(keyAlice).toBe("agent:bot-1:direct:u_alice");
      expect(keyBob).toBe("agent:bot-1:direct:u_bob");

      // Insert both sessions
      for (const [key, userId] of [
        [keyAlice, "nexu-alice"],
        [keyBob, "nexu-bob"],
      ] as const) {
        await db.insert(schema.sessions).values({
          id: createId(),
          botId: "bot-1",
          sessionKey: key,
          nexuUserId: userId,
          channelType: "slack",
          channelId: key,
          title: `DM ${userId}`,
          status: "active",
          messageCount: 1,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      const allSessions = await db.select().from(schema.sessions);
      expect(allSessions).toHaveLength(2);

      const alice = allSessions.find((s) => s.nexuUserId === "nexu-alice");
      const bob = allSessions.find((s) => s.nexuUserId === "nexu-bob");
      expect(alice?.sessionKey).not.toBe(bob?.sessionKey);
    });

    it("session upsert increments messageCount on conflict", async () => {
      const now = new Date().toISOString();
      const sessionKey = "agent:bot-1:direct:u_alice";

      // First insert
      await db.insert(schema.sessions).values({
        id: createId(),
        botId: "bot-1",
        sessionKey,
        channelType: "slack",
        channelId: "D_ALICE",
        title: "#alice",
        status: "active",
        messageCount: 1,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Upsert (same as slack-events.ts onConflictDoUpdate)
      const laterNow = new Date().toISOString();
      await db
        .insert(schema.sessions)
        .values({
          id: createId(),
          botId: "bot-1",
          sessionKey,
          channelType: "slack",
          channelId: "D_ALICE",
          title: "#alice",
          status: "active",
          messageCount: 1,
          lastMessageAt: laterNow,
          createdAt: laterNow,
          updatedAt: laterNow,
        })
        .onConflictDoUpdate({
          target: schema.sessions.sessionKey,
          set: {
            messageCount: sql`${schema.sessions.messageCount} + 1`,
            lastMessageAt: laterNow,
            updatedAt: laterNow,
          },
        });

      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.sessionKey, sessionKey));

      expect(session?.messageCount).toBe(2);
    });
  });

  // ── shared-slack-claim-routes (其远's APIs) ─────────────────────────

  describe("shared-slack-claim-routes", () => {
    let app: OpenAPIHono;

    beforeAll(async () => {
      const {
        registerSharedSlackClaimPublicRoutes,
        registerSharedSlackClaimRoutes,
      } = await import("../shared-slack-claim-routes.js");

      app = new OpenAPIHono();
      // Register public routes
      registerSharedSlackClaimPublicRoutes(app as any);
      // Mock auth + register protected routes
      app.use("/api/v1/*", async (c, next) => {
        c.set("userId", "auth-user-001");
        await next();
      });
      registerSharedSlackClaimRoutes(app as any);
    });

    it("POST /api/internal/shared-slack/claim-key generates a token", async () => {
      const res = await app.request("/api/internal/shared-slack/claim-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: "T_ACME",
          imUserId: "U_ALICE",
          botId: "bot-1",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.token).toBeTruthy();
      expect(body.claimUrl).toContain("/claim?token=");
      expect(body.expiresAt).toBeTruthy();

      // Verify in DB
      const [row] = await db
        .select()
        .from(schema.claimTokens)
        .where(eq(schema.claimTokens.token, body.token));
      expect(row).toBeDefined();
      expect(row?.workspaceKey).toBe("T_ACME");
    });

    it("GET /api/shared-slack/resolve-claim-key resolves valid token", async () => {
      // Insert a token
      const now = new Date();
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_RESOLVE",
        imUserId: "U_BOB",
        botId: "bot-1",
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        createdAt: now.toISOString(),
      });

      const res = await app.request(
        `/api/shared-slack/resolve-claim-key?token=${token}`,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.valid).toBe(true);
      expect(body.teamId).toBe("slack:T_RESOLVE");
      expect(body.imUserId).toBe("U_BOB");
    });

    it("GET /api/shared-slack/resolve-claim-key returns invalid for bad token", async () => {
      const res = await app.request(
        "/api/shared-slack/resolve-claim-key?token=bad-token",
      );
      const body = await res.json();

      expect(body.valid).toBe(false);
    });

    it("POST /api/v1/shared-slack/claim creates membership", async () => {
      // Need a user in DB for shared-slack-claim
      const now = new Date().toISOString();
      await db.insert(schema.users).values({
        id: createId(),
        authUserId: "auth-user-001",
        inviteAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Insert claim token
      const token = createId();
      await db.insert(schema.claimTokens).values({
        id: createId(),
        token,
        workspaceKey: "slack:T_CLAIM",
        imUserId: "U_CLAIMER",
        botId: "bot-1",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: now,
      });

      const res = await app.request("/api/v1/shared-slack/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify membership created
      const [membership] = await db
        .select()
        .from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.workspaceKey, "slack:T_CLAIM"));
      expect(membership).toBeDefined();
      expect(membership?.userId).toBe("auth-user-001");
      expect(membership?.imUserId).toBe("U_CLAIMER");

      // Verify token marked used
      const [usedToken] = await db
        .select()
        .from(schema.claimTokens)
        .where(eq(schema.claimTokens.token, token));
      expect(usedToken?.usedAt).toBeTruthy();
      expect(usedToken?.usedByUserId).toBe("auth-user-001");
    });
  });

  // ── Full lifecycle: unclaimed → claim → session with nexuUserId ─────

  describe("Full claim lifecycle", () => {
    let generateClaimToken: typeof import(
      "../claim-routes.js",
    ).generateClaimToken;
    let claimApp: Hono;

    beforeAll(async () => {
      const claimMod = await import("../claim-routes.js");
      generateClaimToken = claimMod.generateClaimToken;

      claimApp = new Hono();
      claimApp.use("/api/v1/*", async (c, next) => {
        c.set("userId", "nexu-user-lifecycle");
        await next();
      });
      claimMod.registerClaimPublicRoutes(claimApp as any);
      claimMod.registerClaimRoutes(claimApp as any);
    });

    it("end-to-end: generate token → check status → verify claim → session with nexuUserId", async () => {
      // Step 1: unclaimed user triggers token generation
      const claimResult = await generateClaimToken({
        workspaceKey: "slack:T_E2E",
        imUserId: "U_E2E_USER",
        botId: "bot-e2e",
      });
      expect(claimResult.token).toBeTruthy();

      // Step 2: frontend resolves token status
      const statusRes = await claimApp.request(
        `/api/v1/claim/workspace-status?token=${claimResult.token}`,
      );
      const statusBody = await statusRes.json();
      expect(statusBody.valid).toBe(true);
      expect(statusBody.isNewWorkspace).toBe(true);

      // Step 3: user claims (authenticated)
      const verifyRes = await claimApp.request("/api/v1/claim/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: claimResult.token }),
      });
      const verifyBody = await verifyRes.json();
      expect(verifyBody.ok).toBe(true);
      expect(verifyBody.memberCount).toBe(1);

      // Step 4: now the user sends a message → session should include nexuUserId
      const sessionKey = buildSlackSessionKey({
        botId: "bot-e2e",
        channelId: "D_E2E_DM",
        isIm: true,
        slackUserId: "U_E2E_USER",
      });

      // Resolve nexuUserId (same logic as slack-events.ts)
      const [membership] = await db
        .select({ userId: schema.workspaceMemberships.userId })
        .from(schema.workspaceMemberships)
        .where(eq(schema.workspaceMemberships.workspaceKey, "slack:T_E2E"));

      const nexuUserId = membership?.userId ?? null;
      expect(nexuUserId).toBe("nexu-user-lifecycle");

      const now = new Date().toISOString();
      await db.insert(schema.sessions).values({
        id: createId(),
        botId: "bot-e2e",
        sessionKey,
        nexuUserId,
        channelType: "slack",
        channelId: "D_E2E_DM",
        title: "DM e2e user",
        status: "active",
        messageCount: 1,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Verify session has correct nexuUserId
      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.sessionKey, sessionKey));

      expect(session?.nexuUserId).toBe("nexu-user-lifecycle");
      expect(session?.sessionKey).toBe("agent:bot-e2e:direct:u_e2e_user");

      // Step 5: token should now be used, status should reflect
      const statusRes2 = await claimApp.request(
        `/api/v1/claim/workspace-status?token=${claimResult.token}`,
      );
      const statusBody2 = await statusRes2.json();
      expect(statusBody2.valid).toBe(false);
      expect(statusBody2.error).toBe("already_used");
    });
  });
});
