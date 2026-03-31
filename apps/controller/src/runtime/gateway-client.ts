import type { ControllerEnv } from "../app/env.js";
import { proxyFetch } from "../lib/proxy-fetch.js";

export class GatewayClient {
  constructor(private readonly env: ControllerEnv) {}

  async fetchJson<T>(pathname: string): Promise<T> {
    const url = new URL(
      pathname,
      `http://127.0.0.1:${this.env.openclawGatewayPort}`,
    );
    const response = await proxyFetch(url, {
      headers: this.env.openclawGatewayToken
        ? { Authorization: `Bearer ${this.env.openclawGatewayToken}` }
        : undefined,
    });

    if (!response.ok) {
      throw new Error(`Gateway request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
