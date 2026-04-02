import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";
import type { ControllerEnv } from "../src/app/env.js";
import { createRuntimeState } from "../src/runtime/state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: path.join(rootDir, ".nexu"),
    nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
    artifactsIndexPath: path.join(rootDir, ".nexu", "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      rootDir,
      ".nexu",
      "compiled-openclaw.json",
    ),
    openclawStateDir: path.join(rootDir, ".openclaw"),
    openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
    openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
    openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
    runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
    openclawCuratedSkillsDir: path.join(rootDir, ".openclaw", "bundled-skills"),
    openclawRuntimeModelStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
    skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
    analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      rootDir,
      ".openclaw",
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
    posthogApiKey: undefined,
    posthogHost: undefined,
  } as ControllerEnv;
}

const now = new Date().toISOString();

function makeChannel(accountId = "abc123-im-bot") {
  return {
    id: "ch-wechat-1",
    botId: "bot-1",
    channelType: "wechat",
    accountId,
    status: "connected",
    teamName: null,
    appId: null,
    botUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createTestContainer(): ControllerContainer {
  const env = createEnv("/tmp/nexu-wechat-flow-test");

  const channelService = {
    wechatQrStart: vi.fn().mockResolvedValue({
      qrDataUrl: "data:image/png;base64,test-qr-data",
      sessionKey: "session-uuid-123",
      message: "使用微信扫描以下二维码，以完成连接。",
    }),
    wechatQrWait: vi.fn().mockResolvedValue({
      connected: true,
      accountId: "abc123-im-bot",
      message: "微信连接成功。",
    }),
    connectWechat: vi.fn().mockResolvedValue(makeChannel()),
    disconnectChannel: vi.fn().mockResolvedValue(true),
    listChannels: vi.fn().mockResolvedValue([]),
  };

  const gatewayService = {
    isConnected: vi.fn(() => true),
    getAllChannelsLiveStatus: vi.fn().mockResolvedValue({
      gatewayConnected: true,
      channels: [],
    }),
    getChannelReadiness: vi.fn().mockResolvedValue({
      ready: true,
      connected: true,
      running: true,
      configured: true,
      lastError: null,
      gatewayConnected: true,
    }),
  };

  return {
    env,
    configStore: {} as ControllerContainer["configStore"],
    gatewayClient: {} as ControllerContainer["gatewayClient"],
    runtimeHealth: {
      probe: vi.fn(async () => ({ ok: true })),
    } as unknown as ControllerContainer["runtimeHealth"],
    openclawProcess: {} as ControllerContainer["openclawProcess"],
    agentService: {} as ControllerContainer["agentService"],
    channelService:
      channelService as unknown as ControllerContainer["channelService"],
    channelFallbackService: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["channelFallbackService"],
    sessionService: {} as ControllerContainer["sessionService"],
    runtimeConfigService: {} as ControllerContainer["runtimeConfigService"],
    runtimeModelStateService: {
      getEffectiveModelId: vi.fn().mockReturnValue("link/gpt-5.4"),
    } as unknown as ControllerContainer["runtimeModelStateService"],
    modelProviderService: {
      listModels: vi.fn().mockResolvedValue({ models: [] }),
      upsertProvider: vi.fn(),
      deleteProvider: vi.fn(),
      ensureValidDefaultModel: vi.fn(),
    } as unknown as ControllerContainer["modelProviderService"],
    integrationService: {} as ControllerContainer["integrationService"],
    localUserService: {} as ControllerContainer["localUserService"],
    desktopLocalService: {} as ControllerContainer["desktopLocalService"],
    analyticsService: {} as ControllerContainer["analyticsService"],
    artifactService: {} as ControllerContainer["artifactService"],
    templateService: {} as ControllerContainer["templateService"],
    skillhubService: {
      catalog: {
        getCatalog: vi.fn(() => ({
          skills: [],
          installedSlugs: [],
          installedSkills: [],
          meta: null,
        })),
        installSkill: vi.fn(),
        uninstallSkill: vi.fn(),
        refreshCatalog: vi.fn(),
        importSkillZip: vi.fn(),
      },
      start: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["skillhubService"],
    openclawSyncService: {
      syncAll: vi.fn(),
    } as unknown as ControllerContainer["openclawSyncService"],
    openclawAuthService: {
      startOAuthFlow: vi.fn(),
      getFlowStatus: vi.fn(() => ({ status: "completed" as const })),
      consumeCompleted: vi.fn(),
      getProviderOAuthStatus: vi.fn(),
      disconnectOAuth: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["openclawAuthService"],
    wsClient: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["wsClient"],
    gatewayService:
      gatewayService as unknown as ControllerContainer["gatewayService"],
    runtimeState: createRuntimeState(),
    startBackgroundLoops: () => () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WeChat connect flow (API-level)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── QR start ────────────────────────────────────────────────

  it("POST /wechat/qr-start returns QR data and sessionKey", async () => {
    const container = createTestContainer();
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/wechat/qr-start", {
      method: "POST",
    });

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toMatchObject({
      qrDataUrl: expect.stringContaining("data:"),
      sessionKey: expect.any(String),
      message: expect.any(String),
    });
    expect(container.channelService.wechatQrStart).toHaveBeenCalled();
  });

  // ── QR wait → confirmed ─────────────────────────────────────

  it("POST /wechat/qr-wait returns accountId on confirmed scan", async () => {
    const container = createTestContainer();
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/wechat/qr-wait", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey: "session-uuid-123" }),
    });

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toMatchObject({
      connected: true,
      accountId: "abc123-im-bot",
    });
  });

  // ── QR wait → expired ───────────────────────────────────────

  it("POST /wechat/qr-wait returns connected=false on expired QR", async () => {
    const container = createTestContainer();
    (
      container.channelService.wechatQrWait as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      connected: false,
      message: "二维码已过期，请重新生成。",
    });
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/wechat/qr-wait", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey: "expired-session" }),
    });

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.connected).toBe(false);
  });

  // ── Connect (non-blocking) ──────────────────────────────────

  it("POST /wechat/connect returns immediately without blocking", async () => {
    const container = createTestContainer();
    const app = createApp(container);

    const start = Date.now();
    const resp = await app.request("/api/v1/channels/wechat/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "abc123-im-bot" }),
    });
    const elapsed = Date.now() - start;

    expect(resp.status).toBe(200);
    // Must return in under 1 second — proves no readiness polling
    expect(elapsed).toBeLessThan(1000);
    expect(container.channelService.connectWechat).toHaveBeenCalledWith(
      "abc123-im-bot",
    );
  });

  // ── Disconnect ──────────────────────────────────────────────

  it("DELETE /channels/{id} disconnects channel", async () => {
    const container = createTestContainer();
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/ch-wechat-1", {
      method: "DELETE",
    });

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.success).toBe(true);
    expect(container.channelService.disconnectChannel).toHaveBeenCalledWith(
      "ch-wechat-1",
    );
  });

  // ── Live status: connected ──────────────────────────────────

  it("GET /channels/live-status shows connected channel", async () => {
    const container = createTestContainer();
    const channel = makeChannel();
    (
      container.channelService.listChannels as ReturnType<typeof vi.fn>
    ).mockResolvedValue([channel]);
    (
      container.gatewayService.getAllChannelsLiveStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({
      gatewayConnected: true,
      channels: [
        {
          channelType: "wechat",
          channelId: "ch-wechat-1",
          accountId: "abc123-im-bot",
          status: "connected",
          ready: true,
          connected: true,
          running: true,
          configured: true,
          lastError: null,
        },
      ],
    });
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/live-status");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.gatewayConnected).toBe(true);
    const wechat = data.channels.find(
      (c: { channelType: string }) => c.channelType === "wechat",
    );
    expect(wechat).toMatchObject({
      status: "connected",
      ready: true,
      lastError: null,
    });
  });

  // ── Live status: session expired ────────────────────────────

  it("GET /channels/live-status shows error on session expired", async () => {
    const container = createTestContainer();
    const channel = makeChannel();
    (
      container.channelService.listChannels as ReturnType<typeof vi.fn>
    ).mockResolvedValue([channel]);
    (
      container.gatewayService.getAllChannelsLiveStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({
      gatewayConnected: true,
      channels: [
        {
          channelType: "wechat",
          channelId: "ch-wechat-1",
          accountId: "abc123-im-bot",
          status: "error",
          ready: false,
          connected: false,
          running: false,
          configured: false,
          lastError: "session expired",
        },
      ],
    });
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/live-status");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    const wechat = data.channels.find(
      (c: { channelType: string }) => c.channelType === "wechat",
    );
    expect(wechat).toMatchObject({
      status: "error",
      ready: false,
      lastError: "session expired",
    });
  });

  // ── Live status: connecting (post-connect transition) ───────

  it("GET /channels/live-status shows connecting during startup", async () => {
    const container = createTestContainer();
    const channel = makeChannel();
    (
      container.channelService.listChannels as ReturnType<typeof vi.fn>
    ).mockResolvedValue([channel]);
    (
      container.gatewayService.getAllChannelsLiveStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({
      gatewayConnected: true,
      channels: [
        {
          channelType: "wechat",
          channelId: "ch-wechat-1",
          accountId: "abc123-im-bot",
          status: "connecting",
          ready: false,
          connected: false,
          running: true,
          configured: true,
          lastError: null,
        },
      ],
    });
    const app = createApp(container);

    const resp = await app.request("/api/v1/channels/live-status");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    const wechat = data.channels.find(
      (c: { channelType: string }) => c.channelType === "wechat",
    );
    expect(wechat?.status).toBe("connecting");
  });

  // ── Full cycle: QR start → wait → connect → live → disconnect

  it("full connect → live-status → disconnect cycle", async () => {
    const container = createTestContainer();
    const app = createApp(container);
    const channel = makeChannel();

    // Step 1: QR start
    const startResp = await app.request("/api/v1/channels/wechat/qr-start", {
      method: "POST",
    });
    expect(startResp.status).toBe(200);
    const { sessionKey } = await startResp.json();
    expect(sessionKey).toBeTruthy();

    // Step 2: QR wait (confirmed)
    const waitResp = await app.request("/api/v1/channels/wechat/qr-wait", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionKey }),
    });
    expect(waitResp.status).toBe(200);
    const waitData = await waitResp.json();
    expect(waitData.connected).toBe(true);
    expect(waitData.accountId).toBeTruthy();

    // Step 3: Connect (non-blocking)
    const connectResp = await app.request("/api/v1/channels/wechat/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: waitData.accountId }),
    });
    expect(connectResp.status).toBe(200);

    // Step 4: Live status shows connected
    (
      container.channelService.listChannels as ReturnType<typeof vi.fn>
    ).mockResolvedValue([channel]);
    (
      container.gatewayService.getAllChannelsLiveStatus as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({
      gatewayConnected: true,
      channels: [
        {
          channelType: "wechat",
          channelId: "ch-wechat-1",
          accountId: "abc123-im-bot",
          status: "connected",
          ready: true,
          connected: true,
          running: true,
          configured: true,
          lastError: null,
        },
      ],
    });
    const liveResp = await app.request("/api/v1/channels/live-status");
    expect(liveResp.status).toBe(200);
    const liveData = await liveResp.json();
    expect(
      liveData.channels.find(
        (c: { channelType: string }) => c.channelType === "wechat",
      )?.status,
    ).toBe("connected");

    // Step 5: Disconnect
    const disconnectResp = await app.request("/api/v1/channels/ch-wechat-1", {
      method: "DELETE",
    });
    expect(disconnectResp.status).toBe(200);
    expect(container.channelService.disconnectChannel).toHaveBeenCalledWith(
      "ch-wechat-1",
    );
  });
});
