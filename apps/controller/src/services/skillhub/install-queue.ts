import type {
  QueueErrorCode,
  QueueItem,
  QueueItemStatus,
  SkillSource,
} from "./types.js";

export type InstallExecutor = (slug: string) => Promise<void>;
export type InstallCompleteCallback = (
  slug: string,
  source: SkillSource,
) => void;
export type InstallCancelledCallback = (
  slug: string,
  source: SkillSource,
) => Promise<void> | void;

type LogFn = (level: "info" | "error" | "warn", message: string) => void;

const MIN_PAUSE_MS = 3000;
const MAX_PAUSE_MS = 60000;

const RATE_LIMIT_PREFIX = /Rate limit exceeded/i;
const SKILL_NOT_FOUND_PREFIX = /Skill not found/i;
const RETRY_IN_PATTERN = /retry in (\d+)s/i;
const RESET_IN_PATTERN = /reset in (\d+)s/i;

function classifyError(message: string): QueueErrorCode {
  if (RATE_LIMIT_PREFIX.test(message)) return "rate_limit";
  if (SKILL_NOT_FOUND_PREFIX.test(message)) return "skill_not_found";
  return "unknown";
}

export function parseRateLimitPauseMs(message: string): number | null {
  if (!RATE_LIMIT_PREFIX.test(message)) {
    return null;
  }

  const retryMatch = message.match(RETRY_IN_PATTERN);
  const resetMatch = message.match(RESET_IN_PATTERN);

  const retrySec = retryMatch ? Number(retryMatch[1]) : 0;
  const resetSec = resetMatch ? Number(resetMatch[1]) : 0;
  const maxSec = Math.max(retrySec, resetSec);
  const rawMs = maxSec * 1000;

  return Math.max(MIN_PAUSE_MS, Math.min(rawMs, MAX_PAUSE_MS));
}

type MutableQueueItem = {
  slug: string;
  source: SkillSource;
  status: QueueItemStatus;
  error: string | null;
  errorCode: QueueErrorCode | null;
  retries: number;
  enqueuedAt: string;
};

export class InstallQueue {
  private readonly executor: InstallExecutor;
  private readonly onComplete: InstallCompleteCallback | null;
  private readonly onCancelled: InstallCancelledCallback | null;
  private readonly onIdle: (() => void) | null;
  private readonly log: LogFn;
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly cleanupDelayMs: number;

  private readonly pending: MutableQueueItem[] = [];
  private readonly active: Map<string, MutableQueueItem> = new Map();
  private readonly completed: MutableQueueItem[] = [];
  private readonly cancelled = new Set<string>();
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private pausedUntil = 0;
  private disposed = false;
  /** Tracks whether any item completed since the queue was last idle. */
  private hadCompletionSinceIdle = false;

  constructor(opts: {
    executor: InstallExecutor;
    onComplete?: InstallCompleteCallback;
    onCancelled?: InstallCancelledCallback;
    /** Fired when the queue becomes idle (no active or pending items)
     *  after at least one item completed since the last idle state.
     *  Use this instead of onComplete to batch sync triggers. */
    onIdle?: () => void;
    log?: LogFn;
    maxConcurrency?: number;
    maxRetries?: number;
    cleanupDelayMs?: number;
  }) {
    this.executor = opts.executor;
    this.onComplete = opts.onComplete ?? null;
    this.onCancelled = opts.onCancelled ?? null;
    this.onIdle = opts.onIdle ?? null;
    this.log = opts.log ?? (() => {});
    this.maxConcurrency = opts.maxConcurrency ?? 2;
    this.maxRetries = opts.maxRetries ?? 5;
    this.cleanupDelayMs = opts.cleanupDelayMs ?? 60000;
  }

  enqueue(slug: string, source: SkillSource): QueueItem {
    // Dedup: check active, pending, and completed
    const existing = this.findItem(slug);
    if (existing) {
      return this.toReadonly(existing);
    }

    // Clear any prior failed entry so a retry produces a single queued row.
    // Without this, getQueue() would surface both the stale failed item and
    // the new queued one, confusing the UI state.
    const failedIdx = this.completed.findIndex(
      (i) => i.slug === slug && i.status === "failed",
    );
    if (failedIdx !== -1) {
      this.completed.splice(failedIdx, 1);
    }

    const item: MutableQueueItem = {
      slug,
      source,
      status: "queued",
      error: null,
      errorCode: null,
      retries: 0,
      enqueuedAt: new Date().toISOString(),
    };

    this.pending.push(item);
    this.log("info", `Enqueued skill: ${slug}`);
    this.drain();

    return this.toReadonly(item);
  }

  /**
   * Returns true if the slug is queued or actively being installed.
   * Used by SkillDirWatcher to skip in-flight slugs during syncNow().
   */
  isInFlight(slug: string): boolean {
    return this.active.has(slug) || this.pending.some((i) => i.slug === slug);
  }

  /**
   * Cancel a queued, active, or terminally-failed install. Pending items are
   * removed immediately; active items are marked so the executor skips the DB
   * record on completion; failed items in `completed` are evicted so the UI
   * card disappears (user-initiated dismiss).
   * Returns true if the slug was found and cancelled.
   */
  cancel(slug: string): boolean {
    // Remove from pending
    const pendingIdx = this.pending.findIndex((i) => i.slug === slug);
    if (pendingIdx !== -1) {
      const [item] = this.pending.splice(pendingIdx, 1) as [MutableQueueItem];
      item.status = "failed";
      item.error = "Cancelled";
      this.completed.push(item);
      this.scheduleCleanup(item);
      this.log("info", `queue: cancelled pending ${slug}`);
      return true;
    }

    // Mark active as cancelled (executor will check on completion)
    if (this.active.has(slug)) {
      this.cancelled.add(slug);
      this.log("info", `queue: cancelling active ${slug}`);
      return true;
    }

    // Evict a terminally-failed entry so its card disappears from the UI.
    const failedIdx = this.completed.findIndex(
      (i) => i.slug === slug && i.status === "failed",
    );
    if (failedIdx !== -1) {
      this.completed.splice(failedIdx, 1);
      this.log("info", `queue: dismissed failed ${slug}`);
      return true;
    }

    return false;
  }

  getQueue(): readonly QueueItem[] {
    const all: QueueItem[] = [];
    let position = 0;

    for (const item of this.active.values()) {
      all.push(this.toReadonlyWithPosition(item, position++));
    }
    for (const item of this.pending) {
      all.push(this.toReadonlyWithPosition(item, position++));
    }
    for (const item of this.completed) {
      all.push(this.toReadonlyWithPosition(item, position++));
    }

    return all;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  private findItem(slug: string): MutableQueueItem | undefined {
    if (this.active.has(slug)) {
      return this.active.get(slug);
    }
    const pendingItem = this.pending.find((i) => i.slug === slug);
    if (pendingItem) {
      return pendingItem;
    }
    // Only dedup against "done" items — failed items should be retryable immediately
    return this.completed.find((i) => i.slug === slug && i.status === "done");
  }

  private drain(): void {
    if (this.disposed) {
      return;
    }

    const now = Date.now();
    if (now < this.pausedUntil) {
      return;
    }

    while (this.active.size < this.maxConcurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      if (!item) break;
      this.active.set(item.slug, item);
      item.status = "downloading";
      this.execute(item);
    }

    // Fire onIdle when the queue is fully drained and at least one item
    // completed since the last idle state. This batches sync triggers:
    // e.g. 10 skill installs → 1 onIdle instead of 10 onComplete calls.
    if (
      this.active.size === 0 &&
      this.pending.length === 0 &&
      this.hadCompletionSinceIdle
    ) {
      this.hadCompletionSinceIdle = false;
      try {
        this.onIdle?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log("error", `onIdle callback failed: ${msg}`);
      }
    }
  }

  private execute(item: MutableQueueItem): void {
    this.log("info", `Executing install for: ${item.slug}`);

    this.executor(item.slug).then(
      async () => {
        if (this.disposed) return;

        if (this.cancelled.has(item.slug)) {
          this.cancelled.delete(item.slug);
          try {
            await this.onCancelled?.(item.slug, item.source);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log(
              "error",
              `Cancel cleanup failed for ${item.slug}: ${message}`,
            );
          }
          this.active.delete(item.slug);
          item.status = "failed";
          item.error = "Cancelled";
          this.log("info", `queue: ${item.slug} completed but was cancelled`);
        } else {
          this.active.delete(item.slug);
          item.status = "done";
          this.hadCompletionSinceIdle = true;
          // Record in DB only on successful, non-cancelled completion
          try {
            this.onComplete?.(item.slug, item.source);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log("error", `onComplete failed for ${item.slug}: ${msg}`);
          }
          this.log("info", `Install complete: ${item.slug}`);
        }

        this.completed.push(item);
        this.scheduleCleanup(item);
        this.drain();
      },
      (err: unknown) => {
        if (this.disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        const code = classifyError(message);
        const pauseMs = parseRateLimitPauseMs(message);

        if (pauseMs !== null) {
          item.retries++;
          this.log(
            "warn",
            `Rate limit hit for ${item.slug} (retry ${item.retries}/${this.maxRetries})`,
          );

          if (item.retries >= this.maxRetries) {
            item.status = "failed";
            item.error = message;
            item.errorCode = code;
            this.active.delete(item.slug);
            this.completed.push(item);
            this.scheduleCleanup(item);
            this.drain();
            return;
          }

          // Move back to front of pending for retry
          item.status = "queued";
          this.active.delete(item.slug);
          this.pending.unshift(item);
          this.pauseQueue(pauseMs);
        } else {
          // Non-rate-limit error: fail immediately
          item.status = "failed";
          item.errorCode = code;
          item.error = message;
          this.active.delete(item.slug);
          this.completed.push(item);
          this.log("error", `Install failed for ${item.slug}: ${message}`);
          this.scheduleCleanup(item);
          this.drain();
        }
      },
    );
  }

  private pauseQueue(ms: number): void {
    this.pausedUntil = Date.now() + ms;
    this.log("warn", `Queue paused for ${ms}ms`);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.pausedUntil = 0;
      if (!this.disposed) {
        this.drain();
      }
    }, ms);
  }

  private scheduleCleanup(item: MutableQueueItem): void {
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      if (this.disposed) return;
      const idx = this.completed.indexOf(item);
      if (idx !== -1) {
        this.completed.splice(idx, 1);
      }
    }, this.cleanupDelayMs);
    this.cleanupTimers.add(timer);
  }

  private toReadonly(item: MutableQueueItem): QueueItem {
    return {
      slug: item.slug,
      source: item.source,
      status: item.status,
      position: this.computePosition(item),
      error: item.error,
      errorCode: item.errorCode,
      retries: item.retries,
      enqueuedAt: item.enqueuedAt,
    };
  }

  private toReadonlyWithPosition(
    item: MutableQueueItem,
    position: number,
  ): QueueItem {
    return {
      slug: item.slug,
      source: item.source,
      status: item.status,
      position,
      error: item.error,
      errorCode: item.errorCode,
      retries: item.retries,
      enqueuedAt: item.enqueuedAt,
    };
  }

  private computePosition(item: MutableQueueItem): number {
    let pos = 0;
    for (const a of this.active.values()) {
      if (a === item) return pos;
      pos++;
    }
    for (const p of this.pending) {
      if (p === item) return pos;
      pos++;
    }
    for (const c of this.completed) {
      if (c === item) return pos;
      pos++;
    }
    return pos;
  }
}
