import type { ControllerEnv } from "../app/env.js";

export class GatewayClient {
  constructor(private readonly env: ControllerEnv) {}

  async fetchJson<T>(pathname: string): Promise<T> {
    const url = new URL(pathname, this.env.openclawBaseUrl);
    const response = await fetch(url, {
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
