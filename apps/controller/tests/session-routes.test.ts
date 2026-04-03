import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import { createApp } from "../src/app/create-app.js";
import type { ControllerEnv } from "../src/app/env.js";
import { logger } from "../src/lib/logger.js";
import { SessionsRuntime } from "../src/runtime/sessions-runtime.js";
import { createRuntimeState } from "../src/runtime/state.js";
import { ArtifactService } from "../src/services/artifact-service.js";
import { SessionService } from "../src/services/session-service.js";
import { ArtifactsStore } from "../src/store/artifacts-store.js";

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
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
    openclawCuratedSkillsDir: path.join(rootDir, ".openclaw", "bundled-skills"),
    skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
    skillDbPath: path.join(rootDir, ".nexu", "skillhub.db"),
    staticSkillsDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      rootDir,
      ".openclaw",
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: "token-123",
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
  } as ControllerEnv;
}

function createTestContainer(rootDir: string): ControllerContainer {
  const env = createEnv(rootDir);
  const sessionsRuntime = new SessionsRuntime(env);
  const artifactService = new ArtifactService(new ArtifactsStore(env), env);

  return {
    env,
    configStore: {} as ControllerContainer["configStore"],
    gatewayClient: {} as ControllerContainer["gatewayClient"],
    runtimeHealth: {
      probe: vi.fn(async () => ({
        ok: true,
      })),
    } as unknown as ControllerContainer["runtimeHealth"],
    openclawProcess: {} as ControllerContainer["openclawProcess"],
    agentService: {} as ControllerContainer["agentService"],
    channelService: {} as ControllerContainer["channelService"],
    channelFallbackService: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["channelFallbackService"],
    sessionService: new SessionService(sessionsRuntime, artifactService),
    runtimeConfigService: {} as ControllerContainer["runtimeConfigService"],
    runtimeModelStateService:
      {} as ControllerContainer["runtimeModelStateService"],
    modelProviderService: {} as ControllerContainer["modelProviderService"],
    integrationService: {} as ControllerContainer["integrationService"],
    localUserService: {} as ControllerContainer["localUserService"],
    desktopLocalService: {} as ControllerContainer["desktopLocalService"],
    analyticsService: {} as ControllerContainer["analyticsService"],
    artifactService,
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
    openclawSyncService: {} as ControllerContainer["openclawSyncService"],
    openclawAuthService: {} as ControllerContainer["openclawAuthService"],
    wsClient: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["wsClient"],
    gatewayService: {
      isConnected: vi.fn(() => false),
    } as unknown as ControllerContainer["gatewayService"],
    runtimeState: createRuntimeState(),
    startBackgroundLoops: () => () => {},
  };
}

describe("session routes", () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  it("deletes session files and managed local artifacts together", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-session-delete-"));
    const container = createTestContainer(rootDir);
    const app = createApp(container);

    const createSession = await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-art",
        sessionKey: "delete-me",
        title: "Delete me",
        channelType: "slack",
      }),
    });

    expect(createSession.status).toBe(201);

    const transcriptPath = path.join(
      rootDir,
      ".openclaw",
      "agents",
      "bot-art",
      "sessions",
      "delete-me.jsonl",
    );
    const metadataPath = transcriptPath.replace(/\.jsonl$/, ".meta.json");
    const managedImagePath = path.join(
      rootDir,
      ".nexu",
      "artifacts",
      "images",
      "delete-me.png",
    );
    const externalImagePath = path.join(rootDir, "outside-delete-me.png");
    const managedRootMarkerPath = path.join(rootDir, ".nexu", "keep.txt");

    const otherManagedImagePath = path.join(
      rootDir,
      ".nexu",
      "artifacts",
      "images",
      "other-bot-delete-me.png",
    );

    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await mkdir(path.dirname(managedImagePath), { recursive: true });
    await writeFile(managedRootMarkerPath, "keep", "utf8");
    await writeFile(transcriptPath, "", "utf8");
    await writeFile(
      metadataPath,
      JSON.stringify({ sessionKey: "delete-me" }),
      "utf8",
    );
    await writeFile(managedImagePath, "managed", "utf8");
    await writeFile(externalImagePath, "external", "utf8");
    await writeFile(otherManagedImagePath, "other-managed", "utf8");

    await container.artifactService.createArtifact({
      botId: "bot-art",
      sessionKey: "delete-me",
      title: "Managed artifact",
      previewUrl: `file://${managedImagePath}`,
      metadata: {
        outputPath: managedImagePath,
      },
    });
    await container.artifactService.createArtifact({
      botId: "bot-art",
      sessionKey: "delete-me",
      title: "External artifact",
      previewUrl: `file://${externalImagePath}`,
      metadata: {
        outputPath: externalImagePath,
      },
    });
    await container.artifactService.createArtifact({
      botId: "bot-art",
      sessionKey: "delete-me",
      title: "Managed root artifact",
      metadata: {
        directoryPath: container.env.nexuHomeDir,
      },
    });
    await container.artifactService.createArtifact({
      botId: "bot-other",
      sessionKey: "delete-me",
      title: "Other bot artifact",
      previewUrl: `file://${otherManagedImagePath}`,
      metadata: {
        outputPath: otherManagedImagePath,
      },
    });

    const response = await app.request(
      "/api/v1/sessions/delete-me.jsonl?botId=bot-art",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    await expect(stat(transcriptPath)).rejects.toThrow();
    await expect(stat(metadataPath)).rejects.toThrow();
    await expect(stat(managedImagePath)).rejects.toThrow();
    await expect(readFile(managedRootMarkerPath, "utf8")).resolves.toBe("keep");
    await expect(readFile(externalImagePath, "utf8")).resolves.toBe("external");
    await expect(readFile(otherManagedImagePath, "utf8")).resolves.toBe(
      "other-managed",
    );

    const artifacts = await container.artifactService.listArtifacts({
      limit: 10,
      offset: 0,
      sessionKey: "delete-me",
    });
    expect(artifacts.artifacts).toHaveLength(1);
    expect(artifacts.artifacts[0]?.botId).toBe("bot-other");
  });

  it("still succeeds when artifact cleanup fails after session files are removed", async () => {
    rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-session-delete-warning-"),
    );
    const container = createTestContainer(rootDir);
    const app = createApp(container);

    const createSession = await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-warning",
        sessionKey: "warn-me",
        title: "Warn me",
        channelType: "slack",
      }),
    });

    expect(createSession.status).toBe(201);

    const transcriptPath = path.join(
      rootDir,
      ".openclaw",
      "agents",
      "bot-warning",
      "sessions",
      "warn-me.jsonl",
    );
    const metadataPath = transcriptPath.replace(/\.jsonl$/, ".meta.json");
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await writeFile(transcriptPath, "", "utf8");
    await writeFile(
      metadataPath,
      JSON.stringify({ sessionKey: "warn-me" }),
      "utf8",
    );

    const deleteArtifactsForSessionMock = vi
      .spyOn(container.artifactService, "deleteArtifactsForSession")
      .mockRejectedValueOnce(new Error("artifact cleanup failed"));
    const loggerWarnMock = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    const response = await app.request(
      "/api/v1/sessions/warn-me.jsonl?botId=bot-warning",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    await expect(stat(transcriptPath)).rejects.toThrow();
    await expect(stat(metadataPath)).rejects.toThrow();
    expect(deleteArtifactsForSessionMock).toHaveBeenCalledWith(
      "bot-warning",
      "warn-me",
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "warn-me.jsonl",
        botId: "bot-warning",
        sessionKey: "warn-me",
        error: "artifact cleanup failed",
      }),
      "session_delete_artifact_cleanup_failed",
    );
  });

  it("retains artifact index entries when file cleanup cannot be completed", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-session-delete-retain-"));
    const container = createTestContainer(rootDir);
    const app = createApp(container);

    const createSession = await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-retain",
        sessionKey: "retain-me",
        title: "Retain me",
        channelType: "slack",
      }),
    });
    expect(createSession.status).toBe(201);

    const transcriptPath = path.join(
      rootDir,
      ".openclaw",
      "agents",
      "bot-retain",
      "sessions",
      "retain-me.jsonl",
    );
    const metadataPath = transcriptPath.replace(/\.jsonl$/, ".meta.json");
    const unsafeDirectoryPath = path.join(
      rootDir,
      ".nexu",
      "artifacts",
      "retain-me-dir",
    );

    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await mkdir(unsafeDirectoryPath, { recursive: true });
    await writeFile(transcriptPath, "", "utf8");
    await writeFile(
      metadataPath,
      JSON.stringify({ sessionKey: "retain-me" }),
      "utf8",
    );

    await container.artifactService.createArtifact({
      botId: "bot-retain",
      sessionKey: "retain-me",
      title: "Directory artifact",
      metadata: {
        filePath: unsafeDirectoryPath,
      },
    });

    const loggerWarnMock = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    const response = await app.request(
      "/api/v1/sessions/retain-me.jsonl?botId=bot-retain",
      {
        method: "DELETE",
      },
    );
    expect(response.status).toBe(200);

    await expect(stat(transcriptPath)).rejects.toThrow();
    await expect(stat(metadataPath)).rejects.toThrow();
    await expect(stat(unsafeDirectoryPath)).resolves.toBeTruthy();

    const artifacts = await container.artifactService.listArtifacts({
      limit: 10,
      offset: 0,
      sessionKey: "retain-me",
    });
    expect(artifacts.artifacts).toHaveLength(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-retain",
        sessionKey: "retain-me",
        filePath: unsafeDirectoryPath,
      }),
      "session_delete_artifact_cleanup_skipped_directory_path",
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot-retain",
        sessionKey: "retain-me",
        retainedArtifacts: 1,
      }),
      "session_delete_artifact_index_retained_for_retry",
    );
  });

  it("deletes only the bot-scoped session when sessionKey is reused", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-session-delete-scoped-"));
    const container = createTestContainer(rootDir);
    const app = createApp(container);

    await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-a",
        sessionKey: "shared",
        title: "Shared A",
        channelType: "slack",
      }),
    });
    await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-b",
        sessionKey: "shared",
        title: "Shared B",
        channelType: "slack",
      }),
    });

    const botAPath = path.join(
      rootDir,
      ".openclaw",
      "agents",
      "bot-a",
      "sessions",
      "shared.jsonl",
    );
    const botBPath = path.join(
      rootDir,
      ".openclaw",
      "agents",
      "bot-b",
      "sessions",
      "shared.jsonl",
    );
    await mkdir(path.dirname(botAPath), { recursive: true });
    await mkdir(path.dirname(botBPath), { recursive: true });
    await writeFile(botAPath, "bot-a", "utf8");
    await writeFile(botBPath, "bot-b", "utf8");

    const missingBotId = await app.request("/api/v1/sessions/shared.jsonl", {
      method: "DELETE",
    });
    expect(missingBotId.status).toBe(400);

    const response = await app.request(
      "/api/v1/sessions/shared.jsonl?botId=bot-b",
      {
        method: "DELETE",
      },
    );

    expect(response.status).toBe(200);
    await expect(readFile(botAPath, "utf8")).resolves.toBe("bot-a");
    await expect(stat(botBPath)).rejects.toThrow();
  });

  it("serves cleaned chat history through the session messages API", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-session-routes-"));
    const container = createTestContainer(rootDir);
    const app = createApp(container);

    const createSession = await app.request("/api/internal/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot-feishu",
        sessionKey: "clean-api",
        title: "Feishu cleanup",
        channelType: "feishu",
      }),
    });

    expect(createSession.status).toBe(201);

    const sessionPath = path.join(
      rootDir,
      ".openclaw",
      "agents",
      "bot-feishu",
      "sessions",
      "clean-api.jsonl",
    );
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "message",
          id: "msg-user",
          timestamp: "2026-03-23T02:00:00.000Z",
          message: {
            role: "user",
            timestamp: Date.parse("2026-03-23T02:00:00.000Z"),
            content: [
              {
                type: "text",
                text: [
                  "Conversation info (untrusted metadata):",
                  "```json",
                  JSON.stringify(
                    {
                      message_id: "om_x100",
                      sender: "唐其远",
                    },
                    null,
                    2,
                  ),
                  "```",
                  "",
                  "Sender (untrusted metadata):",
                  "```json",
                  JSON.stringify(
                    {
                      label: "唐其远 (ou_123)",
                      id: "ou_123",
                      name: "唐其远",
                    },
                    null,
                    2,
                  ),
                  "```",
                  "",
                  "Replied message (untrusted, for context):",
                  "```json",
                  JSON.stringify(
                    {
                      body: "[Interactive Card]",
                    },
                    null,
                    2,
                  ),
                  "```",
                  "",
                  "[message_id: om_x100]",
                  '唐其远: [Replying to: "[Interactive Card]"]',
                  "",
                  "你是谁",
                  "",
                  '[System: The content may include mention tags in the form <at user_id="...">name</at>. Treat these as real mentions of Feishu entities (users or bots).]',
                  '[System: If user_id is "ou_123", that mention refers to you.]',
                ].join("\n"),
              },
            ],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-assistant",
          timestamp: "2026-03-23T02:01:00.000Z",
          message: {
            role: "assistant",
            timestamp: Date.parse("2026-03-23T02:01:00.000Z"),
            content: [
              {
                type: "thinking",
                thinking: "**Checking records**",
              },
              {
                type: "text",
                text: "[[reply_to_current]] 已扫描全部记录，没有发现异常。",
              },
              {
                type: "toolCall",
                id: "tool-1",
                name: "feishu_bitable_list_records",
                arguments: {
                  tableId: "tbl_123",
                },
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const response = await app.request(
      "/api/v1/sessions/clean-api.jsonl/messages?limit=10",
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: unknown;
      }>;
    };

    expect(payload.messages).toStrictEqual([
      {
        id: "msg-user",
        role: "user",
        timestamp: Date.parse("2026-03-23T02:00:00.000Z"),
        createdAt: "2026-03-23T02:00:00.000Z",
        content: [
          {
            type: "replyContext",
            text: "[Interactive Card]",
          },
          {
            type: "text",
            text: "你是谁",
          },
        ],
      },
      {
        id: "msg-assistant",
        role: "assistant",
        timestamp: Date.parse("2026-03-23T02:01:00.000Z"),
        createdAt: "2026-03-23T02:01:00.000Z",
        content: [
          {
            type: "text",
            text: "已扫描全部记录，没有发现异常。",
          },
          {
            type: "toolCall",
            id: "tool-1",
            name: "feishu_bitable_list_records",
            arguments: {
              tableId: "tbl_123",
            },
          },
        ],
      },
    ]);
  });
});
