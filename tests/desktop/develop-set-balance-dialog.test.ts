import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCurrentBalance,
  setCurrentBalance,
} from "../../apps/desktop/src/components/develop-set-balance-dialog";
import * as hostApi from "../../apps/desktop/src/lib/host-api";

describe("desktop set balance dialog helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the current balance through the desktop host bridge", async () => {
    const getRewardsSpy = vi
      .spyOn(hostApi, "getDesktopRewardsStatus")
      .mockResolvedValue({
        cloudBalance: {
          totalBalance: 1200,
        },
      });

    await expect(fetchCurrentBalance()).resolves.toBe(1200);

    expect(getRewardsSpy).toHaveBeenCalledOnce();
  });

  it("posts the test balance update through the desktop host bridge", async () => {
    const setBalanceSpy = vi
      .spyOn(hostApi, "setDesktopRewardBalance")
      .mockResolvedValue({
        cloudBalance: {
          totalBalance: 1337,
        },
      });

    await expect(setCurrentBalance(1337)).resolves.toBe(1337);

    expect(setBalanceSpy).toHaveBeenCalledWith(1337);
  });

  it("surfaces the host bridge error when balance update fails", async () => {
    vi.spyOn(hostApi, "setDesktopRewardBalance").mockRejectedValue(
      new Error(
        "idempotencyKey is already bound to a different credit adjustment",
      ),
    );

    await expect(setCurrentBalance(1337)).rejects.toThrow(
      "idempotencyKey is already bound to a different credit adjustment",
    );
  });
});
