import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1QuotaFallbackToByok } from "../../lib/api/sdk.gen";
import { BOT_QUOTA_QUERY_KEY, useBotQuota } from "./use-bot-quota";
import {
  DESKTOP_REWARDS_QUERY_KEY,
  useDesktopRewardsStatus,
} from "./use-desktop-rewards";

export type BudgetBannerStatus = "healthy" | "warning" | "depleted";

const budgetBannerDismissStorageKey = "nexu_budget_banner_dismissed_v2";

function readDismissedStatus(): Exclude<BudgetBannerStatus, "healthy"> | null {
  try {
    const stored = sessionStorage.getItem(budgetBannerDismissStorageKey);
    if (stored === "warning" || stored === "depleted") {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function persistDismissedStatus(
  status: Exclude<BudgetBannerStatus, "healthy"> | null,
) {
  try {
    if (status === null) {
      sessionStorage.removeItem(budgetBannerDismissStorageKey);
      return;
    }
    sessionStorage.setItem(budgetBannerDismissStorageKey, status);
  } catch {
    // ignore storage errors
  }
}

export function getBudgetBannerStatus(input: {
  cloudConnected: boolean;
  usingManagedModel: boolean;
  cloudBalance: { totalBalance: number } | null;
  earnedCredits: number;
}): BudgetBannerStatus {
  if (!input.cloudConnected) return "healthy";
  if (!input.usingManagedModel) return "healthy";
  if (input.cloudBalance === null) return "healthy";
  if (input.cloudBalance.totalBalance === 0) return "depleted";
  const total = input.cloudBalance.totalBalance + input.earnedCredits;
  if (total > 0 && input.earnedCredits / total >= 0.8) return "warning";
  return "healthy";
}

export function useDesktopBudgetGuard(input: {
  pathname: string;
  cloudConnected: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { status: rewardsStatus } = useDesktopRewardsStatus();
  const { usingByok, byokAvailable } = useBotQuota();
  const [dismissedStatus, setDismissedStatus] = useState<Exclude<
    BudgetBannerStatus,
    "healthy"
  > | null>(() => readDismissedStatus());
  const attemptedFallbackKeyRef = useRef<string | null>(null);

  const budgetStatus = useMemo(
    () =>
      getBudgetBannerStatus({
        cloudConnected: input.cloudConnected,
        usingManagedModel: rewardsStatus.viewer.usingManagedModel,
        cloudBalance: rewardsStatus.cloudBalance,
        earnedCredits: rewardsStatus.progress.earnedCredits,
      }),
    [
      input.cloudConnected,
      rewardsStatus.cloudBalance,
      rewardsStatus.progress.earnedCredits,
      rewardsStatus.viewer.usingManagedModel,
    ],
  );

  const isRemediationPage =
    input.pathname.includes("/workspace/rewards") ||
    input.pathname.includes("/workspace/settings") ||
    input.pathname.includes("/workspace/models");
  const bannerDismissible = budgetStatus === "warning";
  const shouldShowPrompt =
    !isRemediationPage &&
    budgetStatus !== "healthy" &&
    (!bannerDismissible || dismissedStatus !== budgetStatus);

  const fallbackKey = useMemo(() => {
    if (budgetStatus !== "depleted") return null;
    if (!rewardsStatus.viewer.usingManagedModel) return null;
    return [
      rewardsStatus.viewer.activeModelId ?? "none",
      rewardsStatus.cloudBalance?.totalBalance ?? "null",
      rewardsStatus.viewer.usingManagedModel ? "managed" : "other",
    ].join(":");
  }, [
    budgetStatus,
    rewardsStatus.cloudBalance?.totalBalance,
    rewardsStatus.viewer.activeModelId,
    rewardsStatus.viewer.usingManagedModel,
  ]);

  const fallbackMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postApiV1QuotaFallbackToByok();
      if (error || !data) {
        throw error ?? new Error("Failed to fallback to BYOK");
      }
      return data;
    },
  });

  useEffect(() => {
    if (
      budgetStatus !== "depleted" ||
      !rewardsStatus.viewer.usingManagedModel
    ) {
      attemptedFallbackKeyRef.current = null;
      return;
    }

    if (!byokAvailable || fallbackKey === null) {
      return;
    }

    if (attemptedFallbackKeyRef.current === fallbackKey) {
      return;
    }

    attemptedFallbackKeyRef.current = fallbackKey;

    void fallbackMutation
      .mutateAsync()
      .then(async (result) => {
        if (!result.ok) {
          toast.error(t("budget.autoFallback.failed"), { duration: 8000 });
          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: DESKTOP_REWARDS_QUERY_KEY,
          }),
          queryClient.invalidateQueries({ queryKey: BOT_QUOTA_QUERY_KEY }),
        ]);
        toast.warning(t("budget.autoFallback.toast"), { duration: 8000 });
      })
      .catch(() => {
        toast.error(t("budget.autoFallback.failed"), { duration: 8000 });
      });
  }, [
    budgetStatus,
    byokAvailable,
    fallbackKey,
    fallbackMutation,
    queryClient,
    rewardsStatus.viewer.usingManagedModel,
    t,
  ]);

  const dismissBanner = useCallback(() => {
    if (!bannerDismissible) {
      return;
    }
    setDismissedStatus(budgetStatus);
    persistDismissedStatus(budgetStatus);
  }, [bannerDismissible, budgetStatus]);

  useEffect(() => {
    if (budgetStatus === "healthy") {
      if (dismissedStatus !== null) {
        setDismissedStatus(null);
        persistDismissedStatus(null);
      }
      return;
    }

    if (budgetStatus === "depleted" && dismissedStatus !== null) {
      setDismissedStatus(null);
      persistDismissedStatus(null);
    }
  }, [budgetStatus, dismissedStatus]);

  return {
    budgetStatus,
    shouldShowPrompt,
    bannerDismissible,
    dismissBanner,
    usingByok,
    byokAvailable,
  };
}
