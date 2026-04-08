import { z } from "zod";

export const creditSourceTypeSchema = z.enum([
  "signup_bonus",
  "daily_bonus",
  "github_star",
  "social_share",
  "test",
]);

export type CreditSourceType = z.infer<typeof creditSourceTypeSchema>;

export const creditUsageSummarySchema = z.object({
  totalEntries: z.number().int().nonnegative(),
  totalDueCredits: z.number().int().nonnegative(),
  totalChargedCredits: z.number().int().nonnegative(),
  totalCostUsd: z.string(),
});

export type CreditUsageSummary = z.infer<typeof creditUsageSummarySchema>;

export const creditBalanceSummarySchema = z.object({
  totalBalance: z.number().int().nonnegative(),
  totalRecharged: z.number().int().nonnegative(),
  totalConsumed: z.number().int().nonnegative(),
  syncedAt: z.string(),
  updatedAt: z.string(),
});

export type CreditBalanceSummary = z.infer<typeof creditBalanceSummarySchema>;

export const creditSummaryResponseSchema = z.object({
  appUserId: z.string(),
  balance: creditBalanceSummarySchema,
  usageSummary: creditUsageSummarySchema,
});

export type CreditSummaryResponse = z.infer<typeof creditSummaryResponseSchema>;

export const creditRechargeRecordSchema = z.object({
  id: z.string(),
  appUserId: z.string(),
  amount: z.number().int().nonnegative(),
  balance: z.number().int().nonnegative(),
  source: creditSourceTypeSchema,
  sourceId: z.string().nullable(),
  description: z.string().nullable(),
  expiresAt: z.string(),
  enabled: z.boolean(),
  idempotencyKey: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreditRechargeRecord = z.infer<typeof creditRechargeRecordSchema>;

export const creditRecordsResponseSchema = z.object({
  appUserId: z.string(),
  grants: z.array(creditRechargeRecordSchema),
  usageSummary: creditUsageSummarySchema,
});

export type CreditRecordsResponse = z.infer<typeof creditRecordsResponseSchema>;
