import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { proxyFetch } from "../src/lib/proxy-fetch.js";
import { AnalyticsService } from "../src/services/analytics-service.js";

vi.mock("../src/lib/proxy-fetch.js", () => ({
  proxyFetch: vi.fn(),
}));

type AnalyticsServiceInternals = {
  sendAnalyticsEvent: (
    distinctId: string,
    eventType: string,
    eventProperties: Record<string, unknown>,
    timestampMs: number,
  ) => Promise<void>;
};

function createEnv(overrides: Partial<ControllerEnv> = {}): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: "/tmp/.nexu",
    nexuConfigPath: "/tmp/.nexu/config.json",
    artifactsIndexPath: "/tmp/.nexu/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/.nexu/compiled-openclaw.json",
    openclawStateDir: "/tmp/.openclaw",
    openclawConfigPath: "/tmp/.openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/.openclaw/skills",
    userSkillsDir: "/tmp/.agents/skills",
    openclawBuiltinExtensionsDir: null,
    openclawExtensionsDir: "/tmp/.openclaw/extensions",
    runtimePluginTemplatesDir: "/tmp/runtime-plugins",
    openclawRuntimeModelStatePath: "/tmp/.openclaw/nexu-runtime-model.json",
    skillhubCacheDir: "/tmp/.nexu/skillhub-cache",
    skillDbPath: "/tmp/.nexu/skill-ledger.json",
    analyticsStatePath: "/tmp/.nexu/analytics-state.json",
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: "/tmp/.openclaw/workspace-templates",
    openclawBin: "openclaw",
    openclawLaunchdLabel: null,
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
    posthogApiKey: "phc_test_key",
    posthogHost: "https://app.posthog.test",
    ...overrides,
  };
}

describe("AnalyticsService transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends PostHog capture payload with distinct_id and timestamp", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const service = new AnalyticsService(
      createEnv(),
      {
        getLocalProfile: async () => ({ id: "local-user" }),
      } as never,
      {
        listSessions: async () => [],
      } as never,
    );

    const internals = service as unknown as AnalyticsServiceInternals;
    await internals.sendAnalyticsEvent(
      "local-user",
      "user_message_sent",
      { channel: "slack", model_provider: "openai" },
      1_712_000_000_000,
    );

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(proxyFetch).mock.calls[0] ?? [];
    expect(url).toBe("https://app.posthog.test/i/v0/e/");
    const requestBody = JSON.parse(String(options?.body)) as {
      api_key: string;
      distinct_id: string;
      event: string;
      properties: Record<string, unknown>;
      timestamp: string;
    };
    expect(requestBody).toEqual({
      api_key: "phc_test_key",
      distinct_id: "local-user",
      event: "user_message_sent",
      properties: {
        channel: "slack",
        model_provider: "openai",
      },
      timestamp: "2024-04-01T19:33:20.000Z",
    });
  });

  it("does not send when host is not configured", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const service = new AnalyticsService(
      createEnv({ posthogHost: undefined }),
      {
        getLocalProfile: async () => ({ id: "local-user" }),
      } as never,
      {
        listSessions: async () => [],
      } as never,
    );

    const internals = service as unknown as AnalyticsServiceInternals;
    await internals.sendAnalyticsEvent(
      "local-user",
      "skill_use",
      { skill_name: "web-search" },
      Date.now(),
    );

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(proxyFetch).mock.calls[0] ?? [];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
  });

  it("does not send when API key is not configured", async () => {
    const service = new AnalyticsService(
      createEnv({ posthogApiKey: undefined }),
      {
        getLocalProfile: async () => ({ id: "local-user" }),
      } as never,
      {
        listSessions: async () => [],
      } as never,
    );

    const internals = service as unknown as AnalyticsServiceInternals;
    await internals.sendAnalyticsEvent(
      "local-user",
      "skill_use",
      { skill_name: "web-search" },
      Date.now(),
    );

    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
