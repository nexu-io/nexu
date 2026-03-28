import type { ControllerEnv } from "../app/env.js";

export class RuntimeHealth {
  constructor(private readonly env: ControllerEnv) {}

  async probe(): Promise<{ ok: boolean; status: number | null }> {
    if (!this.env.gatewayProbeEnabled) {
      return { ok: true, status: null };
    }

    try {
      const response = await fetch(
        new URL("/health", this.env.openclawBaseUrl),
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
