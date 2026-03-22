import { session } from "electron";
import type { DesktopRuntimeConfig } from "../shared/runtime-config";
import { parseSetCookieHeader } from "./cookies";

let ensureSessionPromise: Promise<void> | null = null;

function getAuthHeaders(
  runtimeConfig: DesktopRuntimeConfig,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: runtimeConfig.urls.web,
    Referer: `${runtimeConfig.urls.web}/`,
  };
}

async function getDesktopSessionCookieHeader(
  runtimeConfig: DesktopRuntimeConfig,
): Promise<string | null> {
  const cookies = await session.defaultSession.cookies.get({
    url: runtimeConfig.urls.web,
  });

  if (cookies.length === 0) {
    return null;
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function hasValidDesktopAuthSession(
  runtimeConfig: DesktopRuntimeConfig,
): Promise<boolean> {
  const cookieHeader = await getDesktopSessionCookieHeader(runtimeConfig);

  if (!cookieHeader) {
    return false;
  }

  try {
    const response = await fetch(
      `${runtimeConfig.urls.controllerBase}/api/auth/get-session`,
      {
        headers: {
          Accept: "application/json",
          Cookie: cookieHeader,
          Origin: runtimeConfig.urls.web,
          Referer: `${runtimeConfig.urls.web}/`,
        },
      },
    );

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

async function ensureDesktopBootstrapUser(
  runtimeConfig: DesktopRuntimeConfig,
): Promise<void> {
  await fetch(`${runtimeConfig.urls.controllerBase}/api/auth/sign-up/email`, {
    method: "POST",
    headers: getAuthHeaders(runtimeConfig),
    body: JSON.stringify({
      name: runtimeConfig.desktopAuth.name,
      email: runtimeConfig.desktopAuth.email,
      password: runtimeConfig.desktopAuth.password,
    }),
  }).catch(() => null);
}

async function signInDesktopBootstrapUser(
  runtimeConfig: DesktopRuntimeConfig,
): Promise<{
  authUserId: string;
  setCookieHeader: string;
}> {
  const signInResponse = await fetch(
    `${runtimeConfig.urls.controllerBase}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: getAuthHeaders(runtimeConfig),
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

async function persistDesktopSessionCookies(
  runtimeConfig: DesktopRuntimeConfig,
  setCookieHeader: string,
): Promise<void> {
  const cookies = parseSetCookieHeader(setCookieHeader);

  for (const [name, cookie] of cookies.entries()) {
    await session.defaultSession.cookies.set({
      url: runtimeConfig.urls.web,
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
    url: runtimeConfig.urls.web,
  });

  console.log(
    `[desktop:auth-bootstrap] setCookies=${Array.from(cookies.keys()).join(",")} persistedCookies=${persistedCookies.map((cookie) => cookie.name).join(",")}`,
  );
}

async function runEnsureDesktopAuthSession(
  runtimeConfig: DesktopRuntimeConfig,
  force: boolean,
): Promise<void> {
  if (!force && (await hasValidDesktopAuthSession(runtimeConfig))) {
    console.log("[desktop:auth-bootstrap] reused existing session");
    return;
  }

  await ensureDesktopBootstrapUser(runtimeConfig);
  const { authUserId, setCookieHeader } =
    await signInDesktopBootstrapUser(runtimeConfig);
  await persistDesktopSessionCookies(runtimeConfig, setCookieHeader);

  if (!(await hasValidDesktopAuthSession(runtimeConfig))) {
    throw new Error("Desktop auth bootstrap did not produce a valid session.");
  }

  console.log(
    `[desktop:auth-bootstrap] ensured session for user=${authUserId}`,
  );
}

export async function ensureDesktopAuthSession(options: {
  runtimeConfig: DesktopRuntimeConfig;
  force?: boolean;
}): Promise<void> {
  const force = options.force === true;

  if (!ensureSessionPromise) {
    ensureSessionPromise = runEnsureDesktopAuthSession(
      options.runtimeConfig,
      force,
    ).finally(() => {
      ensureSessionPromise = null;
    });
  }

  return ensureSessionPromise;
}

export async function bootstrapDesktopAuthSession(
  runtimeConfig: DesktopRuntimeConfig,
): Promise<void> {
  return ensureDesktopAuthSession({ runtimeConfig });
}
