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

  it("uses a stable WeChat fallback title when sender metadata is missing", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-weixin", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(
      sessionsDir,
      "b1392694-8959-454f-8571-a83cf1f6abef.jsonl",
    );

    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-weixin-1",
        timestamp: "2026-03-22T10:49:06.478Z",
        message: {
          role: "user",
          timestamp: 1774176546475,
          content: [
            {
              type: "text",
              text: [
                "Conversation info (untrusted metadata):",
                "```json",
                JSON.stringify(
                  {
                    message_id: "openclaw-weixin:1774176546217-9644087e",
                    timestamp: "Sun 2026-03-22 18:49 GMT+8",
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

    const sessions = await runtime.listSessions();
    const session = sessions.find(
      (item) => item.sessionKey === "b1392694-8959-454f-8571-a83cf1f6abef",
    );

    expect(session?.title).toBe("WeChat ClawBot");
  });

  it("replaces persisted uuid-like titles with inferred WeChat conversation titles", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-weixin", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionKey = "b1392694-8959-454f-8571-a83cf1f6abef";
    const sessionPath = path.join(sessionsDir, `${sessionKey}.jsonl`);

    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-weixin-2",
        timestamp: "2026-03-22T10:49:06.478Z",
        message: {
          role: "user",
          timestamp: 1774176546475,
          content: [
            {
              type: "text",
              text: [
                "Conversation info (untrusted metadata):",
                "```json",
                JSON.stringify(
                  {
                    message_id: "openclaw-weixin:1774176546217-9644087e",
                    timestamp: "Sun 2026-03-22 18:49 GMT+8",
                    channel: "openclaw-weixin",
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
    await writeFile(
      sessionPath.replace(/\.jsonl$/, ".meta.json"),
      `${JSON.stringify({ title: sessionKey }, null, 2)}\n`,
      "utf8",
    );

    const sessions = await runtime.listSessions();
    const session = sessions.find((item) => item.sessionKey === sessionKey);

    expect(session?.channelType).toBe("openclaw-weixin");
    expect(session?.title).toBe("WeChat ClawBot");
  });

  it("normalizes Feishu chat history before returning it", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-feishu", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, "feishu-cleanup.jsonl");
    await writeFile(
      sessionPath.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify(
        {
          title: "Feishu thread",
          channelType: "feishu",
        },
        null,
        2,
      ),
      "utf8",
    );
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

    const result = await runtime.getChatHistory("feishu-cleanup.jsonl");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      id: "msg-user",
      role: "user",
    });
    expect(result.messages[0]?.content).toStrictEqual([
      {
        type: "replyContext",
        text: "[Interactive Card]",
      },
      {
        type: "text",
        text: "你是谁",
      },
    ]);
    expect(result.messages[1]).toMatchObject({
      id: "msg-assistant",
      role: "assistant",
    });
    expect(result.messages[1]?.content).toStrictEqual([
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
    ]);
  });

  it("does not strip system-like user text for non-Feishu channels", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-slack", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, "slack-raw.jsonl");
    await writeFile(
      sessionPath.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify(
        {
          title: "Slack thread",
          channelType: "slack",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-user",
        timestamp: "2026-03-23T02:02:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-03-23T02:02:00.000Z"),
          content: [
            {
              type: "text",
              text: "Please keep this literal text: [System: deploy window is 15:00]",
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const result = await runtime.getChatHistory("slack-raw.jsonl");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toStrictEqual([
      {
        type: "text",
        text: "Please keep this literal text: [System: deploy window is 15:00]",
      },
    ]);
  });

  it("strips Feishu system suffixes even when channelType casing differs", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-feishu", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, "feishu-casing.jsonl");
    await writeFile(
      sessionPath.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify(
        {
          title: "Feishu casing",
          channelType: "FEISHU",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-user",
        timestamp: "2026-03-23T02:02:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-03-23T02:02:00.000Z"),
          content: [
            {
              type: "text",
              text: [
                "Please keep this literal text",
                '[System: The content may include mention tags in the form <at user_id="...">name</at>. Treat these as real mentions of Feishu entities (users or bots).]',
              ].join("\n"),
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const result = await runtime.getChatHistory("feishu-casing.jsonl");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toStrictEqual([
      {
        type: "text",
        text: "Please keep this literal text",
      },
    ]);
  });

  it("drops transcript entries that only contain unknown blocks", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-web", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, "unknown-blocks.jsonl");
    await writeFile(
      sessionPath.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify(
        {
          title: "Unknown blocks",
          channelType: "web",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-unknown-only",
        timestamp: "2026-03-23T02:04:00.000Z",
        message: {
          role: "assistant",
          timestamp: Date.parse("2026-03-23T02:04:00.000Z"),
          content: [
            {
              type: "customBlock",
              payload: "opaque",
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const result = await runtime.getChatHistory("unknown-blocks.jsonl");

    expect(result.messages).toHaveLength(0);
  });

  it("extracts reply context for other channel-specific quote prefixes", async () => {
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

    const sessionsDir = path.join(rootDir, "agents", "bot-weixin", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, "weixin-reply.jsonl");
    await writeFile(
      sessionPath.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify(
        {
          title: "WeChat thread",
          channelType: "openclaw-weixin",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "msg-user",
        timestamp: "2026-03-23T02:03:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-03-23T02:03:00.000Z"),
          content: [
            {
              type: "text",
              text: "[引用: 原始卡片消息]\\n\\n你好",
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const result = await runtime.getChatHistory("weixin-reply.jsonl");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toStrictEqual([
      {
        type: "replyContext",
        text: "原始卡片消息",
      },
      {
        type: "text",
        text: "你好",
      },
    ]);
  });
});
