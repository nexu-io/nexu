import { z } from "zod";

export const rewardGroupSchema = z.enum(["daily", "opensource", "social"]);
export const rewardShareModeSchema = z.enum(["link", "tweet", "image"]);
export const rewardRepeatModeSchema = z.enum(["once", "daily", "weekly"]);
export const rewardTaskIdSchema = z.enum([
  "daily_checkin",
  "github_star",
  "x_share",
  "reddit",
  "xiaohongshu",
  "lingying",
  "jike",
  "wechat",
  "feishu",
  "facebook",
  "whatsapp",
]);

export const rewardTaskSchema = z.object({
  id: rewardTaskIdSchema,
  group: rewardGroupSchema,
  icon: z.string(),
  reward: z.number().positive(),
  shareMode: rewardShareModeSchema,
  repeatMode: rewardRepeatModeSchema,
  requiresScreenshot: z.boolean(),
  actionUrl: z.string().url().nullable().default(null),
});

export type RewardTask = z.infer<typeof rewardTaskSchema>;
export type RewardTaskId = z.infer<typeof rewardTaskIdSchema>;

const GITHUB_URL = "https://github.com/nexu-io/nexu";
const X_SHARE_URL = `https://x.com/intent/tweet?text=${encodeURIComponent(
  "Just discovered nexu — the simplest open-source openclaw desktop app. Bridge your Agent to WeChat, Feishu, Slack & Discord in one click. Try it free → https://github.com/nexu-io/nexu",
)}`;
const REDDIT_SHARE_URL = `https://www.reddit.com/submit?url=${encodeURIComponent(
  "https://github.com/nexu-io/nexu",
)}&title=${encodeURIComponent(
  "nexu — open-source openclaw desktop app for WeChat, Feishu, Slack & Discord",
)}`;
const LINKEDIN_SHARE_URL = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
  "https://github.com/nexu-io/nexu",
)}`;
const FACEBOOK_SHARE_URL = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
  "https://github.com/nexu-io/nexu",
)}`;
const WHATSAPP_SHARE_URL = `https://wa.me/?text=${encodeURIComponent(
  "Just discovered nexu — open-source openclaw desktop for WeChat, Feishu, Slack & Discord. Try it free → https://github.com/nexu-io/nexu",
)}`;

export const rewardTasks = [
  {
    id: "daily_checkin",
    group: "daily",
    icon: "calendar",
    reward: 100,
    shareMode: "link",
    repeatMode: "daily",
    requiresScreenshot: false,
    actionUrl: null,
  },
  {
    id: "github_star",
    group: "opensource",
    icon: "github",
    reward: 300,
    shareMode: "link",
    repeatMode: "once",
    requiresScreenshot: false,
    actionUrl: GITHUB_URL,
  },
  {
    id: "x_share",
    group: "social",
    icon: "x",
    reward: 200,
    shareMode: "tweet",
    repeatMode: "weekly",
    requiresScreenshot: false,
    actionUrl: X_SHARE_URL,
  },
  {
    id: "reddit",
    group: "social",
    icon: "reddit",
    reward: 200,
    shareMode: "link",
    repeatMode: "weekly",
    requiresScreenshot: false,
    actionUrl: REDDIT_SHARE_URL,
  },
  {
    id: "xiaohongshu",
    group: "social",
    icon: "xiaohongshu",
    reward: 200,
    shareMode: "image",
    repeatMode: "weekly",
    requiresScreenshot: true,
    actionUrl: null,
  },
  {
    id: "lingying",
    group: "social",
    icon: "lingying",
    reward: 200,
    shareMode: "link",
    repeatMode: "weekly",
    requiresScreenshot: false,
    actionUrl: LINKEDIN_SHARE_URL,
  },
  {
    id: "jike",
    group: "social",
    icon: "jike",
    reward: 200,
    shareMode: "image",
    repeatMode: "weekly",
    requiresScreenshot: true,
    actionUrl: null,
  },
  {
    id: "wechat",
    group: "social",
    icon: "wechat",
    reward: 100,
    shareMode: "image",
    repeatMode: "weekly",
    requiresScreenshot: true,
    actionUrl: null,
  },
  {
    id: "feishu",
    group: "social",
    icon: "feishu",
    reward: 100,
    shareMode: "image",
    repeatMode: "weekly",
    requiresScreenshot: true,
    actionUrl: null,
  },
  {
    id: "facebook",
    group: "social",
    icon: "facebook",
    reward: 200,
    shareMode: "link",
    repeatMode: "weekly",
    requiresScreenshot: false,
    actionUrl: FACEBOOK_SHARE_URL,
  },
  {
    id: "whatsapp",
    group: "social",
    icon: "whatsapp",
    reward: 200,
    shareMode: "link",
    repeatMode: "weekly",
    requiresScreenshot: false,
    actionUrl: WHATSAPP_SHARE_URL,
  },
] as const satisfies ReadonlyArray<RewardTask>;

export const desktopRewardClaimEntrySchema = z.object({
  firstClaimedAt: z.string(),
  lastClaimedAt: z.string(),
  claimCount: z.number().int().nonnegative(),
  lastClaimPeriodKey: z.string().nullable(),
});

export const desktopRewardsLedgerSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  claimsByTaskId: z.record(rewardTaskIdSchema, desktopRewardClaimEntrySchema),
});

export const rewardTaskStatusSchema = rewardTaskSchema.extend({
  isClaimed: z.boolean(),
  lastClaimedAt: z.string().nullable(),
  claimCount: z.number().int().nonnegative(),
});

export const rewardProgressSchema = z.object({
  claimedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  earnedCredits: z.number().nonnegative(),
  availableCredits: z.number().nonnegative(),
});

export const desktopRewardsViewerSchema = z.object({
  cloudConnected: z.boolean(),
  activeModelId: z.string().nullable(),
  activeModelProviderId: z.string().nullable(),
  usingManagedModel: z.boolean(),
});

export const desktopRewardsStatusSchema = z.object({
  viewer: desktopRewardsViewerSchema,
  progress: rewardProgressSchema,
  tasks: z.array(rewardTaskStatusSchema),
});

export const claimDesktopRewardRequestSchema = z.object({
  taskId: rewardTaskIdSchema,
});

export const claimDesktopRewardResponseSchema = z.object({
  ok: z.boolean(),
  alreadyClaimed: z.boolean(),
  status: desktopRewardsStatusSchema,
});

export type DesktopRewardsLedger = z.infer<typeof desktopRewardsLedgerSchema>;
export type DesktopRewardClaimEntry = z.infer<
  typeof desktopRewardClaimEntrySchema
>;
export type RewardTaskStatus = z.infer<typeof rewardTaskStatusSchema>;
export type DesktopRewardsStatus = z.infer<typeof desktopRewardsStatusSchema>;
