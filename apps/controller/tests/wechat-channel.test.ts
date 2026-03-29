import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { compileChannelsConfig } from "../src/lib/channel-binding-compiler.js";
import { OpenClawConfigWriter } from "../src/runtime/openclaw-config-writer.js";
import { ChannelService } from "../src/services/channel-service.js";
import type { OpenClawGatewayService } from "../src/services/openclaw-gateway-service.js";
import type { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import type { NexuConfigStore } from "../src/store/nexu-config-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

function createEnv(stateDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: path.join(stateDir, "nexu-home"),
    nexuConfigPath: path.join(stateDir, "nexu-home", "config.json"),
    artifactsIndexPath: path.join(stateDir, "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(stateDir, "compiled-openclaw.json"),
    openclawStateDir: stateDir,
    openclawConfigPath: path.join(stateDir, "openclaw.json"),
    openclawSkillsDir: path.join(stateDir, "skills"),
    openclawWorkspaceTemplatesDir: path.join(stateDir, "workspace-templates"),
    openclawBin: "openclaw",
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "link/gemini-3-flash-preview",
  } as unknown as ControllerEnv;
}

function makeChannel(
  overrides: Partial<{
    id: string;
    channelType: string;
    accountId: string;
    status: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "ch-1",
    botId: "bot-1",
    channelType: overrides.channelType ?? "wechat",
    accountId: overrides.accountId ?? "abc123-im-bot",
    status: overrides.status ?? "connected",
    teamName: null,
    appId: null,
    botUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeBot() {
  return {
    id: "bot-1",
    name: "Test Bot",
    slug: "test-bot",
    poolId: null,
    status: "active" as const,
    modelId: "anthropic/claude-sonnet-4",
    systemPrompt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// WeChat prewarm config compilation
// ---------------------------------------------------------------------------

describe("WeChat prewarm config compilation", () => {
  const bot = makeBot();

  it("includes openclaw-weixin with prewarm account when no WeChat channels exist", () => {
    const result = compileChannelsConfig({
      bots: [bot],
      channels: [],
      secrets: {},
    });

    expect(result["openclaw-weixin"]).toBeDefined();
    expect(result["openclaw-weixin"]!.enabled).toBe(true);
    expect(
      result["openclaw-weixin"]!.accounts["__nexu_internal_wechat_prewarm__"],
    ).toEqual({ enabled: false });
  });

  it("replaces prewarm with real account when WeChat channel is connected", () => {
    const result = compileChannelsConfig({
      bots: [bot],
      channels: [makeChannel({ accountId: "real-account-id" })],
      secrets: {},
    });

    expect(result["openclaw-weixin"]!.accounts["real-account-id"]).toEqual({
      enabled: true,
    });
    expect(
      result["openclaw-weixin"]!.accounts["__nexu_internal_wechat_prewarm__"],
    ).toBeUndefined();
  });

  it("does not include prewarm when a real WeChat account exists", () => {
    const result = compileChannelsConfig({
      bots: [bot],
      channels: [makeChannel()],
      secrets: {},
    });

    const accountKeys = Object.keys(result["openclaw-weixin"]!.accounts);
    expect(accountKeys).not.toContain("__nexu_internal_wechat_prewarm__");
    expect(accountKeys).toHaveLength(1);
  });

  it("ignores disconnected WeChat channels and falls back to prewarm", () => {
    const result = compileChannelsConfig({
      bots: [bot],
      channels: [makeChannel({ status: "disconnected" })],
      secrets: {},
    });

    expect(
      result["openclaw-weixin"]!.accounts["__nexu_internal_wechat_prewarm__"],
    ).toEqual({ enabled: false });
  });
});

// ---------------------------------------------------------------------------
// WeChat connect/disconnect lifecycle
// ---------------------------------------------------------------------------

describe("WeChat connect/disconnect lifecycle", () => {
  let tmpDir: string;
  let env: ControllerEnv;
  let service: ChannelService;
  let configStore: {
    connectWechat: ReturnType<typeof vi.fn>;
    disconnectChannel: ReturnType<typeof vi.fn>;
    getChannel: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };
  let syncService: {
    writePlatformTemplatesForBot: ReturnType<typeof vi.fn>;
    syncAll: ReturnType<typeof vi.fn>;
  };
  let gatewayService: {
    getChannelReadiness: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `nexu-wechat-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    env = createEnv(tmpDir);

    configStore = {
      connectWechat: vi.fn().mockResolvedValue(makeChannel()),
      disconnectChannel: vi.fn().mockResolvedValue(true),
      getChannel: vi.fn().mockResolvedValue(makeChannel()),
    };
    syncService = {
      writePlatformTemplatesForBot: vi.fn().mockResolvedValue(undefined),
      syncAll: vi.fn().mockResolvedValue(undefined),
    };
    gatewayService = {
      getChannelReadiness: vi.fn().mockResolvedValue({ ready: true }),
    };

    service = new ChannelService(
      env,
      configStore as unknown as NexuConfigStore,
      syncService as unknown as OpenClawSyncService,
      gatewayService as unknown as OpenClawGatewayService,
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("connectWechat syncs config and waits for readiness", async () => {
    const channel = await service.connectWechat("test-account");

    expect(configStore.connectWechat).toHaveBeenCalledWith({
      accountId: "test-account",
    });
    expect(syncService.writePlatformTemplatesForBot).toHaveBeenCalledWith(
      "bot-1",
    );
    expect(syncService.syncAll).toHaveBeenCalled();
    expect(gatewayService.getChannelReadiness).toHaveBeenCalledWith(
      "wechat",
      "test-account",
    );
    expect(channel.channelType).toBe("wechat");
  });

  it("connectWechat polls readiness until ready", async () => {
    let callCount = 0;
    gatewayService.getChannelReadiness.mockImplementation(async () => {
      callCount++;
      return { ready: callCount >= 3 };
    });

    await service.connectWechat("test-account");

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("disconnectChannel cleans up WeChat account state files", async () => {
    const accountId = "abc123-im-bot";
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");
    mkdirSync(accountsDir, { recursive: true });

    // Seed stale state (simulates previous connect)
    writeFileSync(
      path.join(accountsDir, `${accountId}.json`),
      JSON.stringify({ token: "tok", savedAt: now }),
    );
    writeFileSync(
      path.join(accountsDir, `${accountId}.sync.json`),
      JSON.stringify({ get_updates_buf: "buf" }),
    );
    writeFileSync(indexPath, JSON.stringify([accountId, "other-account"]));

    configStore.getChannel.mockResolvedValue(
      makeChannel({ id: "ch-1", accountId }),
    );

    await service.disconnectChannel("ch-1");

    // Credential and sync files should be removed
    expect(existsSync(path.join(accountsDir, `${accountId}.json`))).toBe(false);
    expect(existsSync(path.join(accountsDir, `${accountId}.sync.json`))).toBe(
      false,
    );

    // Index should only contain the other account
    const remainingIds = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(remainingIds).toEqual(["other-account"]);
  });

  it("disconnectChannel preserves other accounts in index", async () => {
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");
    mkdirSync(accountsDir, { recursive: true });

    writeFileSync(
      indexPath,
      JSON.stringify(["abc123-im-bot", "keep-me", "also-keep"]),
    );
    writeFileSync(
      path.join(accountsDir, "abc123-im-bot.json"),
      JSON.stringify({ token: "tok" }),
    );

    await service.disconnectChannel("ch-1");

    const remaining = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(remaining).toEqual(["keep-me", "also-keep"]);
  });

  it("disconnectChannel is a no-op for non-wechat channels", async () => {
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");
    mkdirSync(path.dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, JSON.stringify(["some-account"]));

    configStore.getChannel.mockResolvedValue(
      makeChannel({ id: "ch-1", channelType: "slack", accountId: "slack-id" }),
    );

    await service.disconnectChannel("ch-1");

    // WeChat index should be untouched
    const ids = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(ids).toEqual(["some-account"]);
  });

  it("disconnectChannel handles missing state dir gracefully", async () => {
    // No openclaw-weixin directory exists at all
    await expect(service.disconnectChannel("ch-1")).resolves.toBe(true);
  });

  it("multiple connect/disconnect cycles don't accumulate accounts", async () => {
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");
    mkdirSync(accountsDir, { recursive: true });

    // Simulate 3 connect/disconnect cycles with different account IDs
    const accountIds = ["acct-1-im-bot", "acct-2-im-bot", "acct-3-im-bot"];

    for (const accountId of accountIds) {
      // Seed state as if connectWechat wrote it
      writeFileSync(
        path.join(accountsDir, `${accountId}.json`),
        JSON.stringify({ token: "tok" }),
      );
      writeFileSync(
        path.join(accountsDir, `${accountId}.sync.json`),
        JSON.stringify({ get_updates_buf: "buf" }),
      );
      // Append to index
      const existing = existsSync(indexPath)
        ? (JSON.parse(readFileSync(indexPath, "utf-8")) as string[])
        : [];
      writeFileSync(indexPath, JSON.stringify([...existing, accountId]));

      // Disconnect
      configStore.getChannel.mockResolvedValue(
        makeChannel({ id: `ch-${accountId}`, accountId }),
      );
      configStore.disconnectChannel.mockResolvedValue(true);
      await service.disconnectChannel(`ch-${accountId}`);
    }

    // All should be cleaned up
    const remaining = existsSync(indexPath)
      ? (JSON.parse(readFileSync(indexPath, "utf-8")) as string[])
      : [];
    expect(remaining).toEqual([]);

    for (const accountId of accountIds) {
      expect(existsSync(path.join(accountsDir, `${accountId}.json`))).toBe(
        false,
      );
      expect(existsSync(path.join(accountsDir, `${accountId}.sync.json`))).toBe(
        false,
      );
    }
  });

  it("connectWechat rolls back on readiness timeout", async () => {
    gatewayService.getChannelReadiness.mockResolvedValue({
      ready: false,
      lastError: "monitor failed to start",
    });

    await expect(service.connectWechat("fail-account")).rejects.toThrow(
      "monitor failed to start",
    );

    // Should have disconnected the channel
    expect(configStore.disconnectChannel).toHaveBeenCalledWith("ch-1");
    // syncAll called twice: once for connect, once for rollback
    expect(syncService.syncAll).toHaveBeenCalledTimes(2);
  }, 35_000);

  it("disconnect cleanup runs before syncAll", async () => {
    const callOrder: string[] = [];
    const accountId = "abc123-im-bot";
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(
      path.join(accountsDir, `${accountId}.json`),
      JSON.stringify({ token: "tok" }),
    );
    writeFileSync(indexPath, JSON.stringify([accountId]));

    syncService.syncAll.mockImplementation(async () => {
      // At the point syncAll is called, the stale files should already
      // be removed so the config writer won't see them.
      callOrder.push("syncAll");
      const filesExist = existsSync(
        path.join(accountsDir, `${accountId}.json`),
      );
      callOrder.push(filesExist ? "files-still-exist" : "files-cleaned");
    });

    configStore.getChannel.mockResolvedValue(
      makeChannel({ id: "ch-1", accountId }),
    );
    await service.disconnectChannel("ch-1");

    expect(callOrder).toEqual(["syncAll", "files-cleaned"]);
  });
});

// ---------------------------------------------------------------------------
// syncWeixinAccountIndex (config writer)
// ---------------------------------------------------------------------------

describe("syncWeixinAccountIndex via OpenClawConfigWriter", () => {
  let tmpDir: string;
  let env: ControllerEnv;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `nexu-writer-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    env = createEnv(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not persist internal prewarm account ID to index", async () => {
    const writer = new OpenClawConfigWriter(env);
    const indexPath = path.join(tmpDir, "openclaw-weixin", "accounts.json");

    // Write config that includes the prewarm account (as compiler would produce)
    await writer.write({
      channels: {
        "openclaw-weixin": {
          enabled: true,
          accounts: {
            __nexu_internal_wechat_prewarm__: { enabled: false },
          },
        },
      },
    } as never);

    // Index should not contain the prewarm ID
    if (existsSync(indexPath)) {
      const ids = JSON.parse(readFileSync(indexPath, "utf-8"));
      expect(ids).not.toContain("__nexu_internal_wechat_prewarm__");
    }
  });

  it("removes stale account IDs not in current config", async () => {
    const indexDir = path.join(tmpDir, "openclaw-weixin");
    const indexPath = path.join(indexDir, "accounts.json");
    mkdirSync(indexDir, { recursive: true });

    // Seed index with stale IDs from previous sessions
    writeFileSync(
      indexPath,
      JSON.stringify(["stale-1", "stale-2", "current-account"]),
    );

    const writer = new OpenClawConfigWriter(env);
    await writer.write({
      channels: {
        "openclaw-weixin": {
          enabled: true,
          accounts: {
            "current-account": { enabled: true },
          },
        },
      },
    } as never);

    const ids = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(ids).toEqual(["current-account"]);
  });

  it("handles empty config accounts gracefully", async () => {
    const indexDir = path.join(tmpDir, "openclaw-weixin");
    const indexPath = path.join(indexDir, "accounts.json");
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(indexPath, JSON.stringify(["old-account"]));

    const writer = new OpenClawConfigWriter(env);
    await writer.write({
      channels: {
        "openclaw-weixin": {
          enabled: true,
          accounts: {},
        },
      },
    } as never);

    const ids = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(ids).toEqual([]);
  });
});
