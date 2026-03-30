import type { ControllerEnv } from "../app/env.js";
import { proxyFetch } from "../lib/proxy-fetch.js";

export class RuntimeHealth {
  constructor(private readonly env: ControllerEnv) {}

  async probe(): Promise<{ ok: boolean; status: number | null }> {
    if (!this.env.gatewayProbeEnabled) {
      return { ok: true, status: null };
    }

    try {
      const response = await proxyFetch(
        `http://127.0.0.1:${this.env.openclawGatewayPort}/health`,
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
