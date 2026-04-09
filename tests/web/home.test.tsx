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
  getApiInternalDesktopReady: vi.fn(async () => ({
    data: {
      status: "active",
    },
  })),
  getApiV1ChannelsLiveStatus: vi.fn(async () => ({
    data: {
      gatewayConnected: true,
      channels: [],
      agent: {
        modelId: "link/gemini",
        modelName: "Gemini",
        alive: true,
      },
    },
  })),
  getApiV1Sessions: vi.fn(async () => ({
    data: {
      sessions: [],
    },
  })),
}));

function renderHomePage({
  channels,
  sessions,
  rewardsStatus,
  liveStatus,
}: {
  channels?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
  rewardsStatus?: Record<string, unknown>;
  liveStatus?: Record<string, unknown>;
} = {}): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(["runtime-ready"], {
    status: "active",
  });
  queryClient.setQueryData(["channels"], {
    channels: channels ?? [],
  });
  queryClient.setQueryData(["sessions"], {
    sessions: sessions ?? [],
  });
  if (liveStatus) {
    queryClient.setQueryData(["channels-live-status"], liveStatus);
  }
  if (rewardsStatus) {
    queryClient.setQueryData(["desktop-rewards"], rewardsStatus);
  }

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(HomePage)),
    ),
  );
}

function renderRewardsPage(rewardsStatus?: {
  viewer?: {
    cloudConnected: boolean;
    activeModelId: string | null;
    activeModelProviderId: string | null;
    usingManagedModel: boolean;
  };
  progress?: {
    claimedCount: number;
    totalCount: number;
    earnedCredits: number;
    availableCredits?: number;
  };
  tasks?: Array<Record<string, unknown>>;
  cloudBalance?: {
    totalBalance: number;
    totalRecharged: number;
    totalConsumed: number;
  } | null;
}): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(["desktop-rewards"], {
    viewer: rewardsStatus?.viewer ?? {
      cloudConnected: false,
      activeModelId: null,
      activeModelProviderId: null,
      usingManagedModel: false,
      ...rewardsStatus?.viewer,
    },
    progress: rewardsStatus?.progress ?? {
      claimedCount: 2,
      totalCount: rewardTasks.length,
      earnedCredits: 5,
      availableCredits: rewardTasks.reduce((sum, task) => sum + task.reward, 0),
      ...rewardsStatus?.progress,
    },
    tasks:
      rewardsStatus?.tasks ??
      rewardTasks.map((task) => ({
        ...task,
        isClaimed: task.id === "daily_checkin" || task.id === "github_star",
        lastClaimedAt: null,
        claimCount:
          task.id === "daily_checkin" || task.id === "github_star" ? 1 : 0,
      })),
    cloudBalance: rewardsStatus?.cloudBalance ?? null,
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

  it("does not fall back to the onboarding scene when session history already exists", () => {
    const markup = renderHomePage({
      sessions: [
        {
          id: "session-1",
          channelType: "feishu",
          title: "Alice · feishu",
          messageCount: 5,
          lastMessageAt: "2026-04-02T03:22:43.694Z",
        },
      ],
    });

    expect(markup).not.toContain("Choose a channel to get started");
    expect(markup).toContain("Channels");
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

  it("renders the warning banner inline on the home page beneath the hero block", () => {
    const markup = renderHomePage({
      channels: [
        {
          id: "channel-1",
          channelType: "feishu",
          status: "connected",
        },
      ],
      liveStatus: {
        gatewayConnected: true,
        channels: [
          {
            channelType: "feishu",
            channelId: "channel-1",
            accountId: "acct-1",
            status: "connected",
            ready: true,
            connected: true,
            running: true,
            configured: true,
            lastError: null,
          },
        ],
        agent: {
          modelId: "link/gemini",
          modelName: "Gemini",
          alive: true,
        },
      },
      rewardsStatus: {
        viewer: {
          cloudConnected: true,
          activeModelId: "link/gemini",
          activeModelProviderId: "link",
          usingManagedModel: true,
        },
        progress: {
          claimedCount: 8,
          totalCount: rewardTasks.length,
          earnedCredits: 800,
          availableCredits: 200,
        },
        tasks: rewardTasks.map((task) => ({
          ...task,
          isClaimed: false,
          lastClaimedAt: null,
          claimCount: 0,
        })),
        cloudBalance: {
          totalBalance: 5,
          totalRecharged: 805,
          totalConsumed: 800,
        },
      },
    });

    expect(markup).toContain('data-budget-banner-status="warning"');
    expect(markup.indexOf("nexu alpha")).toBeLessThan(
      markup.indexOf('data-budget-banner-status="warning"'),
    );
    expect(markup).not.toContain('data-budget-dialog-status="depleted"');
  });

  it("renders the depleted banner inline on the home page beneath the hero block", () => {
    const markup = renderHomePage({
      channels: [
        {
          id: "channel-1",
          channelType: "feishu",
          status: "connected",
        },
      ],
      liveStatus: {
        gatewayConnected: true,
        channels: [
          {
            channelType: "feishu",
            channelId: "channel-1",
            accountId: "acct-1",
            status: "connected",
            ready: true,
            connected: true,
            running: true,
            configured: true,
            lastError: null,
          },
        ],
        agent: {
          modelId: "link/gemini",
          modelName: "Gemini",
          alive: true,
        },
      },
      rewardsStatus: {
        viewer: {
          cloudConnected: true,
          activeModelId: "link/gemini",
          activeModelProviderId: "link",
          usingManagedModel: true,
        },
        progress: {
          claimedCount: 8,
          totalCount: rewardTasks.length,
          earnedCredits: 800,
          availableCredits: 200,
        },
        tasks: rewardTasks.map((task) => ({
          ...task,
          isClaimed: false,
          lastClaimedAt: null,
          claimCount: 0,
        })),
        cloudBalance: {
          totalBalance: 0,
          totalRecharged: 800,
          totalConsumed: 800,
        },
      },
    });

    expect(markup).toContain('data-budget-banner-status="depleted"');
    expect(markup.indexOf("nexu alpha")).toBeLessThan(
      markup.indexOf('data-budget-banner-status="depleted"'),
    );
    expect(markup).not.toContain('data-budget-dialog-status="depleted"');
  });
});

describe("RewardsPage", () => {
  it("does not render the removed progress summary when rewards are loaded", () => {
    const markup = renderRewardsPage({
      progress: {
        claimedCount: 1,
        totalCount: 1,
        earnedCredits: 100,
      },
      tasks: [
        {
          ...rewardTasks[0],
          isClaimed: true,
          lastClaimedAt: "2026-04-08T00:00:00.000Z",
          claimCount: 1,
        },
      ],
    });

    expect(markup).not.toContain("1 / 1");
    expect(markup).not.toContain("+100 积分");
    expect(markup).toContain("reward.daily_checkin.name");
    expect(markup).not.toContain("reward.github_star.name");
  });

  it("renders the merged social rewards group including Facebook and WhatsApp", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain("rewards.group.social");
    expect(markup).toContain("reward.facebook.name");
    expect(markup).toContain("reward.whatsapp.name");
  });

  it("renders svg-based reward icons for branded social tasks instead of letter placeholders", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain('data-reward-task-icon="reddit"');
    expect(markup).toContain('data-reward-task-icon="lingying"');
    expect(markup).not.toContain(">R<");
    expect(markup).not.toContain(">J<");
  });

  it("renders the source reward rules link in the header", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain("budget.viral.rules");
    expect(markup).toContain("https://docs.nexu.io/guide/rewards");
  });

  it("uses the积分 copy and hides the redundant cloud balance summary card", () => {
    const markup = renderRewardsPage();

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
    const markup = renderRewardsPage();

    expect(markup).toContain("max-w-4xl");
    expect(markup).not.toContain("max-w-[520px]");
    expect(markup).not.toContain("rewards.badge");
    expect(markup).not.toContain("rewards.refresh");
  });

  it("keeps the switch-back hint when using BYOK with a positive balance", () => {
    const markup = renderRewardsPage({
      viewer: {
        cloudConnected: true,
        activeModelId: "openai/gpt-4.1",
        activeModelProviderId: "openai",
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
      cloudBalance: {
        totalBalance: 120,
        totalRecharged: 500,
        totalConsumed: 380,
      },
    });

    expect(markup).toContain("rewards.modelHintTitle");
    expect(markup).toContain("rewards.modelHintBody");
    expect(markup).toContain("rewards.modelHintCta");
  });

  it("does not show the switch-back hint when using BYOK with zero balance", () => {
    const markup = renderRewardsPage({
      viewer: {
        cloudConnected: true,
        activeModelId: "openai/gpt-4.1",
        activeModelProviderId: "openai",
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
      cloudBalance: {
        totalBalance: 0,
        totalRecharged: 500,
        totalConsumed: 500,
      },
    });

    expect(markup).not.toContain("rewards.modelHintTitle");
    expect(markup).not.toContain("rewards.modelHintBody");
    expect(markup).not.toContain("rewards.modelHintCta");
  });
});

describe("Rewards locale parity", () => {
  it("uses 可用积分 instead of 套餐额度 in budget banner headlines", () => {
    expect(zhCN["budget.banner.warningHeadline"]).toBe(
      "可用积分即将耗尽，可采取以下方式避免任务中断",
    );
    expect(zhCN["budget.banner.depletedHeadline"]).toBe(
      "可用积分已用尽（明天重置），可采取以下方式继续使用",
    );
  });

  it("keeps the source Chinese rewards copy for the header and task labels", () => {
    expect(zhCN["rewards.title"]).toBe("分享 nexu，获取额外积分");
    expect(zhCN["rewards.desc"]).toBe(
      "把 nexu 分享给你的社区，完成任务获取额外积分。",
    );
    expect(zhCN["reward.github_star.name"]).toBe("Star us");
    expect(zhCN["reward.reddit.name"]).toBe("发帖到 Reddit");
    expect(zhCN["reward.mobile_share.name"]).toBe("从手机邀请");
    expect(zhCN["reward.lingying.name"]).toBe("发帖到领英");
  });
});
