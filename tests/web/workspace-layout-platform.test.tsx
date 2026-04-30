import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockedDesktopPlatform: string | null = null;

vi.mock("@/lib/api", () => ({}));
vi.mock("@/lib/tracking", () => ({ track: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  useCommunitySkills: () => ({ data: { installedSkills: [] } }),
}));
vi.mock("@/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { email: "alice@example.com", name: "Alice" } },
    }),
    signOut: vi.fn(),
  },
}));
vi.mock("@/lib/desktop-platform", () => ({
  isWindowsDesktopPlatform: () => mockedDesktopPlatform === "win32",
  isMacDesktopPlatform: () => mockedDesktopPlatform === "darwin",
}));
vi.mock("../../apps/web/lib/api/sdk.gen", () => ({
  getApiV1Sessions: vi.fn(async () => ({ data: { sessions: [] } })),
  getApiV1Me: vi.fn(async () => ({
    data: { email: "alice@example.com", name: "Alice" },
  })),
}));

import { WorkspaceLayout } from "../../apps/web/src/layouts/workspace-layout";

const storage = new Map<string, string>();

function installBrowserStubs(userAgent = "Mozilla/5.0") {
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
    value: { userAgent },
  });
}

function renderWorkspaceLayout(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["sidebar-sessions"], []);
  queryClient.setQueryData(["me"], {
    email: "alice@example.com",
    name: "Alice",
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workspace/home"]}>
        <Routes>
          <Route element={<WorkspaceLayout />}>
            <Route path="/workspace/home" element={<div>Home body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspaceLayout desktop platform variants", () => {
  beforeEach(() => {
    storage.clear();
    storage.set("nexu_setup_complete", "1");
    mockedDesktopPlatform = null;
    installBrowserStubs();
  });

  it("adds mac desktop header offsets to clear the traffic lights", () => {
    mockedDesktopPlatform = "darwin";
    installBrowserStubs("Mozilla/5.0 Electron");

    const markup = renderWorkspaceLayout();

    expect(markup).toContain(
      "flex items-center justify-between px-3 shrink-0 -mt-14 h-14 pl-[76px] pt-[10px] pr-3 pb-0",
    );
    expect(markup).toContain('title="layout.collapseSidebar"');
  });

  it("keeps the windows desktop header layout separate from the mac offset", () => {
    mockedDesktopPlatform = "win32";
    installBrowserStubs("Mozilla/5.0 Electron");

    const markup = renderWorkspaceLayout();

    expect(markup).toContain("fixed px-2 z-50");
    expect(markup).not.toContain("top-[10px] left-[76px]");
    expect(markup).not.toContain("-mt-14 h-14 pl-[76px] pt-[10px] pr-3 pb-0");
  });
});
