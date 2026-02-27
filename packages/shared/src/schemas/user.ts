import { z } from "zod";

export const userProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  plan: z.string(),
  inviteAccepted: z.boolean(),
});

export type UserProfileResponse = z.infer<typeof userProfileResponseSchema>;
