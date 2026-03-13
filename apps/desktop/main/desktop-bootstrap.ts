import { session } from "electron";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { parseSetCookieHeader } from "./cookies";

type PgPoolConstructor = typeof import("pg").Pool;
const runtimeConfig = getDesktopRuntimeConfig(process.env);
export const desktopApiUrl = runtimeConfig.apiBaseUrl;
export const desktopWebUrl = runtimeConfig.webUrl;

const desktopAuthBootstrap = {
  name: "NexU Desktop",
  email: "desktop@nexu.local",
  password: "desktop-local-password",
  appUserId: "desktop-local-user",
  onboardingRole: "Founder / Manager",
};

export async function bootstrapDesktopAuthSession(): Promise<void> {
  const { Pool } = (await import("pg")) as { Pool: PgPoolConstructor };

  const authHeaders = {
    "Content-Type": "application/json",
    Origin: desktopWebUrl,
    Referer: `${desktopWebUrl}/`,
  };

  await fetch(`${desktopApiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: desktopAuthBootstrap.name,
      email: desktopAuthBootstrap.email,
      password: desktopAuthBootstrap.password,
    }),
  }).catch(() => null);

  const pool = new Pool({
    connectionString:
      process.env.NEXU_DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:50832/postgres?sslmode=disable",
  });

  try {
    await pool.query(
      'update "user" set "emailVerified" = true where email = $1',
      [desktopAuthBootstrap.email],
    );
  } finally {
    await pool.end();
  }

  const signInResponse = await fetch(
    `${desktopApiUrl}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        email: desktopAuthBootstrap.email,
        password: desktopAuthBootstrap.password,
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

  const cookies = parseSetCookieHeader(setCookieHeader);

  const pool2 = new Pool({
    connectionString:
      process.env.NEXU_DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:50832/postgres?sslmode=disable",
  });

  try {
    const now = new Date().toISOString();
    await pool2.query(
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
        desktopAuthBootstrap.appUserId,
        authUserId,
        now,
        desktopAuthBootstrap.onboardingRole,
        now,
        now,
        now,
      ],
    );
  } finally {
    await pool2.end();
  }

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
}
