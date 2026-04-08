import { rewardTasks } from "@nexu/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import zhCN from "../src/i18n/locales/zh-CN";
import { HomePage } from "../src/pages/home";
import { RewardsPage } from "../src/pages/rewards";

vi.mock("@/lib/api", () => ({}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock("../src/lib/api", () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("../lib/api/sdk.gen", () => ({
  getApiV1Channels: vi.fn(async () => ({
    data: {
      channels: [],
    },
  })),
}));

function renderHomePage(rewardsStatus?: {
  viewer: {
    cloudConnected: boolean;
    activeModelId: string | null;
    activeModelProviderId: string | null;
    usingManagedModel: boolean;
  };
  progress: {
    claimedCount: number;
    totalCount: number;
    earnedCredits: number;
    availableCredits?: number;
  };
  cloudBalance: {
    totalBalance: number;
    totalRecharged: number;
    totalConsumed: number;
  } | null;
  tasks?: Array<Record<string, unknown>>;
}): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  if (rewardsStatus) {
    queryClient.setQueryData(["desktop-rewards"], {
      tasks: [],
      ...rewardsStatus,
    });
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderRewardsPage(rewardsStatus?: {
  viewer: {
    cloudConnected: boolean;
    activeModelId: string | null;
    activeModelProviderId: string | null;
    usingManagedModel: boolean;
  };
  progress: {
    claimedCount: number;
    totalCount: number;
    earnedCredits: number;
    availableCredits?: number;
  };
  cloudBalance?: {
    totalBalance: number;
    totalRecharged: number;
    totalConsumed: number;
  } | null;
  tasks?: Array<Record<string, unknown>>;
}): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  if (rewardsStatus) {
    queryClient.setQueryData(["desktop-rewards"], {
      viewer: rewardsStatus.viewer,
      progress: rewardsStatus.progress,
      cloudBalance: rewardsStatus.cloudBalance ?? null,
      tasks:
        rewardsStatus.tasks ??
        rewardTasks.map((task) => ({
          ...task,
          isClaimed: task.id === "daily_checkin" || task.id === "github_star",
          lastClaimedAt: null,
          claimCount:
            task.id === "daily_checkin" || task.id === "github_star" ? 1 : 0,
        })),
    });
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
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

  it("does not show a budget banner after switching away from managed models", () => {
    const markup = renderHomePage({
      viewer: {
        cloudConnected: true,
        activeModelId: "openai/gpt-4.1",
        activeModelProviderId: "openai",
        usingManagedModel: false,
      },
      progress: {
        claimedCount: 4,
        totalCount: 10,
        earnedCredits: 800,
      },
      cloudBalance: {
        totalBalance: 0,
        totalRecharged: 800,
        totalConsumed: 800,
      },
    });

    expect(markup).not.toContain("budget.banner.depletedTitle");
    expect(markup).not.toContain("budget.banner.warningTitle");
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

  it("renders the budget banner below the hero block on the home page", () => {
    const markup = renderHomePage({
      viewer: {
        cloudConnected: true,
        activeModelId: "link/gemini",
        activeModelProviderId: "link",
        usingManagedModel: true,
      },
      progress: {
        claimedCount: 6,
        totalCount: 10,
        earnedCredits: 1200,
      },
      cloudBalance: {
        totalBalance: 5,
        totalRecharged: 1205,
        totalConsumed: 1200,
      },
    });

    expect(markup).toContain('data-budget-banner-status="warning"');
    expect(markup.indexOf("nexu alpha")).toBeLessThan(
      markup.indexOf('data-budget-banner-status="warning"'),
    );
    expect(markup.indexOf('data-budget-banner-status="warning"')).toBeLessThan(
      markup.indexOf("Channels"),
    );
  });
});

describe("RewardsPage", () => {
  it("renders a loading summary instead of fake zero values before rewards resolve", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain('data-rewards-summary-loading="true"');
    expect(markup).not.toContain("+$0");
    expect(markup).not.toContain("0 / 11");
  });

  it("renders the merged social rewards group including Facebook and WhatsApp", () => {
    const markup = renderRewardsPage({
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
        availableCredits: rewardTasks.reduce(
          (sum, task) => sum + task.reward,
          0,
        ),
      },
      cloudBalance: null,
    });

    expect(markup).toContain("rewards.group.social");
    expect(markup).toContain("reward.facebook.name");
    expect(markup).toContain("reward.whatsapp.name");
  });

  it("renders the source reward rules link in the header", () => {
    const markup = renderRewardsPage({
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
        availableCredits: rewardTasks.reduce(
          (sum, task) => sum + task.reward,
          0,
        ),
      },
      cloudBalance: null,
    });

    expect(markup).toContain("budget.viral.rules");
    expect(markup).toContain("https://docs.nexu.io/rewards");
  });

  it("uses the积分 copy and hides the redundant cloud balance summary card", () => {
    const markup = renderRewardsPage({
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
        availableCredits: rewardTasks.reduce(
          (sum, task) => sum + task.reward,
          0,
        ),
      },
      cloudBalance: null,
    });

    expect(zhCN["rewards.title"]).toBe("分享 nexu，获取额外积分");
    expect(zhCN["rewards.desc"]).toBe(
      "把 nexu 分享给你的社区，完成任务获取额外积分。",
    );
    expect(markup).toContain("layout.sidebar.balanceUnit");
    expect(markup).not.toContain("rewards.cloudBalance");
    expect(markup).not.toContain("rewards.totalEarned");
    expect(markup).not.toContain("rewards.totalUsed");
  });

  it("aligns the rewards page shell with the home content width", () => {
    const markup = renderRewardsPage({
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
        availableCredits: rewardTasks.reduce(
          (sum, task) => sum + task.reward,
          0,
        ),
      },
      cloudBalance: null,
    });

    expect(markup).toContain("max-w-4xl");
    expect(markup).not.toContain("max-w-[520px]");
    expect(markup).not.toContain("rewards.badge");
    expect(markup).not.toContain("rewards.refresh");
  });
});

describe("Rewards locale parity", () => {
  it("keeps the source Chinese rewards copy for the header and task labels", () => {
    expect(zhCN["rewards.title"]).toBe("分享 nexu，获取额外积分");
    expect(zhCN["rewards.desc"]).toBe(
      "把 nexu 分享给你的社区，完成任务获取额外积分。",
    );
    expect(zhCN["reward.github_star.name"]).toBe("Star us");
    expect(zhCN["reward.reddit.name"]).toBe("发帖到 Reddit");
    expect(zhCN["reward.xiaohongshu.name"]).toBe("发帖到小红书");
    expect(zhCN["reward.lingying.name"]).toBe("发帖到瓴英");
    expect(zhCN["reward.jike.name"]).toBe("发帖到即刻");
  });
});
