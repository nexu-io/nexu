import { rewardTasks } from "@nexu/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "#web/pages/home";

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

class StorageMock implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function renderHomePage(rewardsStatus: {
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
    availableCredits: number;
  };
  cloudBalance: {
    totalBalance: number;
    totalRecharged: number;
    totalConsumed: number;
  } | null;
}) {
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
    channels: [],
  });
  queryClient.setQueryData(["sessions"], {
    sessions: [],
  });
  queryClient.setQueryData(["desktop-rewards"], {
    ...rewardsStatus,
    tasks: rewardTasks.map((task) => ({
      ...task,
      isClaimed: false,
      lastClaimedAt: null,
      claimCount: 0,
    })),
  });

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, null, createElement(HomePage)),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("budget banner dismissal persistence", () => {
  const currentDismissStorageKey = "nexu_budget_banner_dismissed_v2";

  it("does not let a stale localStorage dismissal hide the warning banner", () => {
    const sessionStorage = new StorageMock();
    const localStorage = new StorageMock();
    localStorage.setItem(
      "nexu_budget_banner_dismissed",
      JSON.stringify({ date: new Date().toDateString() }),
    );

    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("localStorage", localStorage);

    const markup = renderHomePage({
      viewer: {
        cloudConnected: true,
        activeModelId: "link/gemini",
        activeModelProviderId: "link",
        usingManagedModel: true,
      },
      progress: {
        claimedCount: 6,
        totalCount: rewardTasks.length,
        earnedCredits: 1200,
        availableCredits: 0,
      },
      cloudBalance: {
        totalBalance: 5,
        totalRecharged: 1200,
        totalConsumed: 0,
      },
    });

    expect(markup).toContain('data-budget-banner-status="warning"');
  });

  it("does not let a stale v1 session dismissal hide the depleted banner", () => {
    const sessionStorage = new StorageMock();
    const localStorage = new StorageMock();
    sessionStorage.setItem("nexu_budget_banner_dismissed", "depleted");

    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("localStorage", localStorage);

    const markup = renderHomePage({
      viewer: {
        cloudConnected: true,
        activeModelId: "link/gemini",
        activeModelProviderId: "link",
        usingManagedModel: true,
      },
      progress: {
        claimedCount: 6,
        totalCount: rewardTasks.length,
        earnedCredits: 1200,
        availableCredits: 0,
      },
      cloudBalance: {
        totalBalance: 0,
        totalRecharged: 1200,
        totalConsumed: 0,
      },
    });

    expect(markup).toContain('data-budget-banner-status="depleted"');
    expect(markup).not.toContain('data-budget-dialog-status="depleted"');
  });

  it("only hides the banner for the same status in the current session", () => {
    const sessionStorage = new StorageMock();
    const localStorage = new StorageMock();
    sessionStorage.setItem(currentDismissStorageKey, "warning");

    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("localStorage", localStorage);

    const warningMarkup = renderHomePage({
      viewer: {
        cloudConnected: true,
        activeModelId: "link/gemini",
        activeModelProviderId: "link",
        usingManagedModel: true,
      },
      progress: {
        claimedCount: 6,
        totalCount: rewardTasks.length,
        earnedCredits: 1200,
        availableCredits: 0,
      },
      cloudBalance: {
        totalBalance: 5,
        totalRecharged: 1200,
        totalConsumed: 0,
      },
    });
    const depletedMarkup = renderHomePage({
      viewer: {
        cloudConnected: true,
        activeModelId: "link/gemini",
        activeModelProviderId: "link",
        usingManagedModel: true,
      },
      progress: {
        claimedCount: 6,
        totalCount: rewardTasks.length,
        earnedCredits: 1200,
        availableCredits: 0,
      },
      cloudBalance: {
        totalBalance: 0,
        totalRecharged: 1200,
        totalConsumed: 0,
      },
    });

    expect(warningMarkup).not.toContain('data-budget-banner-status="warning"');
    expect(depletedMarkup).toContain('data-budget-banner-status="depleted"');
    expect(depletedMarkup).not.toContain(
      'data-budget-dialog-status="depleted"',
    );
  });
});
