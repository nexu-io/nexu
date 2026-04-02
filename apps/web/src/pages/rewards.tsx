import {
  FeishuIcon,
  WechatIcon,
  WhatsAppIcon,
} from "@/components/platform-icons";
import { formatRewardAmount } from "@/components/rewards/home-rewards-teaser";
import { useCloudConnect } from "@/hooks/use-cloud-connect";
import { useDesktopRewardsStatus } from "@/hooks/use-desktop-rewards";
import { openExternalUrl } from "@/lib/desktop-links";
import { downloadRandomRewardShareAsset } from "@/lib/reward-share-assets";
import { cn } from "@/lib/utils";
import type { RewardTaskStatus } from "@nexu/shared";
import {
  CalendarCheck2,
  Download,
  ExternalLink,
  Gift,
  Github,
  Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const REWARD_GROUPS: Array<{
  key: RewardTaskStatus["group"];
  labelKey: string;
}> = [
  { key: "daily", labelKey: "rewards.group.daily" },
  { key: "opensource", labelKey: "rewards.group.opensource" },
  { key: "social", labelKey: "rewards.group.social" },
];

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#000000">
      <title>X</title>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function RedditIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FF4500">
      <title>Reddit</title>
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 0-.463.327.327 0 0 0-.462 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.231-.094z" />
    </svg>
  );
}

function LinkedInIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#0A66C2">
      <title>LinkedIn</title>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1877F2">
      <title>Facebook</title>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function RewardTaskIcon({
  icon,
  size = 16,
}: {
  icon: RewardTaskStatus["icon"];
  size?: number;
}) {
  switch (icon) {
    case "calendar":
      return <CalendarCheck2 size={size} className="text-amber-500" />;
    case "github":
      return <Github size={size} className="text-[#111827]" />;
    case "x":
      return <XIcon size={size} />;
    case "reddit":
      return <RedditIcon size={size} />;
    case "xiaohongshu":
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#ff2442] text-[10px] font-bold text-white">
          R
        </span>
      );
    case "lingying":
      return <LinkedInIcon size={size} />;
    case "jike":
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ffe411] text-[10px] font-bold text-black">
          J
        </span>
      );
    case "wechat":
      return <WechatIcon size={size + 2} />;
    case "feishu":
      return <FeishuIcon size={size + 2} />;
    case "facebook":
      return <FacebookIcon size={size} />;
    case "whatsapp":
      return <WhatsAppIcon size={size + 2} />;
    default:
      return <Gift size={size} className="text-text-secondary" />;
  }
}

function RewardConfirmModal({
  task,
  submitting,
  onCancel,
  onConfirm,
}: {
  task: RewardTaskStatus;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [imageDownloaded, setImageDownloaded] = useState(false);
  const amount = formatRewardAmount(task.reward);
  const isDaily = task.repeatMode === "daily";
  const isImage = task.shareMode === "image";
  const descKey = isDaily
    ? "budget.confirm.checkinDesc"
    : isImage
      ? "budget.confirm.imageDesc"
      : task.requiresScreenshot
        ? "budget.confirm.screenshotDesc"
        : "budget.confirm.desc";
  const canConfirm = !isImage || imageDownloaded;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close reward confirmation"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-[360px] rounded-[24px] border border-border bg-white p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col items-center text-center">
          <div
            className={cn(
              "mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border",
              isDaily
                ? "border-amber-200/80 bg-amber-50"
                : "border-[var(--color-success)]/20 bg-[var(--color-success)]/8",
            )}
          >
            <RewardTaskIcon icon={task.icon} size={22} />
          </div>

          <h2 className="text-[14px] font-semibold text-text-primary">
            {t("budget.confirm.title").replace(
              "{channel}",
              t(`reward.${task.id}.name`),
            )}
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
            {t(descKey).replace("${n}", amount)}
          </p>
          <div className="mt-3 inline-flex items-center rounded-full bg-[var(--color-success)]/8 px-3 py-1 text-[13px] font-semibold leading-none text-[var(--color-success)]">
            +${amount}
          </div>

          {isImage ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  downloadRandomRewardShareAsset();
                  setImageDownloaded(true);
                } catch {
                  toast.error(t("rewards.downloadFailed"));
                }
              }}
              className="mt-4 inline-flex h-[38px] w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--color-brand-primary)] px-4 text-[13px] font-medium text-white transition hover:opacity-90"
            >
              <Download size={14} />
              {imageDownloaded
                ? `${t("budget.confirm.downloadImage")} ✓`
                : t("budget.confirm.downloadImage")}
            </button>
          ) : null}

          <div className="mt-4 flex w-full items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-[38px] flex-1 rounded-[12px] border border-border px-4 text-[13px] font-medium text-text-secondary transition hover:bg-surface-2"
            >
              {t("budget.confirm.cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirm || submitting}
              onClick={() => void onConfirm()}
              className="inline-flex h-[38px] flex-1 items-center justify-center gap-2 rounded-[12px] bg-neutral-900 px-4 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              {t("budget.confirm.done")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RewardsPage() {
  const { t } = useTranslation();
  const { status, loading, refresh, claimTask, claimingTaskId } =
    useDesktopRewardsStatus();
  const [confirmTaskId, setConfirmTaskId] = useState<
    RewardTaskStatus["id"] | null
  >(null);

  const { cloudConnecting, handleCloudConnect } = useCloudConnect({
    cloudConnected: status.viewer.cloudConnected,
    onPoll: refresh,
    onConnected: refresh,
  });

  const confirmTask = useMemo(
    () => status.tasks.find((task) => task.id === confirmTaskId) ?? null,
    [confirmTaskId, status.tasks],
  );

  const groupedTasks = useMemo(() => {
    return REWARD_GROUPS.map((group) => ({
      ...group,
      tasks: status.tasks.filter((task) => task.group === group.key),
    })).filter((group) => group.tasks.length > 0);
  }, [status.tasks]);

  const handleTaskAction = async (task: RewardTaskStatus) => {
    if (task.isClaimed) {
      return;
    }

    if (task.shareMode !== "image" && task.actionUrl) {
      await openExternalUrl(task.actionUrl);
    }

    setConfirmTaskId(task.id);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[520px] p-6">
        <div className="mb-6">
          <h1 className="mb-1 text-[22px] font-bold text-text-primary">
            {t("rewards.title")}
          </h1>
          <p className="text-[13px] text-text-secondary">
            {t("rewards.desc")}{" "}
            <a
              href="https://docs.nexu.io/rewards"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-primary)] hover:underline"
            >
              {t("budget.viral.rules")}
            </a>
          </p>
        </div>

        <div className="mb-6">
          {loading ? (
            <div data-rewards-summary-loading="true" className="animate-pulse">
              <div className="mb-2 flex items-center justify-between">
                <div className="h-3 w-14 rounded-full bg-border/70" />
                <div className="h-3 w-10 rounded-full bg-border/70" />
              </div>
              <div className="h-[5px] w-full overflow-hidden rounded-full bg-border/60">
                <div className="h-full w-1/3 rounded-full bg-border/80" />
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="tabular-nums text-[12px] font-medium text-text-secondary">
                  {status.progress.claimedCount} / {status.progress.totalCount}
                </span>
                <span className="tabular-nums text-[12px] font-medium text-[var(--color-success)]">
                  +${formatRewardAmount(status.progress.earnedCredits)}
                </span>
              </div>
              <div className="h-[5px] w-full overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full bg-[var(--color-success)] transition-all duration-500"
                  style={{
                    width: `${status.progress.totalCount > 0 ? (status.progress.claimedCount / status.progress.totalCount) * 100 : 0}%`,
                  }}
                />
              </div>
            </>
          )}
        </div>

        {!loading && status.cloudBalance ? (
          <div className="mb-6 flex items-center justify-between rounded-[18px] border border-border bg-surface-0 px-4 py-3">
            <div>
              <div className="text-[11px] font-medium text-text-secondary">
                {t("rewards.cloudBalance")}
              </div>
              <div className="mt-0.5 text-[20px] font-bold tabular-nums text-text-primary">
                {formatRewardAmount(status.cloudBalance.totalBalance)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-text-muted">
                {t("rewards.totalEarned")}:{" "}
                <span className="tabular-nums">
                  {formatRewardAmount(status.cloudBalance.totalRecharged)}
                </span>
              </div>
              <div className="text-[11px] text-text-muted">
                {t("rewards.totalUsed")}:{" "}
                <span className="tabular-nums">
                  {formatRewardAmount(status.cloudBalance.totalConsumed)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !status.viewer.cloudConnected ? (
          <div className="mb-6 rounded-[18px] border border-[#d6c7aa] bg-[#faf3e6] px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[14px] font-semibold text-text-primary">
                  {t("rewards.loginTitle")}
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                  {t("rewards.loginBody")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCloudConnect()}
                className="inline-flex h-[32px] items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 text-[12px] font-medium text-white transition hover:bg-neutral-800"
              >
                {cloudConnecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ExternalLink size={14} />
                )}
                {t("rewards.loginCta")}
              </button>
            </div>
          </div>
        ) : null}

        {!loading &&
        status.viewer.cloudConnected &&
        !status.viewer.usingManagedModel ? (
          <div className="mb-6 rounded-[18px] border border-border bg-surface-0 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[14px] font-semibold text-text-primary">
                  {t("rewards.modelHintTitle")}
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                  {t("rewards.modelHintBody")}
                </p>
              </div>
              <Link
                to="/workspace/models?tab=providers"
                className="inline-flex h-[32px] items-center justify-center gap-2 rounded-full border border-border bg-white px-4 text-[12px] font-medium text-text-primary transition hover:bg-surface-2"
              >
                <ExternalLink size={14} />
                {t("rewards.modelHintCta")}
              </Link>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {groupedTasks.map((group) => (
            <section key={group.key}>
              <div className="mb-1 pl-0.5 text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
                {t(group.labelKey)}
              </div>
              <div className="space-y-0">
                {group.tasks.map((task, index) => {
                  const actionLabel = task.isClaimed
                    ? t("budget.cta.done").replace(
                        "${n}",
                        formatRewardAmount(task.reward),
                      )
                    : loading
                      ? "..."
                      : task.repeatMode === "daily"
                        ? t("budget.cta.checkin")
                        : task.shareMode === "image"
                          ? t("budget.cta.download")
                          : task.shareMode === "tweet"
                            ? t("budget.cta.share")
                            : t("budget.cta.go");

                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-3",
                        index > 0 && "border-t border-border/50",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                          task.isClaimed
                            ? "border-border/50 bg-surface-2 opacity-50"
                            : "border-border bg-white",
                        )}
                      >
                        <RewardTaskIcon icon={task.icon} size={16} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[13px] font-medium leading-tight",
                              task.isClaimed
                                ? "text-text-muted"
                                : "text-text-primary",
                            )}
                          >
                            {t(`reward.${task.id}.name`)}
                          </span>
                          <span className="text-[11px] font-semibold leading-none tabular-nums text-[var(--color-success)]">
                            +${formatRewardAmount(task.reward)}
                          </span>
                        </div>
                        <div
                          className={cn(
                            "mt-0.5 text-[11px]",
                            task.isClaimed
                              ? "text-text-muted/60"
                              : "text-text-muted",
                          )}
                        >
                          {t(`reward.${task.id}.desc`)}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={
                          loading ||
                          task.isClaimed ||
                          claimingTaskId === task.id
                        }
                        onClick={() => void handleTaskAction(task)}
                        className={cn(
                          "inline-flex h-[26px] shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[11px] font-medium leading-none transition-all",
                          task.isClaimed
                            ? "bg-[var(--color-success)]/8 text-[var(--color-success)]"
                            : "border border-[var(--color-brand-primary)]/30 text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)]/5",
                        )}
                      >
                        {claimingTaskId === task.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : null}
                        {actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {status.tasks.some(
          (task) => task.id === "daily_checkin" && task.claimCount > 0,
        ) ? (
          <div className="mt-5 border-t border-border/50 pt-4 text-[11px] text-text-muted">
            {t("rewards.checkinTotal").replace(
              "${n}",
              formatRewardAmount(
                status.tasks
                  .filter((task) => task.id === "daily_checkin")
                  .reduce(
                    (sum, task) => sum + task.claimCount * task.reward,
                    0,
                  ),
              ),
            )}
          </div>
        ) : null}
      </div>

      {confirmTask ? (
        <RewardConfirmModal
          task={confirmTask}
          submitting={claimingTaskId === confirmTask.id}
          onCancel={() => setConfirmTaskId(null)}
          onConfirm={async () => {
            try {
              const result = await claimTask(confirmTask.id);
              if (!result.ok) {
                toast.error(t("rewards.claimFailed"));
                setConfirmTaskId(null);
                return;
              }
              if (result.alreadyClaimed) {
                toast.success(t("rewards.claimAlreadyDone"));
              } else {
                toast.success(t("rewards.claimSuccess"));
              }
              setConfirmTaskId(null);
            } catch {
              toast.error(t("rewards.claimFailed"));
            }
          }}
        />
      ) : null}
    </div>
  );
}
