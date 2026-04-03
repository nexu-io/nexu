import {
  type DesktopRewardClaimProof,
  rewardGroupSchema,
  rewardRepeatModeSchema,
  rewardShareModeSchema,
  rewardTaskIdSchema,
} from "@nexu/shared";
import { z } from "zod";
import { proxyFetch } from "../lib/proxy-fetch.js";

type CloudRewardServiceOptions = {
  cloudUrl: string;
  apiKey: string;
};

const cloudRewardTaskSchema = z.object({
  id: rewardTaskIdSchema,
  displayName: z.string(),
  groupId: rewardGroupSchema,
  rewardPoints: z.number(),
  repeatMode: rewardRepeatModeSchema,
  shareMode: rewardShareModeSchema,
  icon: z.string().nullable(),
  url: z.string().nullable(),
  isClaimed: z.boolean(),
  claimCount: z.number(),
  lastClaimedAt: z.string().nullable(),
});

const cloudRewardProgressSchema = z.object({
  claimedCount: z.number(),
  totalCount: z.number(),
  earnedCredits: z.number(),
  availableCredits: z.number().optional(),
});

const cloudBalanceSchema = z
  .object({
    totalBalance: z.number(),
    totalRecharged: z.number(),
    totalConsumed: z.number(),
    syncedAt: z.string(),
    updatedAt: z.string(),
  })
  .nullable();

const rewardStatusResponseSchema = z.object({
  tasks: z.array(cloudRewardTaskSchema),
  progress: cloudRewardProgressSchema,
  cloudBalance: cloudBalanceSchema,
});

const rewardClaimResponseSchema = z.object({
  ok: z.boolean(),
  alreadyClaimed: z.boolean(),
  status: rewardStatusResponseSchema,
});

export type RewardStatusResponse = z.infer<typeof rewardStatusResponseSchema>;
export type RewardClaimResponse = z.infer<typeof rewardClaimResponseSchema>;

export type CloudRewardErrorReason =
  | "auth_failed"
  | "network_error"
  | "parse_error";

export type CloudRewardResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: CloudRewardErrorReason };

export type CloudRewardService = {
  getRewardsStatus(): Promise<CloudRewardResult<RewardStatusResponse>>;
  claimReward(
    taskId: string,
    proof?: DesktopRewardClaimProof,
  ): Promise<CloudRewardResult<RewardClaimResponse>>;
};

export function createCloudRewardService(
  options: CloudRewardServiceOptions,
): CloudRewardService {
  const { cloudUrl, apiKey } = options;
  const baseUrl = cloudUrl.replace(/\/+$/, "");

  async function fetchWithAuth(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    return proxyFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
      timeoutMs: 10_000,
    });
  }

  return {
    async getRewardsStatus() {
      try {
        const res = await fetchWithAuth("/api/v1/rewards/status");
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: "auth_failed" };
        }
        if (!res.ok) {
          return { ok: false, reason: "network_error" };
        }
        const data: unknown = await res.json();
        const parsed = rewardStatusResponseSchema.safeParse(data);
        if (!parsed.success) {
          return { ok: false, reason: "parse_error" };
        }
        return { ok: true, data: parsed.data };
      } catch {
        return { ok: false, reason: "network_error" };
      }
    },

    async claimReward(taskId, proof) {
      try {
        const res = await fetchWithAuth("/api/v1/rewards/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId,
            proofUrl: proof?.url?.trim() || undefined,
          }),
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: "auth_failed" };
        }
        if (!res.ok) {
          return { ok: false, reason: "network_error" };
        }
        const data: unknown = await res.json();
        const parsed = rewardClaimResponseSchema.safeParse(data);
        if (!parsed.success) {
          return { ok: false, reason: "parse_error" };
        }
        return { ok: true, data: parsed.data };
      } catch {
        return { ok: false, reason: "network_error" };
      }
    },
  };
}
