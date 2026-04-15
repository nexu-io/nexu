import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "#controller/app/env.js";
import { OpenClawAuthService } from "#controller/services/openclaw-auth-service.js";

// ── Test helpers ─────────────────────────────────────────────────

function createEnv(openclawStateDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://cloud.nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: openclawStateDir,
    nexuConfigPath: path.join(openclawStateDir, "config.json"),
    artifactsIndexPath: path.join(openclawStateDir, "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      openclawStateDir,
      "compiled-openclaw.json",
    ),
    openclawStateDir,
    openclawConfigPath: path.join(openclawStateDir, "openclaw.json"),
    openclawSkillsDir: path.join(openclawStateDir, "skills"),
    openclawExtensionsDir: path.join(openclawStateDir, "extensions"),
    runtimePluginTemplatesDir: path.join(openclawStateDir, "plugins"),
    openclawCuratedSkillsDir: path.join(openclawStateDir, "bundled-skills"),
    openclawRuntimeModelStatePath: path.join(
      openclawStateDir,
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: path.join(openclawStateDir, "skillhub-cache"),
    skillDbPath: path.join(openclawStateDir, "skill-ledger.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      openclawStateDir,
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: "",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "openai/gpt-5",
  } as unknown as ControllerEnv;
}

async function setupAgentDir(stateDir: string): Promise<string> {
  const agentDir = path.join(stateDir, "agents", "test-agent-001", "agent");
  await mkdir(agentDir, { recursive: true });
  return agentDir;
}

async function writeAuthProfiles(
  agentDir: string,
  data: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(agentDir, "auth-profiles.json"),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

async function writeSharedAuthProfiles(
  stateDir: string,
  data: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(stateDir, "auth-profiles.json"),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

async function readAuthProfilesFile(
  agentDir: string,
): Promise<Record<string, unknown>> {
  const content = await readFile(
    path.join(agentDir, "auth-profiles.json"),
    "utf8",
  );
  return JSON.parse(content) as Record<string, unknown>;
}

// ── Tests ────────────────────────────────────────────────────────

describe("OpenClawAuthService", () => {
  let stateDir: string;
  let service: OpenClawAuthService;

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(tmpdir(), "oclaw-auth-test-"));
    service = new OpenClawAuthService(createEnv(stateDir));
  });

  afterEach(async () => {
    service.dispose();
    await rm(stateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── Flow status ──────────────────────────────────────────

  describe("getFlowStatus", () => {
    it("returns idle initially", () => {
      expect(service.getFlowStatus()).toEqual({ status: "idle" });
    });
  });

  // ── startOAuthFlow ───────────────────────────────────────

  describe("startOAuthFlow", () => {
    it("returns error for non-openai provider", async () => {
      const result = await service.startOAuthFlow("anthropic");
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Unsupported");
    });

    it("returns browserUrl for openai provider", async () => {
      const result = await service.startOAuthFlow("openai");
      expect(result).toHaveProperty("browserUrl");
      const { browserUrl } = result as { browserUrl: string };
      expect(browserUrl).toContain("auth.openai.com");
      expect(browserUrl).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
      expect(browserUrl).toContain("code_challenge=");
      expect(browserUrl).toContain("code_challenge_method=S256");
      expect(browserUrl).toContain("state=");
      expect(browserUrl).toContain("response_type=code");
    });

    it("sets flow status to pending after start", async () => {
      await service.startOAuthFlow("openai");
      expect(service.getFlowStatus().status).toBe("pending");
    });

    it("aborts previous flow when starting a new one", async () => {
      const result1 = await service.startOAuthFlow("openai");
      expect(result1).toHaveProperty("browserUrl");

      const result2 = await service.startOAuthFlow("openai");
      expect(result2).toHaveProperty("browserUrl");
      expect(service.getFlowStatus().status).toBe("pending");
    });
  });

  // ── getProviderOAuthStatus ───────────────────────────────

  describe("getProviderOAuthStatus", () => {
    it("returns connected:false for non-openai provider", async () => {
      const status = await service.getProviderOAuthStatus("anthropic");
      expect(status.connected).toBe(false);
    });

    it("returns connected:false when no agent directory exists", async () => {
      const status = await service.getProviderOAuthStatus("openai");
      expect(status.connected).toBe(false);
    });

    it("returns connected:true from the shared auth profiles fallback", async () => {
      await writeSharedAuthProfiles(stateDir, {
        version: 1,
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() + 3_600_000,
            accountId: "test-account",
          },
        },
      });

      const status = await service.getProviderOAuthStatus("openai");
      expect(status.connected).toBe(true);
      expect(status.provider).toBe("openai-codex");
    });

    it("returns connected:false when no profile exists", async () => {
      const agentDir = await setupAgentDir(stateDir);
      await writeAuthProfiles(agentDir, {
        version: 1,
        profiles: {},
      });

      const status = await service.getProviderOAuthStatus("openai");
      expect(status.connected).toBe(false);
    });

    it("returns connected:true for valid non-expired OAuth profile", async () => {
      const agentDir = await setupAgentDir(stateDir);
      await writeAuthProfiles(agentDir, {
        version: 1,
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() + 3_600_000, // 1 hour from now
            accountId: "test-account",
          },
        },
      });

      const status = await service.getProviderOAuthStatus("openai");
      expect(status.connected).toBe(true);
      expect(status.provider).toBe("openai-codex");
      expect(status.remainingMs).toBeGreaterThan(0);
    });

    it("returns connected:false for expired OAuth profile", async () => {
      const agentDir = await setupAgentDir(stateDir);
      await writeAuthProfiles(agentDir, {
        version: 1,
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() - 1000, // expired
            accountId: "test-account",
          },
        },
      });

      const status = await service.getProviderOAuthStatus("openai");
      expect(status.connected).toBe(false);
    });
  });

  // ── disconnectOAuth ──────────────────────────────────────

  describe("disconnectOAuth", () => {
    it("returns false for non-openai provider", async () => {
      const result = await service.disconnectOAuth("anthropic");
      expect(result).toBe(false);
    });

    it("returns false when no agent directory exists", async () => {
      const result = await service.disconnectOAuth("openai");
      expect(result).toBe(false);
    });

    it("disconnects the shared auth profiles fallback", async () => {
      await writeSharedAuthProfiles(stateDir, {
        version: 1,
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "test-token",
            refresh: "test-refresh",
            expires: Date.now() + 3_600_000,
            accountId: "test-account",
          },
        },
      });

      const result = await service.disconnectOAuth("openai");
      expect(result).toBe(true);

      const sharedProfiles = JSON.parse(
        await readFile(path.join(stateDir, "auth-profiles.json"), "utf8"),
      ) as { profiles: Record<string, unknown> };
      expect(sharedProfiles.profiles).not.toHaveProperty(
        "openai-codex:default",
      );
    });

    it("removes the openai-codex:default profile", async () => {
      const agentDir = await setupAgentDir(stateDir);
      await writeAuthProfiles(agentDir, {
        version: 1,
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "test-token",
            refresh: "test-refresh",
            expires: Date.now() + 3_600_000,
            accountId: "test-account",
          },
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-test",
          },
        },
        lastGood: {
          "openai-codex": "openai-codex:default",
        },
      });

      const result = await service.disconnectOAuth("openai");
      expect(result).toBe(true);

      // Verify file was updated
      const updated = await readAuthProfilesFile(agentDir);
      const profiles = updated.profiles as Record<string, unknown>;
      expect(profiles["openai-codex:default"]).toBeUndefined();
      // Other profiles preserved
      expect(profiles["anthropic:default"]).toBeDefined();
    });

    it("returns true even if profile doesn't exist (idempotent)", async () => {
      const agentDir = await setupAgentDir(stateDir);
      await writeAuthProfiles(agentDir, {
        version: 1,
        profiles: {},
      });

      const result = await service.disconnectOAuth("openai");
      expect(result).toBe(true);
    });
  });

  // ── consumeCompleted ─────────────────────────────────────

  describe("consumeCompleted", () => {
    it("returns null when no flow is completed", () => {
      expect(service.consumeCompleted()).toBeNull();
    });
  });
});
