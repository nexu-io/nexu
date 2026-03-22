import { z } from "zod";

export const channelTypeSchema = z.enum([
  "slack",
  "discord",
  "feishu",
  "wechat",
]);

export const channelStatusSchema = z.enum([
  "pending",
  "connected",
  "disconnected",
  "error",
]);

export const connectSlackSchema = z.object({
  botToken: z.string().min(1),
  signingSecret: z.string().min(1),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
  appId: z.string().optional(),
});

export const connectDiscordSchema = z.object({
  botToken: z.string().min(1),
  appId: z.string().min(1),
  guildId: z.string().optional(),
  guildName: z.string().optional(),
});

export const connectFeishuSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  connectionMode: z.enum(["websocket", "webhook"]).optional(),
  verificationToken: z.string().optional(),
});

export const connectWechatSchema = z.object({
  accountId: z.string().min(1),
});

export const wechatQrStartResponseSchema = z.object({
  qrDataUrl: z.string().optional(),
  message: z.string(),
  sessionKey: z.string().optional(),
});

export const wechatQrWaitResponseSchema = z.object({
  connected: z.boolean(),
  message: z.string(),
  accountId: z.string().optional(),
});

export const channelResponseSchema = z.object({
  id: z.string(),
  botId: z.string(),
  channelType: channelTypeSchema,
  accountId: z.string(),
  status: channelStatusSchema,
  teamName: z.string().nullable(),
  appId: z.string().nullable().optional(),
  botUserId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const channelListResponseSchema = z.object({
  channels: z.array(channelResponseSchema),
});

export const slackOAuthUrlResponseSchema = z.object({
  url: z.string(),
  redirectUri: z.string(),
});

export type ChannelType = z.infer<typeof channelTypeSchema>;
export type ChannelStatus = z.infer<typeof channelStatusSchema>;
export type ConnectSlackInput = z.infer<typeof connectSlackSchema>;
export type ConnectDiscordInput = z.infer<typeof connectDiscordSchema>;
export type ConnectFeishuInput = z.infer<typeof connectFeishuSchema>;
export type ConnectWechatInput = z.infer<typeof connectWechatSchema>;
export type WechatQrStartResponse = z.infer<typeof wechatQrStartResponseSchema>;
export type WechatQrWaitResponse = z.infer<typeof wechatQrWaitResponseSchema>;
export type ChannelResponse = z.infer<typeof channelResponseSchema>;
export type SlackOAuthUrlResponse = z.infer<typeof slackOAuthUrlResponseSchema>;

export const botQuotaResponseSchema = z.object({
  available: z.boolean(),
  resetsAt: z.string(),
});

export type BotQuotaResponse = z.infer<typeof botQuotaResponseSchema>;
