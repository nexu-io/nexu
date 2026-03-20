import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "../src/components/activity-feed";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "home.minutesAgo" && values?.count != null) {
        return `${String(values.count)}m ago`;
      }
      if (key === "home.hoursAgo" && values?.count != null) {
        return `${String(values.count)}h ago`;
      }
      if (key === "home.daysAgo" && values?.count != null) {
        return `${String(values.count)}d ago`;
      }
      if (key === "home.justActive") {
        return "just now";
      }
      return key;
    },
  }),
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Sessions: vi.fn(async () => ({
    data: undefined,
  })),
}));

function renderActivityFeed(): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(["sessions-recent"], {
    sessions: [
      {
        id: "sess-1",
        title: "唐其远",
        channelType: "feishu",
        lastMessageAt: "2026-03-20T08:58:00.000Z",
        messageCount: 5,
        status: "active",
      },
    ],
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActivityFeed />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivityFeed", () => {
  it("links recent activity rows to the matching workspace session", () => {
    const markup = renderActivityFeed();

    expect(markup).toContain('data-activity-session-link="sess-1"');
    expect(markup).toContain('href="/workspace/sessions/sess-1"');
    expect(markup).toContain("唐其远");
  });
});
