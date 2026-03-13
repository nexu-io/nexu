export const DEFAULT_API_PORT = 50_800;
export const DEFAULT_SESSION_CHAT_PORT = 50_820;
export const DEFAULT_SESSION_CHAT_DB_PORT = 50_822;
export const DEFAULT_WEB_PORT = 50_810;
export const DEFAULT_PGLITE_PORT = 50_832;

export type DesktopRuntimeConfig = {
  apiPort: number;
  apiBaseUrl: string;
  webPort: number;
  webUrl: string;
  sessionChatPort: number;
  sessionChatUrl: string;
  sessionChatDbPort: number;
  pglitePort: number;
};

export function getDesktopRuntimeConfig(
  env: Record<string, string | undefined>,
): DesktopRuntimeConfig {
  const apiPort = Number.parseInt(
    env.NEXU_API_PORT ?? String(DEFAULT_API_PORT),
    10,
  );
  const webPort = Number.parseInt(
    env.NEXU_WEB_PORT ?? String(DEFAULT_WEB_PORT),
    10,
  );
  const sessionChatPort = Number.parseInt(
    env.NEXU_SESSION_CHAT_PORT ?? String(DEFAULT_SESSION_CHAT_PORT),
    10,
  );
  const sessionChatDbPort = Number.parseInt(
    env.NEXU_SESSION_CHAT_DB_PORT ?? String(DEFAULT_SESSION_CHAT_DB_PORT),
    10,
  );
  const pglitePort = Number.parseInt(
    env.NEXU_PGLITE_PORT ?? String(DEFAULT_PGLITE_PORT),
    10,
  );

  return {
    apiPort,
    apiBaseUrl:
      env.NEXU_API_URL ??
      env.NEXU_API_BASE_URL ??
      `http://127.0.0.1:${apiPort}`,
    webPort,
    webUrl: env.NEXU_WEB_URL ?? `http://127.0.0.1:${webPort}`,
    sessionChatPort,
    sessionChatUrl:
      env.NEXU_SESSION_CHAT_URL ?? `http://127.0.0.1:${sessionChatPort}`,
    sessionChatDbPort,
    pglitePort,
  };
}
