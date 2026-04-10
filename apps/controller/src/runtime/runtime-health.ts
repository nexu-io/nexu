import type { ControllerEnv } from "../app/env.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
import { resolveOpenclawGatewayBaseUrl } from "./openclaw-gateway-url.js";

export class RuntimeHealth {
  constructor(private readonly env: ControllerEnv) {}

  async probe(options?: {
    timeoutMs?: number;
  }): Promise<{ ok: boolean; status: number | null }> {
    if (!this.env.gatewayProbeEnabled) {
      return { ok: true, status: null };
    }

    try {
      const response = await proxyFetch(
        new URL("/health", resolveOpenclawGatewayBaseUrl(this.env)),
        options?.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined,
      );
      return {
        ok: response.ok,
        status: response.status,
      };
    } catch {
      return {
        ok: false,
        status: null,
      };
    }
  }
}
