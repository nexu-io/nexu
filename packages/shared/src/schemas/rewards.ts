import { z } from "zod";

export const rewardGroupSchema = z.enum(["daily", "opensource", "social"]);
export const rewardShareModeSchema = z.enum(["link", "tweet", "image"]);
export const rewardRepeatModeSchema = z.enum(["once", "daily", "weekly"]);
export const rewardTaskIdSchema = z.enum([
  "daily_checkin",
  "github_star",
  "x_share",
  "reddit",
  "mobile_share",
  "lingying",
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
export const rewardUrlProofTaskIdSchema = z.enum([
  "x_share",
  "reddit",
  "lingying",
  "facebook",
]);
export type RewardUrlProofTaskId = z.infer<typeof rewardUrlProofTaskIdSchema>;

const GITHUB_URL = "https://github.com/nexu-io/nexu";
const REDDIT_SHARE_TARGET_URL =
  "https://dev.to/joey_lee_c96e4ad421791371/we-built-an-open-source-openclaw-desktop-client-that-fixes-17-pitfalls-gjn";
const UNIVERSAL_SHARE_COPY =
  "The simplest desktop client for OpenClaw 🦞 — bridge your Agent to WeChat, Feishu, Slack & Discord and more in one click. Works with Claude Code, Codex & any LLM. BYOK, Oauth, local-first, chat from your phone 24/7.";
const UNIVERSAL_SHARE_TEXT = `${UNIVERSAL_SHARE_COPY} ${GITHUB_URL}`;
const X_SHARE_URL = `https://x.com/intent/tweet?text=${encodeURIComponent(
  UNIVERSAL_SHARE_TEXT,
)}`;
const REDDIT_SHARE_URL = `https://www.reddit.com/submit?url=${encodeURIComponent(
  REDDIT_SHARE_TARGET_URL,
)}`;
const LINKEDIN_SHARE_URL = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
  "https://github.com/nexu-io/nexu",
)}`;
const FACEBOOK_SHARE_URL = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
  REDDIT_SHARE_TARGET_URL,
)}`;
const WHATSAPP_SHARE_URL = `https://wa.me/?text=${encodeURIComponent(
  UNIVERSAL_SHARE_TEXT,
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
    id: "mobile_share",
    group: "social",
    icon: "smartphone",
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
  availableCredits: z.number().nonnegative().optional(),
});

export const desktopRewardsViewerSchema = z.object({
  cloudConnected: z.boolean(),
  activeModelId: z.string().nullable(),
  activeModelProviderId: z.string().nullable(),
  usingManagedModel: z.boolean(),
});

export const cloudCreditBalanceSchema = z
  .object({
    totalBalance: z.number().int().nonnegative(),
    totalRecharged: z.number().int().nonnegative(),
    totalConsumed: z.number().int().nonnegative(),
  })
  .nullable();

export const desktopRewardsStatusSchema = z.object({
  viewer: desktopRewardsViewerSchema,
  progress: rewardProgressSchema,
  tasks: z.array(rewardTaskStatusSchema),
  cloudBalance: cloudCreditBalanceSchema.default(null),
  autoFallbackTriggered: z.boolean().optional(),
});

export const desktopRewardClaimProofSchema = z
  .object({
    url: z.string().trim().url().max(2048).optional(),
    githubSessionId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const claimDesktopRewardRequestSchema = z.object({
  taskId: rewardTaskIdSchema,
  proof: desktopRewardClaimProofSchema.optional(),
});

export const claimDesktopRewardResponseSchema = z.object({
  ok: z.boolean(),
  alreadyClaimed: z.boolean(),
  status: desktopRewardsStatusSchema,
});

export const prepareGithubStarSessionRequestSchema = z.object({});

export const prepareGithubStarSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  baselineStars: z.number().int().nonnegative(),
  expiresAt: z.string(),
});

const rewardUrlProofPatterns = {
  x_share:
    /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:[/?#].*)?$/i,
  reddit:
    /^https?:\/\/(?:(?:www\.)?reddit\.com\/r\/[A-Za-z0-9_]+\/comments\/[A-Za-z0-9]+(?:\/[^/?#]+)?|redd\.it\/[A-Za-z0-9]+)(?:[/?#].*)?$/i,
  lingying:
    /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:feed\/update\/urn:li:(?:share|activity):\d+|posts\/[^/?#]+|pulse\/[^?#]+)(?:[/?#].*)?$/i,
  facebook:
    /^https?:\/\/(?:www\.)?facebook\.com\/(?:[^/?#]+\/posts\/\d+|story\.php\?story_fbid=\d+[^#]*|permalink\.php\?story_fbid=\d+[^#]*|share\/p\/[A-Za-z0-9]+|reel\/\d+)(?:[/?#].*)?$/i,
} as const satisfies Record<RewardUrlProofTaskId, RegExp>;

export function rewardTaskRequiresUrlProof(
  taskId: RewardTaskId,
): taskId is RewardUrlProofTaskId {
  return rewardUrlProofTaskIdSchema.safeParse(taskId).success;
}

export function rewardTaskRequiresGithubStarSession(
  taskId: RewardTaskId,
): boolean {
  return taskId === "github_star";
}

export function validateRewardProofUrl(
  taskId: RewardUrlProofTaskId,
  value: string,
): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  return rewardUrlProofPatterns[taskId].test(normalized);
}

export type DesktopRewardsLedger = z.infer<typeof desktopRewardsLedgerSchema>;
export type DesktopRewardClaimEntry = z.infer<
  typeof desktopRewardClaimEntrySchema
>;
export type RewardTaskStatus = z.infer<typeof rewardTaskStatusSchema>;
export type DesktopRewardsStatus = z.infer<typeof desktopRewardsStatusSchema>;
export type DesktopRewardClaimProof = z.infer<
  typeof desktopRewardClaimProofSchema
>;
export type PrepareGithubStarSessionResponse = z.infer<
  typeof prepareGithubStarSessionResponseSchema
>;
