import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BudgetWarningBanner } from "../src/components/budget-warning-banner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("BudgetWarningBanner", () => {
  it("renders warning copy with earn credits and BYOK actions only", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <BudgetWarningBanner status="warning" onDismiss={vi.fn()} />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-budget-banner-status="warning"');
    expect(markup).toContain("budget.banner.warningHeadline");
    expect(markup).toContain("budget.banner.earnCredits");
    expect(markup).toContain("budget.banner.byok");
    expect(markup).not.toContain("budget.banner.depletedHeadline");
  });

  it("renders depleted copy separately from warning state", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <BudgetWarningBanner status="depleted" onDismiss={vi.fn()} />
      </MemoryRouter>,
    );

    expect(markup).toContain('data-budget-banner-status="depleted"');
    expect(markup).toContain("budget.banner.depletedHeadline");
    expect(markup).toContain("budget.banner.earnCredits");
    expect(markup).toContain("budget.banner.byok");
    expect(markup).not.toContain("budget.banner.warningHeadline");
  });
});
