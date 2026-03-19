import { app, session } from "electron";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { parseSetCookieHeader } from "./cookies";

type PgPoolConstructor = typeof import("pg").Pool;

const runtimeConfig = getDesktopRuntimeConfig(process.env, {
  resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
});

export const desktopApiUrl = runtimeConfig.urls.apiBase;
export const desktopWebUrl = runtimeConfig.urls.web;

let ensureSessionPromise: Promise<void> | null = null;

function getDatabaseUrl(): string {
  return runtimeConfig.database.pgliteUrl;
}

function getAuthHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: desktopWebUrl,
    Referer: `${desktopWebUrl}/`,
  };
}

async function getDesktopSessionCookieHeader(): Promise<string | null> {
  const cookies = await session.defaultSession.cookies.get({
    url: desktopWebUrl,
  });

  if (cookies.length === 0) {
    return null;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function hasValidDesktopAuthSession(): Promise<boolean> {
  const cookieHeader = await getDesktopSessionCookieHeader();

  if (!cookieHeader) {
    return false;
  }

  try {
    const response = await fetch(`${desktopApiUrl}/api/auth/get-session`, {
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader,
        Origin: desktopWebUrl,
        Referer: `${desktopWebUrl}/`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as {
      user?: {
        id?: string;
      } | null;
    } | null;

    return Boolean(payload?.user?.id);
  } catch {
    return false;
  }
}

async function ensureDesktopBootstrapUser(): Promise<void> {
  await fetch(`${desktopApiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name: runtimeConfig.desktopAuth.name,
      email: runtimeConfig.desktopAuth.email,
      password: runtimeConfig.desktopAuth.password,
    }),
  }).catch(() => null);

  const { Pool } = (await import("pg")) as { Pool: PgPoolConstructor };
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
  });

  try {
    await pool.query(
      'update "user" set "emailVerified" = true where email = $1',
      [runtimeConfig.desktopAuth.email],
    );
  } finally {
    await pool.end();
  }
}

async function signInDesktopBootstrapUser(): Promise<{
  authUserId: string;
  setCookieHeader: string;
}> {
  const signInResponse = await fetch(
    `${desktopApiUrl}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        email: runtimeConfig.desktopAuth.email,
        password: runtimeConfig.desktopAuth.password,
        rememberMe: true,
      }),
    },
  );

  if (!signInResponse.ok) {
    throw new Error(
      `Desktop auth bootstrap failed with status ${signInResponse.status}.`,
    );
  }

  const signInPayload = (await signInResponse.json()) as {
    user?: {
      id: string;
    };
  };

  const authUserId = signInPayload.user?.id;

  if (!authUserId) {
    throw new Error("Desktop auth bootstrap did not return a user id.");
  }

  const setCookieHeader = signInResponse.headers.get("set-cookie");

  if (!setCookieHeader) {
    throw new Error(
      "Desktop auth bootstrap did not receive Set-Cookie header.",
    );
  }

  return {
    authUserId,
    setCookieHeader,
  };
}

async function ensureDesktopAppUser(authUserId: string): Promise<void> {
  const { Pool } = (await import("pg")) as { Pool: PgPoolConstructor };
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
  });

  try {
    const now = new Date().toISOString();
    await pool.query(
      `insert into users (
        id,
        auth_user_id,
        plan,
        invite_accepted_at,
        onboarding_role,
        onboarding_company,
        onboarding_use_cases,
        onboarding_referral_source,
        onboarding_referral_detail,
        onboarding_channel_votes,
        onboarding_avatar,
        onboarding_avatar_votes,
        onboarding_completed_at,
        created_at,
        updated_at
      ) values (
        $1, $2, 'free', $3, $4, '', '[]', 'desktop-bootstrap', '', '[]', 'builder', '[]', $5, $6, $7
      )
      on conflict (auth_user_id) do update set
        invite_accepted_at = excluded.invite_accepted_at,
        onboarding_role = excluded.onboarding_role,
        onboarding_company = excluded.onboarding_company,
        onboarding_use_cases = excluded.onboarding_use_cases,
        onboarding_referral_source = excluded.onboarding_referral_source,
        onboarding_referral_detail = excluded.onboarding_referral_detail,
        onboarding_channel_votes = excluded.onboarding_channel_votes,
        onboarding_avatar = excluded.onboarding_avatar,
        onboarding_avatar_votes = excluded.onboarding_avatar_votes,
        onboarding_completed_at = excluded.onboarding_completed_at,
        updated_at = excluded.updated_at`,
      [
        runtimeConfig.desktopAuth.appUserId,
        authUserId,
        now,
        runtimeConfig.desktopAuth.onboardingRole,
        now,
        now,
        now,
      ],
    );

    // Ensure a gateway pool exists for local desktop runtime.
    // The pool ID must match the gateway's RUNTIME_POOL_ID (defaults to "desktop-local-pool"
    // in manifests.ts) so that generatePoolConfig() can find bots assigned to this pool.
    const gatewayPoolId =
      process.env.NEXU_GATEWAY_POOL_ID ?? "desktop-local-pool";
    await pool.query(
      `INSERT INTO gateway_pools (id, pool_name, pool_type, max_bots, status, pod_ip, created_at)
       VALUES ($2, 'desktop-local', 'shared', 50, 'active', '127.0.0.1', $1)
       ON CONFLICT (id) DO UPDATE SET pod_ip = '127.0.0.1', status = 'active'`,
      [now, gatewayPoolId],
    );

    // Migrate bots & assignments from the legacy pool ID ("pool_local_01") to the
    // current gateway pool ID so that generatePoolConfig() picks them up.
    const legacyPoolId = "pool_local_01";
    if (gatewayPoolId !== legacyPoolId) {
      await pool.query(
        "UPDATE bots SET pool_id = $1, updated_at = $2 WHERE pool_id = $3",
        [gatewayPoolId, now, legacyPoolId],
      );
      await pool.query(
        "UPDATE gateway_assignments SET pool_id = $1 WHERE pool_id = $2",
        [gatewayPoolId, legacyPoolId],
      );
      // Clean up the legacy pool row
      await pool.query("DELETE FROM gateway_pools WHERE id = $1", [
        legacyPoolId,
      ]);
    }

    // Ensure at least one bot exists so the /api/internal/desktop/ready
    // endpoint returns 200 and the webview can mount.
    const botResult = (await pool.query(
      "SELECT id FROM bots WHERE user_id = $1 LIMIT 1",
      [runtimeConfig.desktopAuth.appUserId],
    )) as { rows: Array<{ id: string }> };
    if (botResult.rows.length === 0) {
      const botId = `bot_desktop_${Date.now()}`;
      await pool.query(
        `INSERT INTO bots (id, user_id, name, slug, model_id, pool_id, created_at, updated_at)
         VALUES ($1, $2, 'My Bot', 'my-bot', $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          botId,
          runtimeConfig.desktopAuth.appUserId,
          process.env.DEFAULT_MODEL_ID ?? "link/claude-sonnet-4-5",
          gatewayPoolId,
          now,
          now,
        ],
      );
      await pool.query(
        `INSERT INTO gateway_assignments (id, bot_id, pool_id, assigned_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [`ga_desktop_${Date.now()}`, botId, gatewayPoolId, now],
      );
    }
  } finally {
    await pool.end();
  }
}

async function persistDesktopSessionCookies(
  setCookieHeader: string,
): Promise<void> {
  const cookies = parseSetCookieHeader(setCookieHeader);

  for (const [name, cookie] of cookies.entries()) {
    await session.defaultSession.cookies.set({
      url: desktopWebUrl,
      name,
      value: cookie.value,
      path: typeof cookie.path === "string" ? cookie.path : "/",
      secure: cookie.secure === true,
      httpOnly: cookie.httponly === true,
      sameSite:
        cookie.samesite === "strict"
          ? "strict"
          : cookie.samesite === "none"
            ? "no_restriction"
            : "lax",
    });
  }

  const persistedCookies = await session.defaultSession.cookies.get({
    url: desktopWebUrl,
  });

  console.log(
    `[desktop:auth-bootstrap] setCookies=${Array.from(cookies.keys()).join(",")} persistedCookies=${persistedCookies.map((cookie) => cookie.name).join(",")}`,
  );
}

async function runEnsureDesktopAuthSession(force: boolean): Promise<void> {
  if (!force && (await hasValidDesktopAuthSession())) {
    console.log("[desktop:auth-bootstrap] reused existing session");
    return;
  }

  await ensureDesktopBootstrapUser();
  const { authUserId, setCookieHeader } = await signInDesktopBootstrapUser();
  await ensureDesktopAppUser(authUserId);
  await persistDesktopSessionCookies(setCookieHeader);

  if (!(await hasValidDesktopAuthSession())) {
    throw new Error("Desktop auth bootstrap did not produce a valid session.");
  }

  console.log(
    `[desktop:auth-bootstrap] ensured session for user=${authUserId}`,
  );
}

export async function ensureDesktopAuthSession(options?: {
  force?: boolean;
}): Promise<void> {
  const force = options?.force === true;

  if (!ensureSessionPromise) {
    ensureSessionPromise = runEnsureDesktopAuthSession(force).finally(() => {
      ensureSessionPromise = null;
    });
  }

  return ensureSessionPromise;
}

export async function bootstrapDesktopAuthSession(): Promise<void> {
  return ensureDesktopAuthSession();
}
