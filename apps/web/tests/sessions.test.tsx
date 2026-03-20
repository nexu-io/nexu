import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SessionsPage } from "../src/pages/sessions";

vi.mock("@/lib/tracking", () => ({
  track: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "sessions.chat.messages" && values?.count != null) {
        return `${String(values.count)} messages`;
      }
      if (key === "sessions.chat.lastActive" && values?.time != null) {
        return `Last active ${String(values.time)}`;
      }
      return key;
    },
  }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Channels: vi.fn(async () => ({
    data: undefined,
  })),
  getApiV1SessionsById: vi.fn(async () => ({
    data: undefined,
  })),
  getApiV1SessionsByIdMessages: vi.fn(async () => ({
    data: undefined,
  })),
}));

function renderSessionsPage(): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(["session-meta", "sess-1"], {
    id: "sess-1",
    title: "Alex DM",
    channelType: "slack",
    messageCount: 2,
    lastMessageAt: "2026-03-20T08:58:00.000Z",
    metadata: {
      isGroup: false,
    },
  });
  queryClient.setQueryData(["chat-history", "sess-1"], {
    messages: [
      {
        id: "msg-1",
        role: "user",
        content:
          "[message_id: 123]\\nAlex: Can you summarize tomorrow's meetings?",
        timestamp: new Date("2026-03-20T08:57:00.000Z").getTime(),
        createdAt: "2026-03-20T08:57:00.000Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Sure. I checked your calendar and drafted the summary.",
          },
          {
            type: "toolCall",
            name: "google-calendar",
          },
        ],
        timestamp: new Date("2026-03-20T08:58:00.000Z").getTime(),
        createdAt: "2026-03-20T08:58:00.000Z",
      },
    ],
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace/sessions/sess-1"]}>
        <Routes>
          <Route path="/workspace/sessions/:id" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SessionsPage", () => {
  it("renders a structured session header and cleaned transcript", () => {
    const markup = renderSessionsPage();

    expect(markup).toContain('data-session-platform="slack"');
    expect(markup).toContain('data-chat-thread="sess-1"');
    expect(markup).toContain("<title>Slack</title>");
    expect(markup).toContain("Can you summarize tomorrow&#x27;s meetings?");
    expect(markup).not.toContain("[message_id:");
    expect(markup).toContain("google-calendar");
    expect(markup).toContain("Open in Slack");
  });

  it("renders a Feishu deep link when the backing channel config is available", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    queryClient.setQueryData(["session-meta", "sess-2"], {
      id: "sess-2",
      botId: "bot-feishu",
      sessionKey: "sess-2",
      channelId: "channel-feishu-1",
      title: "唐其远",
      channelType: "feishu",
      messageCount: 1,
      lastMessageAt: "2026-03-20T08:58:00.000Z",
      metadata: {
        path: "/Users/qiyuan/.openclaw/agents/bot-feishu/sessions/sess-2.jsonl",
        openChatId: "oc_41e7bdf4877cfc316136f4ccf6c32613",
      },
    });
    queryClient.setQueryData(["chat-history", "sess-2"], {
      messages: [
        {
          id: "msg-3",
          role: "assistant",
          content: "Hello from Feishu",
          timestamp: new Date("2026-03-20T08:58:00.000Z").getTime(),
          createdAt: "2026-03-20T08:58:00.000Z",
        },
      ],
    });
    queryClient.setQueryData(["channels"], {
      channels: [
        {
          id: "channel-feishu-1",
          channelType: "feishu",
          accountId: "feishu:cli_xxx",
          teamName: "Feishu Team",
          appId: "cli_xxx",
          botUserId: null,
          status: "connected",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace/sessions/sess-2"]}>
          <Routes>
            <Route path="/workspace/sessions/:id" element={<SessionsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain(
      'href="https://applink.feishu.cn/client/chat/open?openChatId=oc_41e7bdf4877cfc316136f4ccf6c32613"',
    );
    expect(markup).toContain("Open in Feishu");
    expect(markup).toContain("Open Folder");
    expect(markup).toContain(
      'data-session-folder-url="file:///Users/qiyuan/.openclaw/agents/bot-feishu/sessions"',
    );
  });

  it("does not render a wrong Feishu deep link when exact chat metadata is missing", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    queryClient.setQueryData(["session-meta", "sess-3"], {
      id: "sess-3",
      botId: "bot-feishu",
      sessionKey: "sess-3",
      channelId: "channel-feishu-1",
      title: "唐其远",
      channelType: "feishu",
      messageCount: 1,
      lastMessageAt: "2026-03-20T08:58:00.000Z",
      metadata: {
        path: "/Users/qiyuan/.openclaw/agents/bot-feishu/sessions/sess-3.jsonl",
        openId: "ou_00c644f271002b17348e992569f0f327",
      },
    });
    queryClient.setQueryData(["chat-history", "sess-3"], {
      messages: [
        {
          id: "msg-4",
          role: "assistant",
          content: "Hello from Feishu DM",
          timestamp: new Date("2026-03-20T08:58:00.000Z").getTime(),
          createdAt: "2026-03-20T08:58:00.000Z",
        },
      ],
    });
    queryClient.setQueryData(["channels"], {
      channels: [
        {
          id: "channel-feishu-1",
          channelType: "feishu",
          accountId: "feishu:cli_xxx",
          teamName: "Feishu Team",
          appId: "cli_xxx",
          botUserId: null,
          status: "connected",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace/sessions/sess-3"]}>
          <Routes>
            <Route path="/workspace/sessions/:id" element={<SessionsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Open in Feishu");
    expect(markup).not.toContain(
      'href="https://applink.feishu.cn/client/chat/open?openId=ou_00c644f271002b17348e992569f0f327"',
    );
    expect(markup).not.toContain(
      'href="https://applink.feishu.cn/client/bot/open?appId=cli_xxx"',
    );
  });
});
