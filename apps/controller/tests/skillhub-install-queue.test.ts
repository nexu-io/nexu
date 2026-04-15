import { describe, expect, it, vi } from "vitest";
import { InstallQueue } from "../src/services/skillhub/install-queue.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("InstallQueue retry after failure", () => {
  it("replaces the stale failed entry when the same slug is re-enqueued", async () => {
    const executor = vi
      .fn<(slug: string) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("Rate limit exceeded. Retry in 0s. Reset in 0s."),
      )
      .mockResolvedValueOnce(undefined);

    const queue = new InstallQueue({
      executor,
      maxConcurrency: 1,
      maxRetries: 1,
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("foo", "managed");
    // Let the first attempt fail and exhaust retries.
    await flush();
    await flush();
    await flush();

    const afterFail = queue.getQueue();
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]).toMatchObject({
      slug: "foo",
      status: "failed",
      errorCode: "rate_limit",
    });

    // Retry: the stale failed entry must be cleared so the queue reflects
    // only the fresh attempt (no duplicate rows for the same slug).
    queue.enqueue("foo", "managed");
    const afterRetry = queue.getQueue();
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0]?.slug).toBe("foo");
    // "queued" if still pending, "downloading" once drain() has fired —
    // either proves the stale failed row was replaced by the fresh attempt.
    expect(["queued", "downloading"]).toContain(afterRetry[0]?.status);

    queue.dispose();
  });

  it("evicts a failed entry when cancel(slug) is called", async () => {
    const executor = vi
      .fn<(slug: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Skill not found"));

    const queue = new InstallQueue({
      executor,
      maxConcurrency: 1,
      maxRetries: 1,
      cleanupDelayMs: 10_000,
    });

    queue.enqueue("ghost", "managed");
    await flush();
    await flush();

    expect(queue.getQueue()).toHaveLength(1);
    expect(queue.getQueue()[0]?.status).toBe("failed");

    const cancelled = queue.cancel("ghost");
    expect(cancelled).toBe(true);
    expect(queue.getQueue()).toHaveLength(0);

    queue.dispose();
  });

  it("defaults cleanupDelayMs to 60 seconds", () => {
    const queue = new InstallQueue({ executor: vi.fn() });
    // Access private via a narrow cast — the public surface doesn't expose it,
    // but the default is a safety-relevant value worth guarding.
    const delay = (queue as unknown as { cleanupDelayMs: number })
      .cleanupDelayMs;
    expect(delay).toBe(60_000);
    queue.dispose();
  });
});
