import { rewardTasks } from "@nexu/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "#web/layouts/workspace-layout";

vi.mock("@/lib/api", () => ({}));
vi.mock("@/lib/tracking", () => ({
  track: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-auto-update", () => ({
  useAutoUpdate: () => ({
    phase: "idle",
    percent: 0,
    version: null,
    download: vi.fn(),
    install: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-community-catalog", () => ({
  useCommunitySkills: () => ({
    data: {
      installedSkills: [],
    },
  }),
}));

vi.mock("@/hooks/use-locale", () => ({
  useLocale: () => ({
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          email: "alice@example.com",
          name: "Alice",
        },
      },
    }),
    signOut: vi.fn(),
  },
}));

vi.mock("@web-gen/api/sdk.gen", () => ({
  getApiV1Sessions: vi.fn(async () => ({
    data: {
      sessions: [],
    },
  })),
  getApiV1Me: vi.fn(async () => ({
    data: {
      email: "alice@example.com",
      name: "Alice",
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

function installBrowserStubs(localStorage: Storage) {
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0",
  });
}

function renderWorkspaceLayout(rewardsStatus: {
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

  queryClient.setQueryData(
    ["sidebar-sessions"],
    [
      {
        id: "sess-1",
        title: "Design sync thread",
        channelType: "slack",
        lastTime: "2026-03-20T08:57:00.000Z",
        status: "active",
      },
    ],
  );
  queryClient.setQueryData(["me"], {
    email: "alice@example.com",
    name: "Alice",
  });
  queryClient.setQueryData(["desktop-rewards"], {
    ...rewardsStatus,
    tasks: [],
  });
  queryClient.setQueryData(["desktop-cloud-status"], {
    connected: rewardsStatus.viewer.cloudConnected,
    cloudUrl: "http://localhost:5176",
    linkUrl: "http://localhost:8080",
    activeProfileName: "Local",
    profiles: [],
  });
  queryClient.setQueryData(["bot-quota"], {
    available: true,
    resetsAt: null,
    usingByok: false,
    byokAvailable: false,
    autoFallbackTriggered: false,
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace/sessions/sess-1"]}>
        <Routes>
          <Route element={<WorkspaceLayout />}>
            <Route
              path="/workspace/sessions/:id"
              element={<div>Session body</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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
    installBrowserStubs(localStorage);
    localStorage.setItem("nexu_setup_complete", "1");

    const markup = renderWorkspaceLayout({
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
    installBrowserStubs(localStorage);
    localStorage.setItem("nexu_setup_complete", "1");

    const markup = renderWorkspaceLayout({
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
    installBrowserStubs(localStorage);
    localStorage.setItem("nexu_setup_complete", "1");

    const warningMarkup = renderWorkspaceLayout({
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
    const depletedMarkup = renderWorkspaceLayout({
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
