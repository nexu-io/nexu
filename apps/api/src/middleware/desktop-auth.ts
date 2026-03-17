import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/index.js";
import { authUsers, users } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

let resolvedUser: { id: string; name: string; email: string } | null = null;

/**
 * Resolves the desktop user for cookie-less auth fallback.
 * Priority: desktop@nexu.local (bootstrap user) → first existing user → create fallback.
 */
async function resolveDesktopUser(): Promise<{
  id: string;
  name: string;
  email: string;
}> {
  if (resolvedUser) return resolvedUser;

  // 1. Prefer the desktop bootstrap user (matches desktop-bootstrap.ts)
  const [bootstrapUser] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.email, "desktop@nexu.local"))
    .limit(1);

  const existing =
    bootstrapUser ?? (await db.select().from(authUsers).limit(1))[0];

  if (existing) {
    // Ensure app-level user row exists
    const [appUser] = await db
      .select()
      .from(users)
      .where(eq(users.authUserId, existing.id));
    if (!appUser) {
      const now = new Date().toISOString();
      await db.insert(users).values({
        id: createId(),
        authUserId: existing.id,
        inviteAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    resolvedUser = {
      id: existing.id,
      name: existing.name,
      email: existing.email,
    };
    return resolvedUser;
  }

  // 2. No users at all — create a fallback desktop user
  const fallbackId = "desktop-local-user";
  const fallbackEmail = "desktop@localhost";
  await db.insert(authUsers).values({
    id: fallbackId,
    name: "Desktop User",
    email: fallbackEmail,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const now = new Date().toISOString();
  await db.insert(users).values({
    id: createId(),
    authUserId: fallbackId,
    inviteAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  resolvedUser = {
    id: fallbackId,
    name: "Desktop User",
    email: fallbackEmail,
  };
  return resolvedUser;
}

/**
 * Desktop-mode middleware: sets userId on every /api/v1/* request
 * so routes that expect an authenticated user work without browser login.
 */
export const desktopAuthMiddleware = createMiddleware<AppBindings>(
  async (c, next) => {
    const user = await resolveDesktopUser();
    c.set("userId", user.id);
    // Provide a minimal session so routes that read session.user.* don't crash.
    c.set("session", {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      session: {
        id: "desktop-session",
        userId: user.id,
        token: "",
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: "127.0.0.1",
        userAgent: "NexuDesktop",
      },
    } as AppBindings["Variables"]["session"]);
    await next();
  },
);
