import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubStarVerificationService } from "../src/services/github-star-verification-service.js";

describe("GithubStarVerificationService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("rejects verification before the minimum wait elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));

    const service = new GithubStarVerificationService();
    const session = await service.prepareSession();

    await expect(service.verifySession(session.sessionId)).resolves.toEqual({
      ok: false,
      reason: "too_early",
    });
  });

  it("accepts verification after the minimum wait elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T00:00:00.000Z"));

    const service = new GithubStarVerificationService();
    const session = await service.prepareSession();

    vi.advanceTimersByTime(10_000);

    await expect(service.verifySession(session.sessionId)).resolves.toEqual({
      ok: true,
      currentStars: 0,
    });
  });
});
