import type { OpenClawConfig } from "@nexu/shared";
import { describe, expect, it } from "vitest";
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
    const service = new OpenClawGatewayService(
      {
        isConnected: () => true,
      } as never,
      {} as never,
    );

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
});
