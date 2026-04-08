import { rewardTasks } from "@nexu/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import zhCN from "../src/i18n/locales/zh-CN";
import { RewardsPage } from "../src/pages/rewards";

vi.mock("@/lib/api", () => ({}));
vi.mock("@nexu/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexu/shared")>();
  return {
    ...actual,
    rewardTaskRequiresGithubStarSession: (taskId: string) =>
      taskId === "github_star",
    rewardTaskRequiresUrlProof: (taskId: string) =>
      ["x_share", "reddit", "lingying", "facebook", "whatsapp"].includes(
        taskId,
      ),
    validateRewardProofUrl: () => true,
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "zh-CN",
    },
  }),
}));
vi.mock("../src/lib/api", () => ({
  client: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

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
      cloudConnected: true,
      activeModelId: "link/gemini",
      activeModelProviderId: "link",
      usingManagedModel: true,
    },
    progress: {
      claimedCount: 0,
      totalCount: rewardTasks.length,
      earnedCredits: 0,
      availableCredits: rewardTasks.reduce((sum, task) => sum + task.reward, 0),
    },
    cloudBalance: {
      totalBalance: 100,
      totalRecharged: 100,
      totalConsumed: 0,
    },
    tasks: rewardTasks.map((task) => ({
      ...task,
      isClaimed: false,
      lastClaimedAt: null,
      claimCount: 0,
    })),
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RewardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RewardsPage daily check-in", () => {
  it("renders the daily check-in task as readonly completed UI", () => {
    const markup = renderRewardsPage();

    expect(markup).toContain("reward.daily_checkin.name");
    expect(markup).toContain("reward.daily_checkin.autoGrantedDesc");
    expect(markup).toContain("budget.cta.done");
    expect(markup).not.toContain("budget.cta.checkin");
    expect(markup).toContain("disabled");
  });

  it("defines the Chinese auto-grant subtitle copy", () => {
    expect(zhCN["reward.daily_checkin.autoGrantedDesc"]).toBe(
      "每日奖励自动发放，无需手动领取",
    );
  });
});
