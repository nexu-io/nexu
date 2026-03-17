import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();

vi.mock("#api/db/index.js", () => ({
  db: {
    select: selectMock,
  },
}));

describe("bot-helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    selectMock.mockReturnValue({
      from: fromMock,
    });
    fromMock.mockReturnValue({
      where: whereMock,
    });
  });

  it("prefers active pools over degraded pools", async () => {
    whereMock.mockResolvedValue([
      { id: "degraded-pool", status: "degraded", podIp: null },
      { id: "active-pool", status: "active", podIp: null },
    ]);

    const { findDefaultPool } = await import("#api/lib/bot-helpers.js");

    await expect(findDefaultPool()).resolves.toBe("active-pool");
  });

  it("falls back to degraded pool when no active pool exists", async () => {
    whereMock.mockResolvedValue([
      { id: "degraded-pool", status: "degraded", podIp: null },
    ]);

    const { findDefaultPool } = await import("#api/lib/bot-helpers.js");

    await expect(findDefaultPool()).resolves.toBe("degraded-pool");
  });

  it("prefers pools with a registered gateway within the same health tier", async () => {
    whereMock.mockResolvedValue([
      { id: "degraded-no-gateway", status: "degraded", podIp: null },
      { id: "degraded-with-gateway", status: "degraded", podIp: "127.0.0.1" },
    ]);

    const { findDefaultPool } = await import("#api/lib/bot-helpers.js");

    await expect(findDefaultPool()).resolves.toBe("degraded-with-gateway");
  });
});
