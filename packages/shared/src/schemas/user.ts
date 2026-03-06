import { z } from "zod";

export const userProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  plan: z.string(),
  inviteAccepted: z.boolean(),
  onboardingCompleted: z.boolean(),
});

export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;

export const userStatsResponseSchema = z.object({
  totalUsers: z.number(),
  todayNewUsers: z.number(),
  last7DaysNewUsers: z.number(),
  last30DaysNewUsers: z.number(),
  totalChannels: z.number(),
});

export type UserStatsResponse = z.infer<typeof userStatsResponseSchema>;
