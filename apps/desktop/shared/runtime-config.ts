export const DEFAULT_API_PORT = 50_800;
export const DEFAULT_WEB_PORT = 50_810;
export const DEFAULT_PGLITE_PORT = 50_832;

export type DesktopRuntimeConfig = {
  apiPort: number;
  apiBaseUrl: string;
  webPort: number;
  webUrl: string;
  openclawBaseUrl: string;
  openclawGatewayToken: string;
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
    openclawBaseUrl:
      env.NEXU_OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789",
    openclawGatewayToken:
      env.NEXU_OPENCLAW_GATEWAY_TOKEN ??
      env.NEXU_INTERNAL_API_TOKEN ??
      "gw-secret-token",
    pglitePort,
  };
}
