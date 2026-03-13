import { describe, expect, it, vi } from "vitest";

// Mock @amplitude/analytics-node before importing tracking module
vi.mock("@amplitude/analytics-node", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

describe("tracking", () => {
  it("does not call ampTrack when AMPLITUDE_API_KEY is unset", async () => {
    const { track: ampTrack } = await import("@amplitude/analytics-node");
    const { track } = await import("../tracking.js");

    track("test_event", "user-123", { foo: "bar" });

    // apiKey is undefined in test env, so ampTrack should not be called
    expect(ampTrack).not.toHaveBeenCalled();
  });

  it("exports track as a function with correct signature", async () => {
    const { track } = await import("../tracking.js");
    expect(typeof track).toBe("function");
    // 3 params: event, userId, properties (all counted since none have defaults)
    expect(track.length).toBe(3);
  });
});
