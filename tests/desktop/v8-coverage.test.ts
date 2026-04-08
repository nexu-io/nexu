import { beforeEach, describe, expect, it, vi } from "vitest";

const takeCoverageMock = vi.hoisted(() => vi.fn());

vi.mock("node:v8", () => ({
  takeCoverage: takeCoverageMock,
}));

describe("desktop v8 coverage flush", () => {
  beforeEach(() => {
    takeCoverageMock.mockReset();
  });

  it("calls takeCoverage when desktop E2E coverage is enabled", async () => {
    const { flushV8CoverageIfEnabled } = await import(
      "../../apps/desktop/main/services/v8-coverage"
    );

    flushV8CoverageIfEnabled({ NEXU_DESKTOP_E2E_COVERAGE: "1" });

    expect(takeCoverageMock).toHaveBeenCalledTimes(1);
  });

  it("does not call takeCoverage when desktop E2E coverage is disabled", async () => {
    const { flushV8CoverageIfEnabled } = await import(
      "../../apps/desktop/main/services/v8-coverage"
    );

    flushV8CoverageIfEnabled({ NEXU_DESKTOP_E2E_COVERAGE: "0" });

    expect(takeCoverageMock).not.toHaveBeenCalled();
  });
});
