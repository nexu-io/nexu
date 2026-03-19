import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";
import type { ControllerEnv } from "../src/app/env.js";
import { OpenClawConfigWriter } from "../src/runtime/openclaw-config-writer.js";
import { OpenClawProcessManager } from "../src/runtime/openclaw-process.js";
import { OpenClawSkillsWriter } from "../src/runtime/openclaw-skills-writer.js";
import { OpenClawWatchTrigger } from "../src/runtime/openclaw-watch-trigger.js";
import { RuntimeHealth } from "../src/runtime/runtime-health.js";
import { SessionsRuntime } from "../src/runtime/sessions-runtime.js";
import { createRuntimeState } from "../src/runtime/state.js";
import { WorkspaceTemplateWriter } from "../src/runtime/workspace-template-writer.js";
import { AgentService } from "../src/services/agent-service.js";
import { ArtifactService } from "../src/services/artifact-service.js";
import { ChannelService } from "../src/services/channel-service.js";
import { DesktopLocalService } from "../src/services/desktop-local-service.js";
import { IntegrationService } from "../src/services/integration-service.js";
import { LocalUserService } from "../src/services/local-user-service.js";
import { ModelProviderService } from "../src/services/model-provider-service.js";
import { OpenClawSyncService } from "../src/services/openclaw-sync-service.js";
import { RuntimeConfigService } from "../src/services/runtime-config-service.js";
import { SessionService } from "../src/services/session-service.js";
import { SkillService } from "../src/services/skill-service.js";
import { TemplateService } from "../src/services/template-service.js";
import { ArtifactsStore } from "../src/store/artifacts-store.js";
import { CompiledOpenClawStore } from "../src/store/compiled-openclaw-store.js";
import { NexuConfigStore } from "../src/store/nexu-config-store.js";

async function createTestContainer(
  rootDir: string,
): Promise<ControllerContainer> {
  const env: ControllerEnv = {
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
    openclawWorkspaceTemplatesDir: path.join(
      rootDir,
      ".openclaw",
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
  };

  const configStore = new NexuConfigStore(env);
  const artifactsStore = new ArtifactsStore(env);
  const compiledStore = new CompiledOpenClawStore(env);
  const configWriter = new OpenClawConfigWriter(env);
  const skillsWriter = new OpenClawSkillsWriter(env);
  const templateWriter = new WorkspaceTemplateWriter(env);
  const watchTrigger = new OpenClawWatchTrigger(env);
  const sessionsRuntime = new SessionsRuntime(env);
  const runtimeHealth = new RuntimeHealth(env);
  const openclawProcess = new OpenClawProcessManager(env);
  const runtimeState = createRuntimeState();
  const openclawSyncService = new OpenClawSyncService(
    env,
    configStore,
    compiledStore,
    configWriter,
    skillsWriter,
    templateWriter,
    watchTrigger,
  );

  return {
    env,
    gatewayClient: {
      fetchJson: vi.fn(),
    } as unknown as ControllerContainer["gatewayClient"],
    runtimeHealth,
    openclawProcess,
    agentService: new AgentService(configStore, openclawSyncService),
    channelService: new ChannelService(configStore, openclawSyncService),
    sessionService: new SessionService(sessionsRuntime),
    skillService: new SkillService(configStore, openclawSyncService),
    runtimeConfigService: new RuntimeConfigService(
      configStore,
      openclawSyncService,
    ),
    modelProviderService: new ModelProviderService(configStore),
    integrationService: new IntegrationService(configStore),
    localUserService: new LocalUserService(configStore),
    desktopLocalService: new DesktopLocalService(configStore),
    artifactService: new ArtifactService(artifactsStore),
    templateService: new TemplateService(configStore, openclawSyncService),
    openclawSyncService,
    runtimeState,
    startBackgroundLoops: () => () => {},
  };
}

describe("controller route compatibility", () => {
  let rootDir = "";
  let container: ControllerContainer;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-controller-routes-"));
    container = await createTestContainer(rootDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("serves local auth/user compatibility endpoints", async () => {
    const app = createApp(container);

    const sessionResponse = await app.request("/api/auth/get-session");
    expect(sessionResponse.status).toBe(200);

    const meResponse = await app.request("/api/v1/me");
    expect(meResponse.status).toBe(200);
    const me = (await meResponse.json()) as { email: string };
    expect(me.email).toBe("desktop@nexu.local");
  });

  it("supports channel connect, integration connect, session lifecycle, and runtime config routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("slack.com/api/auth.test")) {
          return new Response(
            JSON.stringify({
              ok: true,
              team_id: "T123",
              team: "Acme",
              bot_id: "B123",
            }),
            { status: 200 },
          );
        }
        if (url.includes("slack.com/api/bots.info")) {
          return new Response(
            JSON.stringify({ ok: true, bot: { app_id: "A123" } }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const app = createApp(container);

    const channelConnect = await app.request("/api/v1/channels/slack/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botToken: "xoxb-test",
        signingSecret: "secret",
        teamId: "T123",
        appId: "A123",
      }),
    });
    expect(channelConnect.status).toBe(200);

    const integrationConnect = await app.request(
      "/api/v1/integrations/connect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolkitSlug: "openai",
          credentials: { apiKey: "sk-test" },
          source: "page",
        }),
      },
    );
    expect(integrationConnect.status).toBe(200);

    const createSession = await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        sessionKey: "s1",
        title: "Session 1",
      }),
    });
    expect(createSession.status).toBe(201);

    const listSessions = await app.request("/api/v1/sessions?limit=10");
    expect(listSessions.status).toBe(200);
    const sessionList = (await listSessions.json()) as {
      total: number;
      sessions: Array<{ id: string }>;
    };
    expect(sessionList.total).toBe(1);

    const resetSession = await app.request(
      `/api/v1/sessions/${sessionList.sessions[0]?.id}/reset`,
      {
        method: "POST",
      },
    );
    expect(resetSession.status).toBe(200);

    const runtimeUpdate = await app.request("/api/v1/runtime-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gateway: { port: 18789, bind: "loopback", authMode: "none" },
        defaultModelId: "gpt-4o",
      }),
    });
    expect(runtimeUpdate.status).toBe(200);
  });

  it("serves skill and workspace template internal compatibility endpoints", async () => {
    const app = createApp(container);

    const skillUpsert = await app.request(
      "/api/internal/skills/daily-standup",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "# Standup" }),
      },
    );
    expect(skillUpsert.status).toBe(200);

    const latestSkills = await app.request("/api/internal/skills/latest");
    expect(latestSkills.status).toBe(200);

    const templateUpsert = await app.request(
      "/api/internal/workspace-templates/AGENTS.md",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      },
    );
    expect(templateUpsert.status).toBe(200);

    const latestTemplates = await app.request(
      "/api/internal/workspace-templates/latest",
    );
    expect(latestTemplates.status).toBe(200);
  });
});
