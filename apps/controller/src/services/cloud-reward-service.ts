import { randomUUID } from "node:crypto";
import {
  type DesktopRewardClaimProof,
  creditRecordsResponseSchema,
  rewardRepeatModeSchema,
  rewardShareModeSchema,
} from "@nexu/shared";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";

type CloudRewardServiceOptions = {
  cloudUrl: string;
  apiKey: string;
};

const cloudRewardTaskSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  groupId: z.string(),
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

const cloudErrorResponseSchema = z.object({
  message: z.string(),
});

export type RewardStatusResponse = z.infer<typeof rewardStatusResponseSchema>;
export type RewardClaimResponse = z.infer<typeof rewardClaimResponseSchema>;
export type CreditRecordsResponse = z.infer<typeof creditRecordsResponseSchema>;

export type CloudRewardErrorReason =
  | "auth_failed"
  | "network_error"
  | "parse_error";

export type CloudRewardResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: CloudRewardErrorReason; message?: string };

export type CloudRewardService = {
  getRewardsStatus(): Promise<CloudRewardResult<RewardStatusResponse>>;
  getCreditRecords(): Promise<CloudRewardResult<CreditRecordsResponse>>;
  claimReward(
    taskId: string,
    proof?: DesktopRewardClaimProof,
  ): Promise<CloudRewardResult<RewardClaimResponse>>;
  setRewardBalance(balance: number): Promise<CloudRewardResult<{ ok: true }>>;
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

  async function readCloudErrorMessage(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const data: unknown = await response.json();
      const parsed = cloudErrorResponseSchema.safeParse(data);
      if (parsed.success) {
        return parsed.data.message;
      }
    } catch {}

    return undefined;
  }

  return {
    async getRewardsStatus() {
      try {
        const res = await fetchWithAuth("/api/v1/rewards/status");
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            reason: "auth_failed",
            message: await readCloudErrorMessage(res),
          };
        }
        if (!res.ok) {
          logger.warn(
            { status: res.status, url: `${cloudUrl}/api/v1/rewards/status` },
            "cloud_rewards_status_http_error",
          );
          return { ok: false, reason: "network_error" };
        }
        const data: unknown = await res.json();
        const parsed = rewardStatusResponseSchema.safeParse(data);
        if (!parsed.success) {
          logger.warn(
            {
              issues: parsed.error.issues.slice(0, 5),
              url: `${cloudUrl}/api/v1/rewards/status`,
            },
            "cloud_rewards_status_parse_error",
          );
          return { ok: false, reason: "parse_error" };
        }
        return { ok: true, data: parsed.data };
      } catch (error: unknown) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            url: `${cloudUrl}/api/v1/rewards/status`,
          },
          "cloud_rewards_status_network_error",
        );
        return { ok: false, reason: "network_error" };
      }
    },

    async getCreditRecords() {
      try {
        const res = await fetchWithAuth("/api/v1/credits/records");
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            reason: "auth_failed",
            message: await readCloudErrorMessage(res),
          };
        }
        if (!res.ok) {
          logger.warn(
            { status: res.status, url: `${cloudUrl}/api/v1/credits/records` },
            "cloud_credit_records_http_error",
          );
          return { ok: false, reason: "network_error" };
        }
        const data: unknown = await res.json();
        const parsed = creditRecordsResponseSchema.safeParse(data);
        if (!parsed.success) {
          logger.warn(
            {
              issues: parsed.error.issues.slice(0, 5),
              url: `${cloudUrl}/api/v1/credits/records`,
            },
            "cloud_credit_records_parse_error",
          );
          return { ok: false, reason: "parse_error" };
        }
        return { ok: true, data: parsed.data };
      } catch (error: unknown) {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
            url: `${cloudUrl}/api/v1/credits/records`,
          },
          "cloud_credit_records_network_error",
        );
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
          return {
            ok: false,
            reason: "auth_failed",
            message: await readCloudErrorMessage(res),
          };
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

    async setRewardBalance(balance) {
      try {
        const res = await fetchWithAuth("/api/v1/test/credits/set-balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetBalance: balance,
            idempotencyKey: `desktop-set-balance-${randomUUID()}`,
          }),
        });

        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            reason: "auth_failed",
            message: await readCloudErrorMessage(res),
          };
        }

        if (!res.ok) {
          return {
            ok: false,
            reason: "network_error",
            message: await readCloudErrorMessage(res),
          };
        }

        return { ok: true, data: { ok: true } };
      } catch {
        return { ok: false, reason: "network_error" };
      }
    },
  };
}
