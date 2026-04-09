import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { registerDesktopRewardsRoutes } from "../src/routes/desktop-rewards-routes.js";
import type { ControllerBindings } from "../src/types.js";

describe("registerDesktopRewardsRoutes", () => {
  it("returns depleted managed status without auto-falling back on read", async () => {
    const getDesktopRewardsStatus = vi.fn().mockResolvedValue({
      viewer: {
        cloudConnected: true,
        activeModelId: "link/gemini-2.5-flash",
        activeModelProviderId: "link",
        usingManagedModel: true,
      },
      progress: {
        claimedCount: 4,
        totalCount: 11,
        earnedCredits: 900,
        availableCredits: 100,
      },
      tasks: [],
      cloudBalance: {
        totalBalance: 0,
        totalRecharged: 900,
        totalConsumed: 900,
      },
    });
    const triggerFallback = vi.fn();

    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus,
        claimDesktopReward: vi.fn(),
      },
      quotaFallbackService: {
        triggerFallback,
      },
    } as never);

    const response = await app.request("/api/internal/desktop/rewards");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      viewer: { activeModelId: string | null; usingManagedModel: boolean };
    };

    expect(triggerFallback).not.toHaveBeenCalled();
    expect(getDesktopRewardsStatus).toHaveBeenCalledTimes(1);
    expect(payload.viewer.activeModelId).toBe("link/gemini-2.5-flash");
    expect(payload.viewer.usingManagedModel).toBe(true);
  });

  it("forwards desktop test balance updates to the config store", async () => {
    const setDesktopRewardBalance = vi.fn().mockResolvedValue({
      viewer: {
        cloudConnected: true,
        activeModelId: null,
        activeModelProviderId: null,
        usingManagedModel: false,
      },
      progress: {
        claimedCount: 0,
        totalCount: 0,
        earnedCredits: 0,
      },
      tasks: [],
      cloudBalance: {
        totalBalance: 1337,
        totalRecharged: 1337,
        totalConsumed: 0,
      },
    });

    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus: vi.fn(),
        claimDesktopReward: vi.fn(),
        setDesktopRewardBalance,
      },
      quotaFallbackService: {
        triggerFallback: vi.fn(),
      },
    } as never);

    const response = await app.request(
      "/api/internal/desktop/rewards/set-balance",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balance: 1337 }),
      },
    );

    expect(response.status).toBe(200);
    expect(setDesktopRewardBalance).toHaveBeenCalledOnce();
    expect(setDesktopRewardBalance).toHaveBeenCalledWith(1337);
    await expect(response.json()).resolves.toMatchObject({
      cloudBalance: { totalBalance: 1337 },
    });
  });

  it("returns the config store error message for failed balance updates", async () => {
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus: vi.fn(),
        claimDesktopReward: vi.fn(),
        setDesktopRewardBalance: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "idempotencyKey is already bound to a different credit adjustment",
            ),
          ),
      },
      quotaFallbackService: {
        triggerFallback: vi.fn(),
      },
    } as never);

    const response = await app.request(
      "/api/internal/desktop/rewards/set-balance",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balance: 1337 }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message:
        "idempotencyKey is already bound to a different credit adjustment",
    });
  });

  it("rejects invalid proof URLs before forwarding the claim", async () => {
    const claimDesktopReward = vi.fn();
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus: vi.fn(),
        claimDesktopReward,
      },
      quotaFallbackService: {
        triggerFallback: vi.fn(),
      },
    } as never);

    const response = await app.request("/api/internal/desktop/rewards/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "x_share",
        proof: {
          url: "https://www.reddit.com/r/test/comments/abc123/example-post/",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(claimDesktopReward).not.toHaveBeenCalled();
  });

  it("forwards GitHub star claims directly without verification", async () => {
    const claimDesktopReward = vi.fn().mockResolvedValue({ ok: true });
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus: vi.fn(),
        claimDesktopReward,
      },
      quotaFallbackService: {
        triggerFallback: vi.fn(),
      },
    } as never);

    const response = await app.request("/api/internal/desktop/rewards/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "github_star",
      }),
    });

    expect(response.status).toBe(200);
    expect(claimDesktopReward).toHaveBeenCalledWith("github_star", undefined);
  });
});
