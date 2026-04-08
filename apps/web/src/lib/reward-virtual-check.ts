import type { RewardTaskStatus } from "@nexu/shared";

export const REWARD_VIRTUAL_CHECK_DELAY_MS = 1400;

export type RewardConfirmPhase = "idle" | "checking" | "claiming";

type WaitForMs = (ms: number) => Promise<void>;

function waitForMs(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export function getRewardCheckingDescriptionKey(task: RewardTaskStatus) {
  if (task.repeatMode === "daily") {
    return "budget.confirm.checkingCheckinDesc";
  }

  if (task.shareMode === "image") {
    return "budget.confirm.checkingImageDesc";
  }

  return "budget.confirm.checkingDesc";
}

export async function runVirtualRewardCheck(
  _task: RewardTaskStatus,
  wait: WaitForMs = waitForMs,
) {
  await wait(REWARD_VIRTUAL_CHECK_DELAY_MS);
}

export async function completeRewardWithVirtualCheck<T>({
  task,
  claim,
  wait = waitForMs,
  onPhaseChange,
}: {
  task: RewardTaskStatus;
  claim: () => Promise<T>;
  wait?: WaitForMs;
  onPhaseChange?: (phase: Exclude<RewardConfirmPhase, "idle">) => void;
}) {
  onPhaseChange?.("checking");
  await runVirtualRewardCheck(task, wait);
  onPhaseChange?.("claiming");
  return claim();
}
