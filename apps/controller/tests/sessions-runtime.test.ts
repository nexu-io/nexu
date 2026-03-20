import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { SessionsRuntime } from "../src/runtime/sessions-runtime.js";

function createEnv(overrides: Record<string, unknown> = {}): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuCloudUrl: "https://nexu.io",
    nexuLinkUrl: null,
    nexuHomeDir: "/tmp/nexu-test",
    nexuConfigPath: "/tmp/nexu-test/config.json",
    artifactsIndexPath: "/tmp/nexu-test/artifacts/index.json",
    compiledOpenclawSnapshotPath: "/tmp/nexu-test/compiled-openclaw.json",
    openclawStateDir: "/tmp/openclaw",
    openclawConfigPath: "/tmp/openclaw/openclaw.json",
    openclawSkillsDir: "/tmp/openclaw/skills",
    openclawCuratedSkillsDir: "/tmp/openclaw/bundled-skills",
    skillhubCacheDir: "/tmp/nexu-test/skillhub-cache",
    skillDbPath: "/tmp/nexu-test/skill-ledger.db",
    staticSkillsDir: undefined,
    openclawWorkspaceTemplatesDir: "/tmp/openclaw/workspace-templates",
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
    ...overrides,
  } as unknown as ControllerEnv;
}

describe("SessionsRuntime", () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  it("merges filesystem metadata into session responses", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-sessions-runtime-"));
    const runtime = new SessionsRuntime(
      createEnv({
        openclawStateDir: rootDir,
        openclawConfigPath: path.join(rootDir, "openclaw.json"),
        openclawSkillsDir: path.join(rootDir, "skills"),
        openclawCuratedSkillsDir: path.join(rootDir, "bundled-skills"),
        openclawWorkspaceTemplatesDir: path.join(
          rootDir,
          "workspace-templates",
        ),
      }),
    );

    await runtime.createOrUpdateSession({
      botId: "bot-1",
      sessionKey: "s1",
      title: "Session 1",
      metadata: {
        openChatId: "oc_123",
      },
    });

    const sessions = await runtime.listSessions();
    const session = sessions[0];

    expect(session?.metadata).toMatchObject({
      openChatId: "oc_123",
      source: "openclaw-filesystem",
      path: path.join(rootDir, "agents", "bot-1", "sessions", "s1.jsonl"),
    });
  });

  it("infers and persists Feishu exact chat targets from transcript metadata", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-sessions-runtime-"));
    const nexuConfigPath = path.join(rootDir, "config.json");
    const runtime = new SessionsRuntime(
      createEnv({
        nexuConfigPath,
        openclawStateDir: rootDir,
        openclawConfigPath: path.join(rootDir, "openclaw.json"),
        openclawSkillsDir: path.join(rootDir, "skills"),
        openclawCuratedSkillsDir: path.join(rootDir, "bundled-skills"),
        openclawWorkspaceTemplatesDir: path.join(
          rootDir,
          "workspace-templates",
        ),
      }),
    );
    await writeFile(
      nexuConfigPath,
      JSON.stringify(
        {
          channels: [
            {
              id: "feishu-channel-1",
              botId: "bot-feishu",
              channelType: "feishu",
              appId: "cli_test",
            },
          ],
          secrets: {
            "channel:feishu-channel-1:appId": "cli_test",
            "channel:feishu-channel-1:appSecret": "secret_test",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const sessionsDir = path.join(rootDir, "agents", "bot-feishu", "sessions");
    await mkdir(sessionsDir, { recursive: true });

    const groupSessionPath = path.join(sessionsDir, "group.jsonl");
    await writeFile(
      groupSessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-group-1",
        timestamp: "2026-03-20T09:00:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-03-20T09:00:00.000Z"),
          content: [
            {
              type: "text",
              text: [
                "Conversation info (untrusted metadata):",
                "```json",
                JSON.stringify(
                  {
                    message_id: "om_group_1",
                    sender_id: "ou_00c644f271002b17348e992569f0f327",
                    conversation_label: "oc_22e522a5c7c13fbbfbf22d82463a5d11",
                    group_subject: "oc_22e522a5c7c13fbbfbf22d82463a5d11",
                    sender: "唐其远",
                    is_group_chat: true,
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
                    label: "唐其远 (ou_00c644f271002b17348e992569f0f327)",
                    id: "ou_00c644f271002b17348e992569f0f327",
                    name: "唐其远",
                  },
                  null,
                  2,
                ),
                "```",
              ].join("\n"),
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const directSessionPath = path.join(sessionsDir, "direct.jsonl");
    await writeFile(
      directSessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-direct-1",
        timestamp: "2026-03-20T09:05:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-03-20T09:05:00.000Z"),
          content: [
            {
              type: "text",
              text: [
                "Conversation info (untrusted metadata):",
                "```json",
                JSON.stringify(
                  {
                    message_id: "om_direct_1",
                    sender_id: "ou_00c644f271002b17348e992569f0f327",
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
                    label: "唐其远 (ou_00c644f271002b17348e992569f0f327)",
                    id: "ou_00c644f271002b17348e992569f0f327",
                    name: "唐其远",
                  },
                  null,
                  2,
                ),
                "```",
              ].join("\n"),
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: "tenant_token_test",
            expire: 7200,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("/open-apis/im/v1/messages/om_direct_1")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  message_id: "om_direct_1",
                  chat_id: "oc_4471dc3c56e6479a29555460b452b217",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sessions = await runtime.listSessions();

    expect(
      sessions.find((session) => session.sessionKey === "group")?.metadata,
    ).toMatchObject({
      openChatId: "oc_22e522a5c7c13fbbfbf22d82463a5d11",
      openId: "ou_00c644f271002b17348e992569f0f327",
    });
    expect(
      sessions.find((session) => session.sessionKey === "direct")?.metadata,
    ).toMatchObject({
      openChatId: "oc_4471dc3c56e6479a29555460b452b217",
      openId: "ou_00c644f271002b17348e992569f0f327",
    });

    const persistedGroupMeta = JSON.parse(
      await readFile(
        groupSessionPath.replace(/\.jsonl$/, ".meta.json"),
        "utf8",
      ),
    ) as { metadata?: Record<string, unknown> };
    expect(persistedGroupMeta.metadata).toMatchObject({
      openChatId: "oc_22e522a5c7c13fbbfbf22d82463a5d11",
      openId: "ou_00c644f271002b17348e992569f0f327",
    });

    const persistedDirectMeta = JSON.parse(
      await readFile(
        directSessionPath.replace(/\.jsonl$/, ".meta.json"),
        "utf8",
      ),
    ) as { metadata?: Record<string, unknown> };
    expect(persistedDirectMeta.metadata).toMatchObject({
      openChatId: "oc_4471dc3c56e6479a29555460b452b217",
      openId: "ou_00c644f271002b17348e992569f0f327",
    });
  });
});
