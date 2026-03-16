import { z } from "zod";

export const userProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  plan: z.string(),
  inviteAccepted: z.boolean(),
  authSource: z.string().nullable().optional(),
});

export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;

export const updateAuthSourceSchema = z.object({
  source: z.enum(["email", "google", "slack_shared_claim", "IM", "Landing"]),
  detail: z.string().optional(),
});

export type UpdateAuthSourceRequest = z.infer<typeof updateAuthSourceSchema>;

export const updateAuthSourceResponseSchema = z.object({
  ok: z.boolean(),
});
