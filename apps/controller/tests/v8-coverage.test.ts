import { beforeEach, describe, expect, it, vi } from "vitest";

const takeCoverageMock = vi.hoisted(() => vi.fn());

vi.mock("node:v8", () => ({
  takeCoverage: takeCoverageMock,
}));

describe("controller v8 coverage flush", () => {
  beforeEach(() => {
    takeCoverageMock.mockReset();
  });

  it("calls takeCoverage when desktop E2E coverage is enabled", async () => {
    const { flushV8CoverageIfEnabled } = await import("../src/lib/v8-coverage");

    flushV8CoverageIfEnabled({ NEXU_DESKTOP_E2E_COVERAGE: "1" });

    expect(takeCoverageMock).toHaveBeenCalledTimes(1);
  });

  it("does not call takeCoverage outside desktop E2E coverage mode", async () => {
    const { flushV8CoverageIfEnabled } = await import("../src/lib/v8-coverage");

    flushV8CoverageIfEnabled({});

    expect(takeCoverageMock).not.toHaveBeenCalled();
  });
});
