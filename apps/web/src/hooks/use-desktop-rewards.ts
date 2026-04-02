import "@/lib/api";
import {
  type DesktopRewardClaimProof,
  type DesktopRewardsStatus,
  type PrepareGithubStarSessionResponse,
  type RewardTaskId,
  type RewardTaskStatus,
  claimDesktopRewardResponseSchema,
  desktopRewardsStatusSchema,
  prepareGithubStarSessionResponseSchema,
  rewardTasks,
} from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiInternalDesktopRewards,
  postApiInternalDesktopRewardsClaim,
  postApiInternalDesktopRewardsGithubStarSession,
} from "../../lib/api/sdk.gen";

export const DESKTOP_REWARDS_QUERY_KEY = ["desktop-rewards"] as const;

function createFallbackRewardsStatus(): DesktopRewardsStatus {
  const tasks: RewardTaskStatus[] = rewardTasks.map((task) => ({
    ...task,
    actionUrl: task.actionUrl ?? null,
    isClaimed: false,
    lastClaimedAt: null,
    claimCount: 0,
  }));

  return {
    viewer: {
      cloudConnected: false,
      activeModelId: null,
      activeModelProviderId: null,
      usingManagedModel: false,
    },
    progress: {
      claimedCount: 0,
      totalCount: tasks.length,
      earnedCredits: 0,
      availableCredits: tasks.reduce((sum, task) => sum + task.reward, 0),
    },
    tasks,
    cloudBalance: null,
  };
}

async function fetchDesktopRewardsStatus(): Promise<DesktopRewardsStatus> {
  const { data, error } = await getApiInternalDesktopRewards();

  if (error || !data) {
    throw error ?? new Error("Failed to fetch desktop rewards");
  }

  return desktopRewardsStatusSchema.parse(data);
}

async function claimDesktopReward(input: {
  taskId: RewardTaskId;
  proof?: DesktopRewardClaimProof;
}) {
  const { data, error } = await postApiInternalDesktopRewardsClaim({
    body: input,
  });

  if (error || !data) {
    throw error ?? new Error("Failed to claim desktop reward");
  }

  return claimDesktopRewardResponseSchema.parse(data);
}

async function prepareGithubStarSession(): Promise<PrepareGithubStarSessionResponse> {
  const { data, error } = await postApiInternalDesktopRewardsGithubStarSession({
    body: {},
  });

  if (error || !data) {
    throw error ?? new Error("Failed to prepare GitHub star session");
  }

  return prepareGithubStarSessionResponseSchema.parse(data);
}

export function useDesktopRewardsStatus() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fallbackNotified = useRef(false);
  const rewardsQuery = useQuery({
    queryKey: DESKTOP_REWARDS_QUERY_KEY,
    queryFn: fetchDesktopRewardsStatus,
    refetchInterval: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (rewardsQuery.data?.autoFallbackTriggered && !fallbackNotified.current) {
      fallbackNotified.current = true;
      toast.warning(t("budget.autoFallback.toast"), { duration: 8000 });
    }
    if (!rewardsQuery.data?.autoFallbackTriggered) {
      fallbackNotified.current = false;
    }
  }, [rewardsQuery.data?.autoFallbackTriggered, t]);

  const claimMutation = useMutation({
    mutationFn: claimDesktopReward,
    onSuccess: (response) => {
      queryClient.setQueryData(DESKTOP_REWARDS_QUERY_KEY, response.status);
    },
  });
  const githubStarSessionMutation = useMutation({
    mutationFn: prepareGithubStarSession,
  });

  return {
    status: rewardsQuery.data ?? createFallbackRewardsStatus(),
    loading: rewardsQuery.isLoading,
    refresh: rewardsQuery.refetch,
    claimTask: claimMutation.mutateAsync,
    prepareGithubStarSession: githubStarSessionMutation.mutateAsync,
    claimingTaskId: claimMutation.isPending
      ? (claimMutation.variables?.taskId ?? null)
      : null,
    isClaiming: claimMutation.isPending,
    isPreparingGithubStarSession: githubStarSessionMutation.isPending,
  };
}
