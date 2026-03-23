import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstallQueue,
  parseRateLimitPauseMs,
} from "#controller/services/skillhub/install-queue";
import type { InstallExecutor } from "#controller/services/skillhub/install-queue";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("parseRateLimitPauseMs", () => {
  it("returns 3000ms (floor) for retry in 1s", () => {
    const msg =
      "Rate limit exceeded (retry in 1s, remaining: 0/120, reset in 1s)";
    expect(parseRateLimitPauseMs(msg)).toBe(3000);
  });

  it("returns 10000ms using reset value when larger than retry", () => {
    const msg =
      "Rate limit exceeded (retry in 5s, remaining: 0/120, reset in 10s)";
    expect(parseRateLimitPauseMs(msg)).toBe(10000);
  });

  it("returns 60000ms (cap) for large durations", () => {
    const msg =
      "Rate limit exceeded (retry in 120s, remaining: 0/20, reset in 120s)";
    expect(parseRateLimitPauseMs(msg)).toBe(60000);
  });

  it("returns 3000ms (default floor) when no numbers present", () => {
    expect(parseRateLimitPauseMs("Rate limit exceeded")).toBe(3000);
  });

  it("returns null for non-rate-limit errors", () => {
    expect(parseRateLimitPauseMs("ENOENT: file not found")).toBeNull();
  });

  it("returns 3000ms (floor) for zero durations", () => {
    const msg =
      "Rate limit exceeded (retry in 0s, remaining: 0/120, reset in 0s)";
    expect(parseRateLimitPauseMs(msg)).toBe(3000);
  });
});

describe("InstallQueue", () => {
  let queue: InstallQueue;
  let executor: ReturnType<typeof vi.fn<InstallExecutor>>;
  const noopLog = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    executor = vi.fn<InstallExecutor>();
  });

  afterEach(() => {
    queue?.dispose();
    vi.useRealTimers();
  });

  function createQueue(opts?: {
    maxConcurrency?: number;
    maxRetries?: number;
    cleanupDelayMs?: number;
  }): InstallQueue {
    queue = new InstallQueue({
      executor,
      log: noopLog,
      ...opts,
    });
    return queue;
  }

  describe("enqueue & dedup", () => {
    it("enqueues a skill and starts executing immediately", async () => {
      const d = createDeferred<void>();
      executor.mockReturnValue(d.promise);
      createQueue();

      const item = queue.enqueue("weather", "managed");

      expect(item.slug).toBe("weather");
      expect(item.status).toBe("downloading");
      expect(executor).toHaveBeenCalledWith("weather", "managed");

      d.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });

    it("deduplicates — returns existing item if slug already queued or active", async () => {
      const d = createDeferred<void>();
      executor.mockReturnValue(d.promise);
      createQueue();

      const first = queue.enqueue("weather", "managed");
      const second = queue.enqueue("weather", "managed");

      expect(first.slug).toBe(second.slug);
      expect(executor).toHaveBeenCalledTimes(1);

      d.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe("concurrency limit", () => {
    it("respects max concurrency of 2", async () => {
      const d1 = createDeferred<void>();
      const d2 = createDeferred<void>();
      const d3 = createDeferred<void>();
      executor
        .mockReturnValueOnce(d1.promise)
        .mockReturnValueOnce(d2.promise)
        .mockReturnValueOnce(d3.promise);
      createQueue({ maxConcurrency: 2 });

      queue.enqueue("a", "managed");
      queue.enqueue("b", "managed");
      const itemC = queue.enqueue("c", "managed");

      expect(executor).toHaveBeenCalledTimes(2);
      expect(itemC.status).toBe("queued");

      d1.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(executor).toHaveBeenCalledTimes(3);

      d2.resolve(undefined);
      d3.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });

    it("when one completes, next queued item starts", async () => {
      const d1 = createDeferred<void>();
      const d2 = createDeferred<void>();
      const d3 = createDeferred<void>();
      executor
        .mockReturnValueOnce(d1.promise)
        .mockReturnValueOnce(d2.promise)
        .mockReturnValueOnce(d3.promise);
      createQueue({ maxConcurrency: 2 });

      queue.enqueue("a", "managed");
      queue.enqueue("b", "managed");
      queue.enqueue("c", "managed");

      d1.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      const items = queue.getQueue();
      const cItem = items.find((i) => i.slug === "c");
      expect(cItem?.status).toBe("downloading");

      d2.resolve(undefined);
      d3.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe("rate limit handling", () => {
    it("parses rate-limit error and pauses queue for parsed duration", async () => {
      let callCount = 0;
      const d1 = createDeferred<void>();
      const d2 = createDeferred<void>();
      executor.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return d1.promise;
        return d2.promise;
      });
      createQueue({ maxRetries: 5 });

      queue.enqueue("weather", "managed");
      d1.reject(
        new Error(
          "Rate limit exceeded (retry in 5s, remaining: 0/120, reset in 10s)",
        ),
      );
      await vi.advanceTimersByTimeAsync(0);

      // Should be paused, not retrying yet
      expect(callCount).toBe(1);

      // Advance past the 10s pause
      await vi.advanceTimersByTimeAsync(10_000);

      expect(callCount).toBe(2);

      d2.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });

    it("retries after pause", async () => {
      let callCount = 0;
      const d2 = createDeferred<void>();
      executor.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(
            new Error(
              "Rate limit exceeded (retry in 1s, remaining: 0/120, reset in 1s)",
            ),
          );
        }
        return d2.promise;
      });
      createQueue({ maxRetries: 5 });

      queue.enqueue("weather", "managed");
      await vi.advanceTimersByTimeAsync(0);

      // Advance past the 3s floor pause
      await vi.advanceTimersByTimeAsync(3000);

      expect(callCount).toBe(2);
      const items = queue.getQueue();
      const item = items.find((i) => i.slug === "weather");
      expect(item?.status).toBe("downloading");

      d2.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });

    it("marks item as failed after max retries", async () => {
      executor.mockRejectedValue(
        new Error(
          "Rate limit exceeded (retry in 1s, remaining: 0/120, reset in 1s)",
        ),
      );
      createQueue({ maxRetries: 2 });

      queue.enqueue("weather", "managed");

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      // Pause + retry 1
      await vi.advanceTimersByTimeAsync(3000);
      // Pause + retry 2
      await vi.advanceTimersByTimeAsync(3000);

      const items = queue.getQueue();
      const item = items.find((i) => i.slug === "weather");
      expect(item?.status).toBe("failed");
      expect(item?.error).toContain("Rate limit");
    });

    it("queue-wide pause: rate limit on one item pauses ALL pending items", async () => {
      let callCount = 0;
      const d2 = createDeferred<void>();
      const d3 = createDeferred<void>();
      executor.mockImplementation((slug: string) => {
        callCount++;
        if (slug === "a" && callCount === 1) {
          return Promise.reject(
            new Error(
              "Rate limit exceeded (retry in 5s, remaining: 0/120, reset in 10s)",
            ),
          );
        }
        if (slug === "a") return d2.promise;
        return d3.promise;
      });
      createQueue({ maxConcurrency: 1, maxRetries: 5 });

      queue.enqueue("a", "managed");
      queue.enqueue("b", "managed");

      // "a" fails with rate limit
      await vi.advanceTimersByTimeAsync(0);

      // "b" should NOT have started because of the queue-wide pause
      expect(callCount).toBe(1);

      // Advance past 10s pause
      await vi.advanceTimersByTimeAsync(10_000);

      // Now "a" should retry and "b" should eventually start
      expect(callCount).toBeGreaterThanOrEqual(2);

      d2.resolve(undefined);
      d3.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe("non-rate-limit errors", () => {
    it("marks item as failed immediately (no retry)", async () => {
      executor.mockRejectedValue(new Error("ENOENT: file not found"));
      createQueue();

      queue.enqueue("weather", "managed");
      await vi.advanceTimersByTimeAsync(0);

      const items = queue.getQueue();
      const item = items.find((i) => i.slug === "weather");
      expect(item?.status).toBe("failed");
      expect(item?.error).toBe("ENOENT: file not found");
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanup", () => {
    it("removes completed/failed items after cleanup delay", async () => {
      executor.mockResolvedValue(undefined);
      createQueue({ cleanupDelayMs: 5000 });

      queue.enqueue("weather", "managed");
      await vi.advanceTimersByTimeAsync(0);

      // Item should be in completed state
      expect(queue.getQueue()).toHaveLength(1);
      expect(queue.getQueue()[0].status).toBe("done");

      // Advance past cleanup delay
      await vi.advanceTimersByTimeAsync(5000);

      expect(queue.getQueue()).toHaveLength(0);
    });
  });

  describe("position tracking", () => {
    it("assigns correct positions to queued items", () => {
      const d = createDeferred<void>();
      executor.mockReturnValue(d.promise);
      createQueue({ maxConcurrency: 1 });

      queue.enqueue("a", "managed");
      queue.enqueue("b", "managed");
      queue.enqueue("c", "managed");

      const items = queue.getQueue();
      const itemA = items.find((i) => i.slug === "a");
      const itemB = items.find((i) => i.slug === "b");
      const itemC = items.find((i) => i.slug === "c");

      expect(itemA?.position).toBe(0);
      expect(itemB?.position).toBe(1);
      expect(itemC?.position).toBe(2);

      d.resolve(undefined);
    });
  });

  describe("cancel", () => {
    it("removes pending item and marks as failed/Cancelled", async () => {
      const d = createDeferred<void>();
      executor.mockReturnValue(d.promise);
      createQueue({ maxConcurrency: 1 });

      queue.enqueue("a", "managed");
      queue.enqueue("b", "managed");

      // "a" is active, "b" is pending
      const cancelled = queue.cancel("b");
      expect(cancelled).toBe(true);

      const items = queue.getQueue();
      const itemB = items.find((i) => i.slug === "b");
      expect(itemB?.status).toBe("failed");
      expect(itemB?.error).toBe("Cancelled");

      // "b" should no longer be in-flight
      expect(queue.isInFlight("b")).toBe(false);

      d.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
    });

    it("marks active item as cancelled on completion", async () => {
      const d = createDeferred<void>();
      executor.mockReturnValue(d.promise);
      createQueue({ maxConcurrency: 1 });

      queue.enqueue("a", "managed");

      // "a" is active — cancel it
      const cancelled = queue.cancel("a");
      expect(cancelled).toBe(true);

      // Complete the executor
      d.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      const items = queue.getQueue();
      const itemA = items.find((i) => i.slug === "a");
      expect(itemA?.status).toBe("failed");
      expect(itemA?.error).toBe("Cancelled");
    });

    it("returns false for unknown slug", () => {
      createQueue();
      expect(queue.cancel("nonexistent")).toBe(false);
    });
  });

  describe("dispose", () => {
    it("stops processing on dispose", async () => {
      const d1 = createDeferred<void>();
      executor.mockReturnValue(d1.promise);
      createQueue({ maxConcurrency: 1 });

      queue.enqueue("a", "managed");
      queue.enqueue("b", "managed");

      queue.dispose();

      d1.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      // "b" should never have started
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it("does not mutate completed after dispose", async () => {
      executor.mockResolvedValue(undefined);
      createQueue({ cleanupDelayMs: 5000 });

      queue.enqueue("a", "managed");
      await vi.advanceTimersByTimeAsync(0);

      // "a" is now in completed
      const itemsBefore = queue.getQueue().length;
      expect(itemsBefore).toBe(1);

      queue.dispose();

      // advance past cleanup delay — should not throw or mutate
      await vi.advanceTimersByTimeAsync(6000);

      // After dispose, completed list should still have the item (cleanup timer was cancelled)
      expect(queue.getQueue()).toHaveLength(1);
    });
  });

  describe("concurrency invariant", () => {
    it("never exceeds max concurrency even under rapid enqueue of 10 items", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      executor.mockImplementation(() => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            concurrent--;
            resolve();
          }, 100);
        });
      });
      createQueue({ maxConcurrency: 2 });

      for (let i = 0; i < 10; i++) {
        queue.enqueue(`skill-${i}`, "managed");
      }

      // Process all items
      await vi.advanceTimersByTimeAsync(1000);

      expect(maxConcurrent).toBe(2);
      expect(executor).toHaveBeenCalledTimes(10);
    });
  });
});
