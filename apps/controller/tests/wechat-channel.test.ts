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

// ---------------------------------------------------------------------------
// WeChat prewarm config compilation
// ---------------------------------------------------------------------------

describe("WeChat prewarm config compilation", () => {
  it("includes openclaw-weixin with prewarm account when no WeChat channels exist", () => {
    const result = compileChannelsConfig({
      channels: [],
      secrets: {},
    });

    expect(result["openclaw-weixin"]).toBeDefined();
    expect(result["openclaw-weixin"]?.enabled).toBe(true);
    expect(
      result["openclaw-weixin"]?.accounts.__nexu_internal_wechat_prewarm__,
    ).toEqual({ enabled: false });
  });

  it("replaces prewarm with real account when WeChat channel is connected", () => {
    const result = compileChannelsConfig({
      channels: [makeChannel({ accountId: "real-account-id" })],
      secrets: {},
    });

    expect(result["openclaw-weixin"]?.accounts["real-account-id"]).toEqual({
      enabled: true,
    });
    expect(
      result["openclaw-weixin"]?.accounts.__nexu_internal_wechat_prewarm__,
    ).toBeUndefined();
  });

  it("does not include prewarm when a real WeChat account exists", () => {
    const result = compileChannelsConfig({
      channels: [makeChannel()],
      secrets: {},
    });

    const accountKeys = Object.keys(result["openclaw-weixin"]?.accounts);
    expect(accountKeys).not.toContain("__nexu_internal_wechat_prewarm__");
    expect(accountKeys).toHaveLength(1);
  });

  it("ignores disconnected WeChat channels and falls back to prewarm", () => {
    const result = compileChannelsConfig({
      channels: [makeChannel({ status: "disconnected" })],
      secrets: {},
    });

    expect(
      result["openclaw-weixin"]?.accounts.__nexu_internal_wechat_prewarm__,
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

  it("connectWechat returns immediately without blocking on readiness", async () => {
    const channel = await service.connectWechat("test-account");

    expect(configStore.connectWechat).toHaveBeenCalledWith({
      accountId: "test-account",
    });
    // Connecting a channel must NOT re-seed platform templates — re-seeding
    // would clobber agent self-edits to AGENTS.md / IDENTITY.md / SOUL.md /
    // ... on every connect. Seeding is owned exclusively by AgentService.createBot.
    expect(syncService.writePlatformTemplatesForBot).not.toHaveBeenCalled();
    expect(syncService.syncAll).toHaveBeenCalledTimes(1);
    // Must NOT poll readiness — that blocks the connect modal and risks
    // a rollback that triggers additional config writes + restarts.
    expect(gatewayService.getChannelReadiness).not.toHaveBeenCalled();
    expect(channel.channelType).toBe("wechat");
  });

  it("connectWechat does not rollback on slow runtime startup", async () => {
    gatewayService.getChannelReadiness.mockResolvedValue({
      ready: false,
      lastError: "monitor failed to start",
    });

    const channel = await service.connectWechat("slow-account");

    expect(channel.channelType).toBe("wechat");
    expect(configStore.disconnectChannel).not.toHaveBeenCalled();
    expect(syncService.syncAll).toHaveBeenCalledTimes(1);
  });

  it("disconnectChannel calls syncAll after unbinding", async () => {
    await service.disconnectChannel("ch-1");

    expect(configStore.disconnectChannel).toHaveBeenCalledWith("ch-1");
    expect(syncService.syncAll).toHaveBeenCalled();
  });

  it("disconnectChannel does not delete credential files directly", async () => {
    const accountsDir = path.join(tmpDir, "openclaw-weixin", "accounts");
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(
      path.join(accountsDir, "abc123-im-bot.json"),
      JSON.stringify({ token: "tok" }),
    );

    await service.disconnectChannel("ch-1");

    expect(existsSync(path.join(accountsDir, "abc123-im-bot.json"))).toBe(true);
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

  it("removes orphan credential files not in authoritative set", async () => {
    const indexDir = path.join(tmpDir, "openclaw-weixin");
    const accountsDir = path.join(indexDir, "accounts");
    mkdirSync(accountsDir, { recursive: true });

    // Seed orphan credential + sync files from a previously disconnected account
    writeFileSync(
      path.join(accountsDir, "orphan-acct.json"),
      JSON.stringify({ token: "old" }),
    );
    writeFileSync(
      path.join(accountsDir, "orphan-acct.sync.json"),
      JSON.stringify({ get_updates_buf: "buf" }),
    );
    // Also seed a valid account's files
    writeFileSync(
      path.join(accountsDir, "current-acct.json"),
      JSON.stringify({ token: "valid" }),
    );

    const writer = new OpenClawConfigWriter(env);
    await writer.write({
      channels: {
        "openclaw-weixin": {
          enabled: true,
          accounts: { "current-acct": { enabled: true } },
        },
      },
    } as never);

    // Orphan files should be removed
    expect(existsSync(path.join(accountsDir, "orphan-acct.json"))).toBe(false);
    expect(existsSync(path.join(accountsDir, "orphan-acct.sync.json"))).toBe(
      false,
    );
    // Current account files preserved
    expect(existsSync(path.join(accountsDir, "current-acct.json"))).toBe(true);
  });
});
