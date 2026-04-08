import { describe, expect, it, vi } from "vitest";
import { syncDesktopCloudQueries } from "../src/hooks/use-desktop-cloud-status";

describe("syncDesktopCloudQueries", () => {
  it("invalidates all desktop cloud related queries together", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries,
    };

    await syncDesktopCloudQueries(queryClient as never);

    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["desktop-cloud-status"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["desktop-rewards"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["models"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(4, {
      queryKey: ["desktop-default-model"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(5, {
      queryKey: ["me"],
    });
  });
});
