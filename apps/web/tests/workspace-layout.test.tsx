import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "../src/layouts/workspace-layout";

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

vi.mock("../lib/api/sdk.gen", () => ({
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

const storage = new Map<string, string>();

function installBrowserStubs() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0",
    },
  });
}

function renderWorkspaceLayout(): string {
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

describe("WorkspaceLayout", () => {
  beforeEach(() => {
    storage.clear();
    storage.set("nexu_setup_complete", "1");
    installBrowserStubs();
  });

  it("renders structured sidebar session rows for the workspace shell", () => {
    const markup = renderWorkspaceLayout();

    expect(markup).toContain('data-sidebar-session-row="sess-1"');
    expect(markup).toContain('data-session-channel-type="slack"');
    expect(markup).toContain('data-session-state="active"');
    expect(markup).toContain("<title>Slack</title>");
    expect(markup).toContain("Design sync thread");
  });
});
