import type { ControllerEnv } from "../app/env.js";
import { proxyFetch } from "../lib/proxy-fetch.js";

export type HealthProbeResult = {
  ok: boolean;
  status: number | null;
  errorCode: string | null;
};

const CONNECTION_ERROR_PATTERN =
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|EPIPE)\b/;

function extractErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return error.name;
  }

  const match = error.message.match(CONNECTION_ERROR_PATTERN);
  if (match?.[1]) {
    return match[1];
  }

  return error.name || "unknown";
}

export class RuntimeHealth {
  constructor(private readonly env: ControllerEnv) {}

  async probe(): Promise<HealthProbeResult> {
    if (!this.env.gatewayProbeEnabled) {
      return { ok: true, status: null, errorCode: null };
    }

    try {
      const response = await proxyFetch(
        `http://127.0.0.1:${this.env.openclawGatewayPort}/health`,
        { timeoutMs: 4000 },
      );
      return {
        ok: response.ok,
        status: response.status,
        errorCode: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        errorCode: extractErrorCode(error),
      };
    }
  }
}
