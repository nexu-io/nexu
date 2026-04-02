import { rewardTasks } from "@nexu/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import zhCN from "#web/i18n/locales/zh-CN";
import { HomePage } from "#web/pages/home";
import { RewardsPage } from "#web/pages/rewards";

vi.mock("@/lib/api", () => ({}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock("#web/lib/api", () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@web-gen/api/sdk.gen", () => ({
  getApiV1Channels: vi.fn(async () => ({
    data: {
      channels: [],
    },
  })),
}));

function renderHomePage(): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(HomePage)),
    ),
  );
}

function renderRewardsPage(): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(["desktop-rewards"], {
    viewer: {
      cloudConnected: false,
      activeModelId: null,
      activeModelProviderId: null,
      usingManagedModel: false,
    },
    progress: {
      claimedCount: 2,
      totalCount: rewardTasks.length,
      earnedCredits: 5,
      availableCredits: rewardTasks.reduce((sum, task) => sum + task.reward, 0),
    },
    tasks: rewardTasks.map((task) => ({
      ...task,
      isClaimed: task.id === "daily_checkin" || task.id === "github_star",
      lastClaimedAt: null,
      claimCount:
        task.id === "daily_checkin" || task.id === "github_star" ? 1 : 0,
    })),
  });

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(RewardsPage)),
    ),
  );
}

describe("HomePage", () => {
  it("does not render the removed rewards teaser card on the home page", () => {
    const markup = renderHomePage();

    expect(markup).not.toContain('href="/workspace/rewards"');
    expect(markup).not.toContain("budget.viral.loginFirst");
    expect(markup).not.toContain("home.rewardsTeaser.cta");
  });

  it("renders the development budget debug panel", () => {
    const markup = renderHomePage();

    expect(markup).toContain("Budget Debug");
    expect(markup).toContain("真实状态");
    expect(markup).toContain("预警");
    expect(markup).toContain("耗尽");
  });

  it("renders the alpha hero as a looping muted autoplay video", () => {
    const markup = renderHomePage();

    expect(markup).toContain('src="/nexu-alpha.mp4"');
    expect(markup).toContain('poster="/nexu-alpha-poster.jpg"');
    expect(markup).toContain('autoPlay=""');
    expect(markup).toContain('playsInline=""');
    expect(markup).toContain('muted=""');
    expect(markup).toContain('loop=""');
  });
});

describe("RewardsPage", () => {
  it("renders the merged social rewards group including Facebook and WhatsApp", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain("rewards.group.social");
    expect(markup).toContain("reward.facebook.name");
    expect(markup).toContain("reward.whatsapp.name");
  });

  it("renders svg-based reward icons for Xiaohongshu and Jike instead of letter placeholders", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain('data-reward-task-icon="xiaohongshu"');
    expect(markup).toContain('data-reward-task-icon="jike"');
    expect(markup).not.toContain(">R<");
    expect(markup).not.toContain(">J<");
  });

  it("renders the source reward rules link in the header", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain("budget.viral.rules");
    expect(markup).toContain("https://docs.nexu.io/rewards");
  });

  it("matches the source rewards page shell instead of the wider card layout", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain("max-w-[520px]");
    expect(markup).not.toContain("rewards.badge");
    expect(markup).not.toContain("rewards.refresh");
  });
});

describe("Rewards locale parity", () => {
  it("keeps the source Chinese rewards copy for the header and task labels", () => {
    expect(zhCN["rewards.desc"]).toBe("完成以下任务，获得额外用量。");
    expect(zhCN["reward.github_star.name"]).toBe("Star us");
    expect(zhCN["reward.reddit.name"]).toBe("发帖到 Reddit");
    expect(zhCN["reward.xiaohongshu.name"]).toBe("发帖到小红书");
    expect(zhCN["reward.lingying.name"]).toBe("发帖到瓴英");
    expect(zhCN["reward.jike.name"]).toBe("发帖到即刻");
  });
});
