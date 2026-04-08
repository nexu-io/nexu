import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  resolveAnalyticsDistinctId: () => Promise<string | null>;
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

  it("resolves analytics distinct id from cloud user id", async () => {
    const service = new AnalyticsService(
      createEnv(),
      {
        getDesktopCloudStatus: async () => ({ userId: "cloud-user-123" }),
      } as never,
      {
        listSessions: async () => [],
      } as never,
    );

    const internals = service as unknown as AnalyticsServiceInternals;
    await expect(internals.resolveAnalyticsDistinctId()).resolves.toBe(
      "cloud-user-123",
    );
  });

  it("skips analytics distinct id for desktop-local-user", async () => {
    const service = new AnalyticsService(
      createEnv(),
      {
        getDesktopCloudStatus: async () => ({ userId: "desktop-local-user" }),
      } as never,
      {
        listSessions: async () => [],
      } as never,
    );

    const internals = service as unknown as AnalyticsServiceInternals;
    await expect(internals.resolveAnalyticsDistinctId()).resolves.toBeNull();
  });

  it("does not poll sessions when no real cloud user id is available", async () => {
    const listSessions = vi.fn().mockResolvedValue([]);
    const service = new AnalyticsService(
      createEnv(),
      {
        getDesktopCloudStatus: async () => ({ userId: null }),
      } as never,
      {
        listSessions,
      } as never,
    );

    await service.poll();

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it("advances dedupe state without sending events when no real cloud user id is available", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "analytics-service-test-"));
    const transcriptPath = path.join(tempDir, "session.jsonl");
    writeFileSync(
      transcriptPath,
      `${[
        JSON.stringify({
          type: "model_change",
          provider: "openai",
        }),
        JSON.stringify({
          id: "message-1",
          type: "message",
          timestamp: "2026-04-08T00:00:00.000Z",
          message: {
            role: "user",
          },
        }),
        JSON.stringify({
          id: "assistant-1",
          type: "message",
          timestamp: "2026-04-08T00:00:01.000Z",
          message: {
            role: "assistant",
            provider: "openai",
            content: [],
          },
        }),
      ].join("\n")}
`,
      "utf8",
    );

    const listSessions = vi.fn().mockResolvedValue([
      {
        id: "session-1",
        channelType: "slack",
        metadata: {
          path: transcriptPath,
        },
      },
    ]);

    const service = new AnalyticsService(
      createEnv({
        analyticsStatePath: path.join(tempDir, "analytics-state.json"),
      }),
      {
        getDesktopCloudStatus: async () => ({ userId: null }),
      } as never,
      {
        listSessions,
      } as never,
    );

    const sendAnalyticsEvent = vi.spyOn(
      service as unknown as AnalyticsServiceInternals,
      "sendAnalyticsEvent",
    );

    await service.poll();
    await service.poll();

    expect(listSessions).toHaveBeenCalledTimes(2);
    expect(sendAnalyticsEvent).not.toHaveBeenCalled();
  });
});
