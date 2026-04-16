import type { OpenClawConfig } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";

function makeConfig(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    gateway: { port: 18789, mode: "local", bind: "127.0.0.1" },
    agents: { list: [], defaults: {} },
    channels: {},
    bindings: [],
    plugins: { load: { paths: [] }, entries: {} },
    skills: { load: { watch: true } },
    commands: { native: "auto" },
    ...overrides,
  } as OpenClawConfig;
}

describe("OpenClawGatewayService", () => {
  it("treats semantically identical configs as unchanged despite key reorder", async () => {
    const service = new OpenClawGatewayService({
      isConnected: () => true,
    } as never);

    const configA = makeConfig({
      plugins: {
        entries: {
          zed: { enabled: true },
          alpha: { enabled: true },
        },
        load: { paths: [] },
      },
    });
    const configB = makeConfig({
      plugins: {
        load: { paths: [] },
        entries: {
          alpha: { enabled: true },
          zed: { enabled: true },
        },
      },
    });

    service.noteConfigWritten(configA);

    await expect(service.shouldPushConfig(configB)).resolves.toBe(false);
  });

  describe("getAllChannelsLiveStatus gateway-offline reporting", () => {
    const channels = [
      { id: "ch1", channelType: "feishu", accountId: "feishu-acct" },
      { id: "ch2", channelType: "slack", accountId: "T0001" },
    ];

    it("reports connecting + configured when WS is not connected", async () => {
      const service = new OpenClawGatewayService({
        isConnected: () => false,
        request: vi.fn(),
      } as never);

      const result = await service.getAllChannelsLiveStatus(channels);

      expect(result.gatewayConnected).toBe(false);
      for (const entry of result.channels) {
        expect(entry.status).toBe("connecting");
        expect(entry.configured).toBe(true);
        expect(entry.connected).toBe(false);
        expect(entry.running).toBe(false);
        expect(entry.lastError).toBeNull();
      }
    });

    it("reports connecting + configured when the channels.status RPC throws", async () => {
      const service = new OpenClawGatewayService({
        isConnected: () => true,
        request: vi.fn(async () => {
          throw new Error("openclaw gateway not connected");
        }),
      } as never);

      const result = await service.getAllChannelsLiveStatus(channels);

      expect(result.gatewayConnected).toBe(false);
      for (const entry of result.channels) {
        expect(entry.status).toBe("connecting");
        expect(entry.configured).toBe(true);
        expect(entry.connected).toBe(false);
        expect(entry.running).toBe(false);
        expect(entry.lastError).toBeNull();
      }
    });
  });
});
