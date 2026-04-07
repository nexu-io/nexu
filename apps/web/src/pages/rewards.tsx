import { formatRewardAmount } from "@/components/rewards/home-rewards-teaser";
import { RewardTaskIcon } from "@/components/rewards/reward-task-icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCloudConnect } from "@/hooks/use-cloud-connect";
import { useDesktopRewardsStatus } from "@/hooks/use-desktop-rewards";
import { openExternalUrl } from "@/lib/desktop-links";
import { downloadRandomRewardShareAsset } from "@/lib/reward-share-assets";
import {
  type RewardConfirmPhase,
  completeRewardWithVirtualCheck,
  getRewardCheckingDescriptionKey,
} from "@/lib/reward-virtual-check";
import { cn } from "@/lib/utils";
import {
  type RewardTaskStatus,
  rewardTaskRequiresGithubStarSession,
  rewardTaskRequiresUrlProof,
  validateRewardProofUrl,
} from "@nexu/shared";
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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

function RewardConfirmModal({
  task,
  phase,
  proofUrl,
  onProofUrlChange,
  onCancel,
  onConfirm,
}: {
  task: RewardTaskStatus;
  phase: RewardConfirmPhase;
  proofUrl: string;
  onProofUrlChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [imageDownloaded, setImageDownloaded] = useState(false);
  const amount = formatRewardAmount(task.reward);
  const isDaily = task.repeatMode === "daily";
  const isImage = task.shareMode === "image";
  const isChecking = phase === "checking";
  const isClaiming = phase === "claiming";
  const isBusy = isChecking || isClaiming;
  const proofUrlTaskId = rewardTaskRequiresUrlProof(task.id) ? task.id : null;
  const requiresUrlProof = proofUrlTaskId !== null;
  const proofUrlTouched = proofUrl.trim().length > 0;
  const proofUrlValid = proofUrlTaskId
    ? validateRewardProofUrl(proofUrlTaskId, proofUrl)
    : true;
  const descKey = isChecking
    ? getRewardCheckingDescriptionKey(task)
    : isClaiming
      ? "budget.confirm.claimingDesc"
      : isDaily
        ? "budget.confirm.checkinDesc"
        : isImage
          ? "budget.confirm.imageDesc"
          : task.requiresScreenshot
            ? "budget.confirm.screenshotDesc"
            : "budget.confirm.desc";
  const canConfirm = (!isImage || imageDownloaded) && proofUrlValid;
  const title = isChecking
    ? t("budget.confirm.checkingTitle")
    : isClaiming
      ? t("budget.confirm.claimingTitle")
      : t("budget.confirm.title").replace(
          "{channel}",
          t(`reward.${task.id}.name`),
        );
  const confirmLabel = isChecking
    ? t("budget.confirm.checking")
    : isClaiming
      ? t("budget.confirm.claiming")
      : t("budget.confirm.done");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-reward-confirm-phase={phase}
    >
      <button
        type="button"
        aria-label="Close reward confirmation"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={isBusy ? undefined : onCancel}
      />
      <div className="relative mx-4 w-full max-w-[340px] rounded-2xl border border-border bg-surface-1 p-5 shadow-[var(--shadow-dropdown)] animate-in fade-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center">
          <div
            className={cn(
              "mb-4 flex h-11 w-11 items-center justify-center rounded-xl border",
              isDaily
                ? "border-amber-200/60 bg-amber-50"
                : "border-[var(--color-success)]/20 bg-[var(--color-success)]/8",
            )}
          >
            {isBusy ? (
              <Loader2 size={18} className="animate-spin text-text-secondary" />
            ) : (
              <RewardTaskIcon icon={task.icon} size={22} />
            )}
          </div>

          <h2 className="mb-1 text-[14px] font-semibold text-text-primary">
            {title}
          </h2>
          <p className="text-[12px] leading-relaxed text-text-secondary">
            {t(descKey).replace("${n}", amount)}
          </p>
          <div className="mb-4 mt-1 inline-flex items-center rounded-full bg-[var(--color-success)]/8 px-3 py-1 text-[13px] font-semibold leading-none text-[var(--color-success)] tabular-nums">
            +{amount} {t("layout.sidebar.balanceUnit")}
          </div>

          {isImage && !imageDownloaded && !isBusy ? (
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
              className="mb-3 flex h-[36px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--color-brand-primary)] text-[13px] font-medium text-white transition-all hover:opacity-90 active:scale-[0.98]"
            >
              <Download size={14} />
              {t("budget.confirm.downloadImage")}
            </button>
          ) : null}

          {isImage && imageDownloaded && !isBusy ? (
            <div className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-success)]">
              <Check size={14} />
              {t("budget.confirm.downloadImage")} ✓
            </div>
          ) : null}

          {requiresUrlProof ? (
            <div className="mb-3 w-full text-left">
              <label
                htmlFor={`reward-proof-url-${task.id}`}
                className="mb-1.5 block text-[12px] font-medium text-text-primary"
              >
                {t("rewards.proofUrlLabel")}
              </label>
              <input
                id={`reward-proof-url-${task.id}`}
                type="url"
                value={proofUrl}
                onChange={(event) => onProofUrlChange(event.target.value)}
                placeholder={t("rewards.proofUrlPlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={isBusy}
                className={cn(
                  "h-[36px] w-full rounded-[10px] border bg-white px-3 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted disabled:cursor-not-allowed disabled:bg-surface-2",
                  proofUrlTouched && !proofUrlValid
                    ? "border-[var(--color-danger)] focus:border-[var(--color-danger)]"
                    : "border-border focus:border-[var(--color-brand-primary)]",
                )}
              />
              <div className="mt-1 text-[11px] leading-5">
                {proofUrlTouched && !proofUrlValid ? (
                  <span className="text-[var(--color-danger)]">
                    {t("rewards.proofUrlInvalid")}
                  </span>
                ) : (
                  <span className="text-text-muted">
                    {t("rewards.proofUrlHint")}
                  </span>
                )}
              </div>
            </div>
          ) : null}

          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={onCancel}
              className="h-[36px] flex-1 rounded-[10px] border border-border px-4 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("budget.confirm.cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirm || isBusy}
              onClick={() => void onConfirm()}
              className="inline-flex h-[36px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-neutral-900 px-4 text-[13px] font-medium text-white transition-all hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#909CA3] disabled:text-white/95 disabled:hover:bg-[#909CA3]"
            >
              {isBusy ? <Loader2 size={14} className="animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RewardsPage() {
  const { t, i18n } = useTranslation();
  const {
    status,
    loading,
    refresh,
    claimTask,
    claimingTaskId,
    prepareGithubStarSession,
    isPreparingGithubStarSession,
  } = useDesktopRewardsStatus();
  const [confirmTaskId, setConfirmTaskId] = useState<
    RewardTaskStatus["id"] | null
  >(null);
  const [confirmPhase, setConfirmPhase] = useState<RewardConfirmPhase>("idle");
  const [confirmProofUrl, setConfirmProofUrl] = useState("");
  const [confirmGithubSessionId, setConfirmGithubSessionId] = useState<
    string | null
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

    // #818 + #816: 未登录时直接引导登录，不发起 claim 请求
    if (!status.viewer.cloudConnected) {
      toast.info(t("rewards.loginRequired"));
      void handleCloudConnect();
      return;
    }

    if (task.id === "daily_checkin") {
      try {
        const result = await claimTask({ taskId: task.id });
        if (result.alreadyClaimed) {
          toast.success(t("rewards.claimAlreadyDone"));
        } else if (result.ok) {
          toast.success(t("rewards.claimSuccess"));
        } else {
          toast.error(t("rewards.claimFailed"));
        }
      } catch {
        toast.error(t("rewards.claimFailed"));
      }
      return;
    }

    if (rewardTaskRequiresGithubStarSession(task.id)) {
      let sessionId: string | null = null;
      try {
        const session = await prepareGithubStarSession();
        sessionId = session.sessionId;
      } catch {
        toast.error(t("rewards.githubSessionFailed"));
        return;
      }
      setConfirmPhase("idle");
      setConfirmProofUrl("");
      setConfirmGithubSessionId(sessionId);
      if (task.actionUrl) {
        await openExternalUrl(task.actionUrl);
      }
      setConfirmTaskId(task.id);
      return;
    }

    setConfirmPhase("idle");
    setConfirmProofUrl("");
    setConfirmGithubSessionId(null);

    if (task.shareMode !== "image" && task.actionUrl) {
      await openExternalUrl(task.actionUrl);
    }

    setConfirmTaskId(task.id);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="mb-1 text-[22px] font-bold text-text-primary">
            {t("rewards.title")}
          </h1>
          <p className="text-[13px] text-text-secondary">
            {t("rewards.desc")}{" "}
            <a
              href={`https://docs.nexu.io${i18n.language === "zh" ? "/zh" : ""}/guide/rewards`}
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
                  +{formatRewardAmount(status.progress.earnedCredits)}{" "}
                  {t("layout.sidebar.balanceUnit")}
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
          {loading ? (
            <div className="animate-pulse space-y-3">
              {["daily", "opensource", "social"].map((group) => (
                <section key={group}>
                  <div className="mb-1 h-3 w-16 rounded-full bg-border/60" />
                  <div className="space-y-0">
                    <div className="flex items-center gap-3 rounded-lg px-3 py-3">
                      <div className="h-8 w-8 shrink-0 rounded-[10px] bg-border/60" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-24 rounded-full bg-border/70" />
                        <div className="h-2.5 w-36 rounded-full bg-border/50" />
                      </div>
                      <div className="h-[26px] w-16 rounded-full bg-border/50" />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : null}
          {!loading &&
            groupedTasks.map((group) => {
              const renderTaskList = (tasks: RewardTaskStatus[]) => (
                <div className="space-y-0">
                  {tasks.map((task, index) => {
                    const isGithubStar = rewardTaskRequiresGithubStarSession(
                      task.id,
                    );
                    const isPreparingThisTask =
                      isGithubStar && isPreparingGithubStarSession;
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
                              +{formatRewardAmount(task.reward)}{" "}
                              {t("layout.sidebar.balanceUnit")}
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
                            isPreparingThisTask ||
                            claimingTaskId === task.id
                          }
                          onClick={() => void handleTaskAction(task)}
                          className={cn(
                            "inline-flex h-[26px] shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[11px] font-medium leading-none transition-all",
                            task.isClaimed
                              ? "bg-surface-2 text-text-muted"
                              : "border border-[var(--color-brand-primary)]/30 text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)]/5",
                          )}
                        >
                          {claimingTaskId === task.id || isPreparingThisTask ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : null}
                          {actionLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );

              const webTasks = group.tasks.filter(
                (task) => task.shareMode !== "image",
              );
              const mobileTasks = group.tasks.filter(
                (task) => task.shareMode === "image",
              );

              return (
                <section key={group.key}>
                  <div className="mb-1 pl-0.5 text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
                    {t(group.labelKey)}
                  </div>
                  {group.key === "social" ? (
                    <Tabs defaultValue="web">
                      <TabsList className="mb-1 h-7 rounded-md bg-surface-2 p-0.5">
                        <TabsTrigger
                          value="web"
                          className="h-6 rounded px-2.5 text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
                        >
                          {t("rewards.tab.web")}
                        </TabsTrigger>
                        <TabsTrigger
                          value="mobile"
                          className="h-6 rounded px-2.5 text-[11px] data-[state=active]:bg-white data-[state=active]:shadow-sm"
                        >
                          <Smartphone size={11} className="mr-1" />
                          {t("rewards.tab.mobile")}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="web">
                        {renderTaskList(webTasks)}
                      </TabsContent>
                      <TabsContent value="mobile">
                        <div className="flex items-center gap-4 rounded-lg px-3 py-3">
                          <div className="shrink-0 rounded-xl border border-border bg-white p-1.5">
                            <QRCodeSVG
                              value="https://github.com/nexu-io/nexu"
                              size={56}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium text-text-primary">
                                {t("rewards.mobileQrHint")}
                              </span>
                              <span className="text-[11px] font-semibold leading-none tabular-nums text-[var(--color-success)]">
                                +200 {t("layout.sidebar.balanceUnit")}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-text-muted">
                              {t("rewards.mobileQrDesc")}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={
                              loading ||
                              mobileTasks.every((task) => task.isClaimed) ||
                              mobileTasks.some(
                                (task) => claimingTaskId === task.id,
                              )
                            }
                            onClick={async () => {
                              if (!status.viewer.cloudConnected) {
                                toast.info(t("rewards.loginRequired"));
                                void handleCloudConnect();
                                return;
                              }
                              const unclaimed = mobileTasks.filter(
                                (task) => !task.isClaimed,
                              );
                              let earned = 0;
                              for (const task of unclaimed) {
                                try {
                                  const result = await claimTask({
                                    taskId: task.id,
                                  });
                                  if (result.ok && !result.alreadyClaimed) {
                                    earned += task.reward;
                                  }
                                } catch {
                                  /* continue claiming remaining tasks */
                                }
                              }
                              if (earned > 0) {
                                toast.success(
                                  `${t("rewards.claimSuccess")} +${formatRewardAmount(earned)} ${t("layout.sidebar.balanceUnit")}`,
                                );
                              } else {
                                toast.success(t("rewards.claimAlreadyDone"));
                              }
                            }}
                            className={cn(
                              "inline-flex h-[26px] shrink-0 items-center justify-center gap-2 rounded-full px-3 text-[11px] font-medium leading-none transition-all",
                              mobileTasks.every((task) => task.isClaimed)
                                ? "bg-surface-2 text-text-muted"
                                : "border border-[var(--color-brand-primary)]/30 text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)]/5",
                            )}
                          >
                            {mobileTasks.some(
                              (task) => claimingTaskId === task.id,
                            ) ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : null}
                            {mobileTasks.every((task) => task.isClaimed)
                              ? t("budget.cta.done").replace("${n}", "200")
                              : t("budget.cta.go")}
                          </button>
                        </div>
                      </TabsContent>
                    </Tabs>
                  ) : (
                    renderTaskList(group.tasks)
                  )}
                </section>
              );
            })}
        </div>
      </div>

      {confirmTask ? (
        <RewardConfirmModal
          key={confirmTask.id}
          task={confirmTask}
          phase={
            claimingTaskId === confirmTask.id && confirmPhase === "idle"
              ? "claiming"
              : confirmPhase
          }
          proofUrl={confirmProofUrl}
          onProofUrlChange={setConfirmProofUrl}
          onCancel={() => {
            setConfirmPhase("idle");
            setConfirmTaskId(null);
            setConfirmProofUrl("");
            setConfirmGithubSessionId(null);
          }}
          onConfirm={async () => {
            if (confirmPhase !== "idle") {
              return;
            }

            setConfirmPhase("checking");

            try {
              const result = await completeRewardWithVirtualCheck({
                task: confirmTask,
                claim: () =>
                  claimTask({
                    taskId: confirmTask.id,
                    proof: {
                      url: rewardTaskRequiresUrlProof(confirmTask.id)
                        ? confirmProofUrl.trim()
                        : undefined,
                      githubSessionId: rewardTaskRequiresGithubStarSession(
                        confirmTask.id,
                      )
                        ? (confirmGithubSessionId ?? undefined)
                        : undefined,
                    },
                  }),
                onPhaseChange: (phase) => {
                  if (phase === "claiming") {
                    setConfirmPhase("claiming");
                  }
                },
              });
              if (!result.ok) {
                toast.error(t("rewards.claimFailed"));
                setConfirmPhase("idle");
                return;
              }
              if (result.alreadyClaimed) {
                toast.success(t("rewards.claimAlreadyDone"));
              } else {
                toast.success(t("rewards.claimSuccess"));
              }
              setConfirmPhase("idle");
              setConfirmTaskId(null);
              setConfirmProofUrl("");
              setConfirmGithubSessionId(null);
            } catch {
              toast.error(t("rewards.claimFailed"));
              setConfirmPhase("idle");
            }
          }}
        />
      ) : null}
    </div>
  );
}
