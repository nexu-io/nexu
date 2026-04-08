import type { ControllerEnv } from "../app/env.js";

export function resolveOpenclawGatewayBaseUrl(env: ControllerEnv): URL {
  return new URL(env.openclawBaseUrl);
}

export function resolveOpenclawGatewayWsUrl(env: ControllerEnv): string {
  const url = resolveOpenclawGatewayBaseUrl(env);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}
