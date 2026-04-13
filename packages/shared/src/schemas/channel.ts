import { z } from "zod";

export const channelTypeSchema = z.enum([
  "slack",
  "discord",
  "feishu",
  "dingtalk",
  "wecom",
  "wechat",
  "telegram",
  "whatsapp",
  "qqbot",
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

export const connectWecomSchema = z.object({
  botId: z.string().min(1),
  secret: z.string().min(1),
});

export const connectDingtalkSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

export const connectWechatSchema = z.object({
  accountId: z.string().min(1),
});

export const connectTelegramSchema = z.object({
  botToken: z.string().min(1),
});

export const connectWhatsappSchema = z.object({
  accountId: z.string().min(1),
});

export const connectQqbotSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
});

export const channelConnectErrorCodeSchema = z.enum([
  "already_connected",
  "app_id_mismatch",
  "invalid_credentials",
  "network_error",
  "proxy_error",
  "sync_failed",
  "timeout",
  "upstream_http_error",
]);

export const channelConnectPhaseSchema = z.enum([
  "verify_credentials",
  "verify_app",
  "persist_config",
  "sync_runtime",
]);

export const channelConnectErrorSchema = z.object({
  message: z.string(),
  code: channelConnectErrorCodeSchema,
  requestId: z.string(),
  retryable: z.boolean(),
  phase: channelConnectPhaseSchema,
});

export const qqbotConnectivityResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const wecomConnectivityResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const dingtalkConnectivityResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const whatsappQrWaitRequestSchema = z.object({
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

export const whatsappQrStartResponseSchema = z.object({
  qrDataUrl: z.string().optional(),
  message: z.string(),
  accountId: z.string(),
  alreadyLinked: z.boolean().default(false),
});

export const whatsappQrWaitResponseSchema = z.object({
  connected: z.boolean(),
  message: z.string(),
  accountId: z.string(),
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
export type ConnectWecomInput = z.infer<typeof connectWecomSchema>;
export type ConnectDingtalkInput = z.infer<typeof connectDingtalkSchema>;
export type ConnectWechatInput = z.infer<typeof connectWechatSchema>;
export type ConnectTelegramInput = z.infer<typeof connectTelegramSchema>;
export type ConnectWhatsappInput = z.infer<typeof connectWhatsappSchema>;
export type ConnectQqbotInput = z.infer<typeof connectQqbotSchema>;
export type ChannelConnectErrorCode = z.infer<
  typeof channelConnectErrorCodeSchema
>;
export type ChannelConnectPhase = z.infer<typeof channelConnectPhaseSchema>;
export type ChannelConnectError = z.infer<typeof channelConnectErrorSchema>;
export type WecomConnectivityResponse = z.infer<
  typeof wecomConnectivityResponseSchema
>;
export type DingtalkConnectivityResponse = z.infer<
  typeof dingtalkConnectivityResponseSchema
>;
export type QqbotConnectivityResponse = z.infer<
  typeof qqbotConnectivityResponseSchema
>;
export type WhatsappQrWaitRequest = z.infer<typeof whatsappQrWaitRequestSchema>;
export type WechatQrStartResponse = z.infer<typeof wechatQrStartResponseSchema>;
export type WechatQrWaitResponse = z.infer<typeof wechatQrWaitResponseSchema>;
export type WhatsappQrStartResponse = z.infer<
  typeof whatsappQrStartResponseSchema
>;
export type WhatsappQrWaitResponse = z.infer<
  typeof whatsappQrWaitResponseSchema
>;
export type ChannelResponse = z.infer<typeof channelResponseSchema>;
export type SlackOAuthUrlResponse = z.infer<typeof slackOAuthUrlResponseSchema>;

export const botQuotaResponseSchema = z.object({
  available: z.boolean(),
  resetsAt: z.string(),
  usingByok: z.boolean().optional(),
  byokAvailable: z.boolean().optional(),
  autoFallbackTriggered: z.boolean().optional(),
});

export type BotQuotaResponse = z.infer<typeof botQuotaResponseSchema>;

export const quotaFallbackResponseSchema = z.object({
  ok: z.boolean(),
  newModelId: z.string().optional(),
});

export const restoreManagedBodySchema = z.object({
  managedModelId: z.string().min(1),
});

export type QuotaFallbackResponse = z.infer<typeof quotaFallbackResponseSchema>;
export type RestoreManagedBody = z.infer<typeof restoreManagedBodySchema>;
