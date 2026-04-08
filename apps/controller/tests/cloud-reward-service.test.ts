import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudRewardService } from "../src/services/cloud-reward-service.js";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "uuid-123"),
}));

const CLOUD_URL = "https://nexu.io";
const API_KEY = "test-api-key";

const mockRewardStatusResponse = {
  tasks: [
    {
      id: "daily_checkin",
      displayName: "Daily Check-in",
      groupId: "daily",
      rewardPoints: 100,
      repeatMode: "daily",
      shareMode: "link",
      icon: "calendar",
      url: null,
      isClaimed: false,
      claimCount: 0,
      lastClaimedAt: null,
    },
  ],
  progress: {
    claimedCount: 0,
    totalCount: 1,
    earnedCredits: 0,
  },
  cloudBalance: {
    totalBalance: 500,
    totalRecharged: 600,
    totalConsumed: 100,
    syncedAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  },
};

const mockClaimResponse = {
  ok: true,
  alreadyClaimed: false,
  status: mockRewardStatusResponse,
};

describe("createCloudRewardService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("getRewardsStatus", () => {
    it("returns ok:true with parsed status on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(mockRewardStatusResponse), {
              status: 200,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.tasks).toHaveLength(1);
      expect(result.data.tasks[0]?.id).toBe("daily_checkin");
      expect(result.data.cloudBalance?.totalBalance).toBe(500);
    });

    it("returns ok:false reason:auth_failed on 401", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: "Unauthorized" }), {
              status: 401,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("auth_failed");
    });

    it("returns ok:false reason:auth_failed on 403", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("auth_failed");
    });

    it("returns ok:false reason:network_error on other non-2xx status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: "Server Error" }), {
              status: 500,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("network_error");
    });

    it("returns ok:false reason:network_error on network error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Network error");
        }),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("network_error");
    });

    it("returns ok:false reason:parse_error when response body does not match schema", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ unexpected: "shape" }), {
              status: 200,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("parse_error");
    });

    it("keeps parsing rewards status when cloud returns unknown task ids", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                ...mockRewardStatusResponse,
                tasks: [
                  {
                    ...mockRewardStatusResponse.tasks[0],
                    id: "new_reward",
                  },
                ],
              }),
              {
                status: 200,
              },
            ),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.getRewardsStatus();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.tasks[0]?.id).toBe("new_reward");
      expect(result.data.cloudBalance?.totalBalance).toBe(500);
    });

    it("strips trailing slash from cloudUrl", async () => {
      let calledUrl = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          calledUrl = String(url);
          return new Response(JSON.stringify(mockRewardStatusResponse), {
            status: 200,
          });
        }),
      );

      const service = createCloudRewardService({
        cloudUrl: "https://nexu.io///",
        apiKey: API_KEY,
      });
      await service.getRewardsStatus();

      expect(calledUrl).toBe("https://nexu.io/api/v1/rewards/status");
    });

    it("sends Authorization header", async () => {
      let capturedHeaders: Record<string, string> = {};
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          capturedHeaders = Object.fromEntries(
            new Headers(init?.headers as HeadersInit).entries(),
          );
          return new Response(JSON.stringify(mockRewardStatusResponse), {
            status: 200,
          });
        }),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: "my-secret-key",
      });
      await service.getRewardsStatus();

      expect(capturedHeaders.authorization).toBe("Bearer my-secret-key");
    });
  });

  describe("claimReward", () => {
    it("returns ok:true with claim result on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(mockClaimResponse), { status: 200 }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.ok).toBe(true);
      expect(result.data.alreadyClaimed).toBe(false);
    });

    it("returns ok:true with alreadyClaimed:true when cloud indicates task was already claimed", async () => {
      const alreadyClaimedResponse = {
        ok: true,
        alreadyClaimed: true,
        status: mockRewardStatusResponse,
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(alreadyClaimedResponse), {
              status: 200,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.alreadyClaimed).toBe(true);
    });

    it("returns ok:true with data.ok:false when cloud returns ok:false", async () => {
      const failedClaimResponse = {
        ok: false,
        alreadyClaimed: false,
        status: mockRewardStatusResponse,
      };

      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(failedClaimResponse), { status: 200 }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.ok).toBe(false);
    });

    it("returns ok:false reason:network_error on network failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Network failure");
        }),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("network_error");
    });

    it("returns ok:false reason:auth_failed on 401", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: "Unauthorized" }), {
              status: 401,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("auth_failed");
    });

    it("returns ok:false reason:auth_failed on 403", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("auth_failed");
    });

    it("returns ok:false reason:network_error on other non-2xx status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: "Server Error" }), {
              status: 500,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.claimReward("daily_checkin");

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("network_error");
    });

    it("sends POST with JSON body containing taskId", async () => {
      let capturedBody = "";
      let capturedMethod = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          capturedMethod = init?.method ?? "";
          capturedBody = init?.body as string;
          return new Response(JSON.stringify(mockClaimResponse), {
            status: 200,
          });
        }),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      await service.claimReward("daily_checkin");

      expect(capturedMethod).toBe("POST");
      expect(JSON.parse(capturedBody)).toEqual({ taskId: "daily_checkin" });
    });
  });

  describe("setRewardBalance", () => {
    it("returns ok:true and posts the requested balance", async () => {
      let capturedUrl = "";
      let capturedBody = "";

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          capturedUrl = String(url);
          capturedBody = init?.body as string;
          return new Response(null, { status: 204 });
        }),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.setRewardBalance(4200);

      expect(result.ok).toBe(true);
      expect(capturedUrl).toBe(
        "https://nexu.io/api/v1/test/credits/set-balance",
      );
      expect(JSON.parse(capturedBody)).toEqual({
        targetBalance: 4200,
        idempotencyKey: "desktop-set-balance-uuid-123",
      });
    });

    it("returns ok:false reason:auth_failed on 401", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: "Unauthorized" }), {
              status: 401,
            }),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.setRewardBalance(1);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("auth_failed");
      expect(result.message).toBe("Unauthorized");
    });

    it("returns cloud 4xx message on other non-2xx statuses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                message:
                  "idempotencyKey is already bound to a different credit adjustment",
              }),
              {
                status: 409,
              },
            ),
        ),
      );

      const service = createCloudRewardService({
        cloudUrl: CLOUD_URL,
        apiKey: API_KEY,
      });
      const result = await service.setRewardBalance(1);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe("network_error");
      expect(result.message).toBe(
        "idempotencyKey is already bound to a different credit adjustment",
      );
    });
  });
});
