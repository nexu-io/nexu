import { rewardTasks } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";

import {
  REWARD_VIRTUAL_CHECK_DELAY_MS,
  completeRewardWithVirtualCheck,
  getRewardCheckingDescriptionKey,
} from "#web/lib/reward-virtual-check";

describe("completeRewardWithVirtualCheck", () => {
  it("waits for the virtual check before claiming the reward", async () => {
    const phases: string[] = [];
    const wait = vi.fn(async (ms: number) => {
      phases.push(`wait:${ms}`);
    });
    const claim = vi.fn(async () => {
      phases.push("claim");
      return { ok: true } as const;
    });

    const result = await completeRewardWithVirtualCheck({
      task: rewardTasks[0],
      wait,
      claim,
      onPhaseChange: (phase) => phases.push(`phase:${phase}`),
    });

    expect(result).toEqual({ ok: true });
    expect(wait).toHaveBeenCalledWith(REWARD_VIRTUAL_CHECK_DELAY_MS);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(phases).toEqual([
      "phase:checking",
      `wait:${REWARD_VIRTUAL_CHECK_DELAY_MS}`,
      "phase:claiming",
      "claim",
    ]);
  });
});

describe("getRewardCheckingDescriptionKey", () => {
  it("returns the daily check-in copy for daily tasks", () => {
    const dailyTask = rewardTasks.find((task) => task.id === "daily_checkin");

    expect(dailyTask?.id).toBe("daily_checkin");
    expect(
      getRewardCheckingDescriptionKey(
        dailyTask as (typeof rewardTasks)[number],
      ),
    ).toBe("budget.confirm.checkingCheckinDesc");
  });

  it("returns the image-share copy for image tasks", () => {
    const imageTask = rewardTasks.find((task) => task.shareMode === "image");

    expect(imageTask?.shareMode).toBe("image");
    expect(
      getRewardCheckingDescriptionKey(
        imageTask as (typeof rewardTasks)[number],
      ),
    ).toBe("budget.confirm.checkingImageDesc");
  });

  it("falls back to the generic checking copy for other tasks", () => {
    const genericTask = rewardTasks.find((task) => task.id === "github_star");

    expect(genericTask?.id).toBe("github_star");
    expect(
      getRewardCheckingDescriptionKey(
        genericTask as (typeof rewardTasks)[number],
      ),
    ).toBe("budget.confirm.checkingDesc");
  });
});
