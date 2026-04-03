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
      githubStarVerificationService: {
        prepareSession: vi.fn(),
        verifySession: vi.fn(),
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
      githubStarVerificationService: {
        prepareSession: vi.fn(),
        verifySession: vi.fn(),
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

  it("rejects GitHub star claims while the verification flow is disabled", async () => {
    const claimDesktopReward = vi.fn();
    const verifySession = vi.fn();
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus: vi.fn(),
        claimDesktopReward,
      },
      quotaFallbackService: {
        triggerFallback: vi.fn(),
      },
      githubStarVerificationService: {
        prepareSession: vi.fn(),
        verifySession,
      },
    } as never);

    const response = await app.request("/api/internal/desktop/rewards/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "github_star",
        proof: {
          githubSessionId: "github-session-1",
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "GitHub star reward is temporarily unavailable",
    });
    expect(verifySession).not.toHaveBeenCalled();
    expect(claimDesktopReward).not.toHaveBeenCalled();
  });

  it("rejects creating GitHub star verification sessions while the flow is disabled", async () => {
    const prepareSession = vi.fn();
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus: vi.fn(),
        claimDesktopReward: vi.fn(),
      },
      quotaFallbackService: {
        triggerFallback: vi.fn(),
      },
      githubStarVerificationService: {
        prepareSession,
        verifySession: vi.fn(),
      },
    } as never);

    const response = await app.request(
      "/api/internal/desktop/rewards/github-star-session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "GitHub star reward is temporarily unavailable",
    });
    expect(prepareSession).not.toHaveBeenCalled();
  });
});
