import { z } from "zod";

export const channelTypeSchema = z.enum(["slack", "discord"]);

export const channelStatusSchema = z.enum([
  "pending",
  "connected",
  "disconnected",
  "error",
]);

export const connectSlackSchema = z.object({
  botToken: z.string().min(1),
  signingSecret: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string().optional(),
  appId: z.string().min(1),
});

export const connectDiscordSchema = z.object({
  botToken: z.string().min(1),
  appId: z.string().min(1),
  guildId: z.string().optional(),
  guildName: z.string().optional(),
});

export const channelResponseSchema = z.object({
  id: z.string(),
  botId: z.string(),
  channelType: channelTypeSchema,
  accountId: z.string(),
  status: channelStatusSchema,
  teamName: z.string().nullable(),
  appId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const channelListResponseSchema = z.object({
  channels: z.array(channelResponseSchema),
});

export const slackOAuthUrlResponseSchema = z.object({
  url: z.string(),
});

export type ChannelType = z.infer<typeof channelTypeSchema>;
export type ChannelStatus = z.infer<typeof channelStatusSchema>;
export type ConnectSlackInput = z.infer<typeof connectSlackSchema>;
export type ConnectDiscordInput = z.infer<typeof connectDiscordSchema>;
export type ChannelResponse = z.infer<typeof channelResponseSchema>;
export type SlackOAuthUrlResponse = z.infer<typeof slackOAuthUrlResponseSchema>;
