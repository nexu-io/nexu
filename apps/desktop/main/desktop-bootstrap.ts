import { app, session } from "electron";
import { getDesktopRuntimeConfig } from "../shared/runtime-config";
import { parseSetCookieHeader } from "./cookies";

const runtimeConfig = getDesktopRuntimeConfig(process.env, {
  resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
});

export const desktopControllerUrl = runtimeConfig.urls.controllerBase;
export const desktopWebUrl = runtimeConfig.urls.web;

let ensureSessionPromise: Promise<void> | null = null;

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
    const response = await fetch(
      `${desktopControllerUrl}/api/auth/get-session`,
      {
        headers: {
          Accept: "application/json",
          Cookie: cookieHeader,
          Origin: desktopWebUrl,
          Referer: `${desktopWebUrl}/`,
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

async function ensureDesktopBootstrapUser(): Promise<void> {
  await fetch(`${desktopControllerUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name: runtimeConfig.desktopAuth.name,
      email: runtimeConfig.desktopAuth.email,
      password: runtimeConfig.desktopAuth.password,
    }),
  }).catch(() => null);
}

async function signInDesktopBootstrapUser(): Promise<{
  authUserId: string;
  setCookieHeader: string;
}> {
  const signInResponse = await fetch(
    `${desktopControllerUrl}/api/auth/sign-in/email`,
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
