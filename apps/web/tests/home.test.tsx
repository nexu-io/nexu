import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "../src/pages/home";

vi.mock("@/lib/api", () => ({}));

vi.mock("../lib/api/sdk.gen", () => ({
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
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
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
